import EventEmitter from 'events'
import fs from 'fs'
import path from 'path'
import { ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { enqueueAlert } from '../../alerts/alert.service'
import { writeAuditLog } from '../../lib/audit'
import { invalidateCachedJid } from '../../lib/whatsapp-jid.cache'
import { BaileysClient, WaSessionStatus } from './baileys.client'

const sessionsBasePath =
  process.env.WA_SESSIONS_PATH ?? path.join(process.cwd(), 'whatsapp-sessions')

// How long a session must stay DISCONNECTED before we fire the alert.
// Auto-reconnect fires after 5s — 2 minutes is enough to detect persistent failures.
const DISCONNECT_ALERT_DELAY_MS = 2 * 60 * 1000

const statusToDb: Record<WaSessionStatus, ChannelStatus> = {
  WARMING: ChannelStatus.WARMING,
  ACTIVE: ChannelStatus.ACTIVE,
  DISCONNECTED: ChannelStatus.DISCONNECTED,
  BANNED: ChannelStatus.BANNED,
}

class WhatsAppSessionManager {
  private sessions = new Map<string, BaileysClient>()

  // Channel-level emitters persist across session replacements (reconnect, restart).
  // SSE streams subscribe here so they receive events regardless of which
  // BaileysClient instance is currently active.
  private channelEmitters = new Map<string, EventEmitter>()

  // Tracks channels whose startSession is currently in-flight to prevent
  // concurrent calls (e.g. SSE auto-start racing with /reconnect).
  private starting = new Set<string>()

  // Debounce timers for SESSAO_DESCONECTADA alerts.
  // A timer is started when a channel goes DISCONNECTED and cancelled if it
  // recovers (ACTIVE / WARMING) before the delay expires.
  private disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

  getChannelEmitter(channelId: string): EventEmitter {
    let emitter = this.channelEmitters.get(channelId)
    if (!emitter) {
      emitter = new EventEmitter()
      emitter.setMaxListeners(30)
      this.channelEmitters.set(channelId, emitter)
    }
    return emitter
  }

  async initialize(): Promise<void> {
    const channels = await prisma.channel.findMany({
      where: {
        type: ChannelType.WHATSAPP,
        status: {
          in: [ChannelStatus.WARMING, ChannelStatus.ACTIVE, ChannelStatus.DISCONNECTED],
        },
      },
    })

    console.log(`[wa:manager] Inicializando ${channels.length} sessão(ões) WhatsApp`)

    for (const channel of channels) {
      this.startSession(channel.id).catch((err) =>
        console.error(`[wa:manager] Falha ao iniciar sessão ${channel.id}:`, err)
      )
    }
  }

  /**
   * @param clearAuth  When true, deletes the saved Baileys auth state before
   *   connecting. Use for manual reconnects so a fresh QR Code is always
   *   generated instead of Baileys silently trying to resume an expired session.
   */
  async startSession(channelId: string, clearAuth = false): Promise<BaileysClient> {
    // Guard: skip if a start is already in progress for this channel
    if (this.starting.has(channelId)) {
      console.log(`[wa:manager] startSession ${channelId} já em andamento — ignorando chamada duplicada`)
      const existing = this.sessions.get(channelId)
      if (existing) return existing
    }

    this.starting.add(channelId)

    try {
      const existing = this.sessions.get(channelId)
      if (existing) {
        await existing.disconnect(false)
      }

      if (clearAuth) {
        const sessionDir = path.join(sessionsBasePath, channelId)
        fs.rmSync(sessionDir, { recursive: true, force: true })
        console.log(`[wa:manager] Auth state removido para ${channelId} — novo QR Code será gerado`)
      }

      // ── Pre-fetch connectedAt BEFORE registering the status-change listener ──
      // Fetching inside the async handler creates a race window: Baileys fires
      // 'ACTIVE' synchronously, setting _status=ACTIVE in memory. The worker can
      // then selectChannels (DB still shows ACTIVE) and dispatch before the handler
      // finishes the DB query + update. Pre-fetching eliminates that window.
      // Pre-fetch channel metadata needed by listeners in the closure.
      const initialState = await prisma.channel
        .findUnique({ where: { id: channelId }, select: { connectedAt: true, organizationId: true } })
        .catch(() => null)
      // Mutable flag in closure — flipped synchronously on first ACTIVE event,
      // before any awaits, so reconnects see true without a DB round-trip.
      let firstConnectionRecorded = !!initialState?.connectedAt
      const orgId = initialState?.organizationId ?? ''

      const client = new BaileysClient(channelId, sessionsBasePath)
      this.sessions.set(channelId, client)

      const emitter = this.getChannelEmitter(channelId)

      client.on('qr', (qr: string) => {
        emitter.emit('qr', qr)
      })

      client.on('status-change', async (rawStatus: WaSessionStatus) => {
        // ── Warmup: first Baileys ACTIVE → record connectedAt, keep WARMING ──
        // Uses the pre-fetched flag — no DB query in the hot path, no async gap.
        // The channel stays WARMING until the 7-day cron promotes it to ACTIVE.
        let effectiveStatus: WaSessionStatus = rawStatus
        let extraData: { connectedAt?: Date } = {}

        if (rawStatus === 'ACTIVE') {
          if (!firstConnectionRecorded) {
            // First ever connection — start warm-up period.
            // Flip the flag SYNCHRONOUSLY before any await so reconnects skip this branch.
            firstConnectionRecorded = true
            effectiveStatus = 'WARMING'
            extraData = { connectedAt: new Date() }
            console.log(`[wa:session:${channelId}] Primeira conexão → warm-up iniciado (7 dias)`)
          }
        }

        // Emit the effective status (WARMING for first connect, others as-is)
        emitter.emit('status-change', effectiveStatus)

        const channel = await prisma.channel
          .update({
            where: { id: channelId },
            data: { status: statusToDb[effectiveStatus], ...extraData },
          })
          .catch((err) => {
            // Log with full context — a missed status update can corrupt channel state
            console.error(
              `[wa:manager] Falha ao atualizar status ${channelId} → ${effectiveStatus}:`, err
            )
            return null
          })

        const status = effectiveStatus  // alias for the rest of this handler
        console.log(`[wa:session:${channelId}] → ${status}${rawStatus !== status ? ` (Baileys: ${rawStatus})` : ''}`)

        // ── Debounce: SESSAO_DESCONECTADA alert ─────────────────────────────
        // Cancel any existing timer whenever status changes.
        const existingTimer = this.disconnectTimers.get(channelId)
        if (existingTimer) {
          clearTimeout(existingTimer)
          this.disconnectTimers.delete(channelId)
        }

        if (status === 'DISCONNECTED') {
          // Start timer — fires only if session doesn't recover within 2 minutes.
          // Baileys auto-reconnects after 5s, so transient drops are filtered out.
          const timer = setTimeout(async () => {
            this.disconnectTimers.delete(channelId)
            const current = await prisma.channel
              .findUnique({ where: { id: channelId } })
              .catch(() => null)
            if (current?.status === ChannelStatus.DISCONNECTED) {
              enqueueAlert(
                'SESSAO_DESCONECTADA',
                current.organizationId,
                `Sessão WhatsApp <b>${current.label}</b> está desconectada há mais de 2 minutos sem reconexão automática.`,
                channelId
              )
              writeAuditLog({
                userId: null,
                organizationId: current.organizationId,
                action: 'WHATSAPP_SESSAO_DESCONECTADA',
                targetId: channelId,
                targetType: 'channel',
                metadata: { label: current.label, actor: 'system:whatsapp_session_manager' },
              }).catch((err) => console.error('[wa:manager] Falha ao gravar audit_log SESSAO_DESCONECTADA:', err))
            }
          }, DISCONNECT_ALERT_DELAY_MS)
          this.disconnectTimers.set(channelId, timer)
        }

        // ── BANNED: alert + audit_log ────────────────────────────────────────
        if (status === 'BANNED' && channel) {
          enqueueAlert(
            'NUMERO_BANIDO',
            channel.organizationId,
            `O número WhatsApp <b>${channel.label}</b> foi banido pelo WhatsApp.\n` +
              `Configure um número substituto e atualize o canal.`,
            channelId
          )
          writeAuditLog({
            userId: null,
            organizationId: channel.organizationId,
            action: 'WHATSAPP_BANNED',
            targetId: channelId,
            targetType: 'channel',
            metadata: { label: channel.label, actor: 'system:whatsapp_session_manager' },
          }).catch((err) => console.error('[wa:manager] Falha ao gravar audit_log WHATSAPP_BANNED:', err))
        }
      })

      // ── Delivery receipt handler ─────────────────────────────────────────
      // Updates deliveryStatus on the notification_attempt when WA delivers
      // or the recipient reads our message. Rank-guarded: statuses only advance
      // (SERVER_ACK → DELIVERY_ACK → READ), never regress.
      const DELIVERY_RANK: Record<string, number> = {
        SERVER_ACK: 1, DELIVERY_ACK: 2, READ: 3,
      }

      client.on('delivery-update', async ({ messageId, status }: { messageId: string; status: string }) => {
        try {
          const attempt = await prisma.notificationAttempt.findFirst({
            where: { whatsappMessageId: messageId, success: true },
            select: { id: true, deliveryStatus: true },
          })
          if (!attempt) return

          const currentRank = DELIVERY_RANK[attempt.deliveryStatus ?? ''] ?? 0
          const newRank = DELIVERY_RANK[status] ?? 0
          if (newRank <= currentRank) return  // never downgrade

          await prisma.notificationAttempt.update({
            where: { id: attempt.id },
            data: { deliveryStatus: status },
          })
          console.log(
            `[wa:manager:${channelId}] receipt → msgId=${messageId} ` +
            `${attempt.deliveryStatus ?? 'null'} → ${status}`
          )
        } catch (err) {
          console.error(`[wa:manager] Falha ao atualizar deliveryStatus msgId=${messageId}:`, err)
        }
      })

      // ── Opt-out handler ─────────────────────────────────────────────────
      client.on('opt-out-request', async ({ phone, reason }: { phone: string; reason: string }) => {
        if (!orgId) {
          console.warn(`[opt-out] Canal ${channelId} sem organizationId — ignorando`)
          return
        }
        try {
          await prisma.optOut.upsert({
            where: { phone_organizationId: { phone, organizationId: orgId } },
            create: { phone, organizationId: orgId, reason },
            update: {},  // idempotent: don't overwrite existing entry
          })
          await invalidateCachedJid(phone)
          console.log(`[opt-out] +${phone} → registrado (org: ${orgId.slice(0, 8)})`)

          // Send confirmation — non-critical, errors are swallowed inside sendDirectMessage
          await client.sendDirectMessage(
            `${phone}@s.whatsapp.net`,
            'Você foi removido da lista de notificações. ' +
              'Para se recadastrar, entre em contato com a administração.'
          )
        } catch (err) {
          console.error(`[opt-out] Falha ao registrar opt-out +${phone}:`, err)
        }
      })

      await client.connect()
      return client
    } finally {
      this.starting.delete(channelId)
    }
  }

  async stopSession(channelId: string): Promise<void> {
    // Cancel disconnect alert timer before stopping to avoid phantom alerts
    const timer = this.disconnectTimers.get(channelId)
    if (timer) {
      clearTimeout(timer)
      this.disconnectTimers.delete(channelId)
    }

    const session = this.sessions.get(channelId)
    if (session) {
      await session.disconnect(false)
      this.sessions.delete(channelId)
    }
    const emitter = this.channelEmitters.get(channelId)
    if (emitter) {
      emitter.removeAllListeners()
      this.channelEmitters.delete(channelId)
    }
  }

  /**
   * Disconnects a channel intentionally (operator-triggered).
   * Differs from stopSession: also removes auth files so the next
   * startSession always generates a fresh QR Code.
   * Does NOT start a new session — caller owns that decision.
   */
  async disconnectSession(channelId: string): Promise<void> {
    // Cancel any pending alert timer — this is intentional, no alarm needed
    const timer = this.disconnectTimers.get(channelId)
    if (timer) {
      clearTimeout(timer)
      this.disconnectTimers.delete(channelId)
    }

    const session = this.sessions.get(channelId)
    if (session) {
      await session.disconnect(false)  // sets _manualDisconnect=true, _shouldReconnect=false
      this.sessions.delete(channelId)
    }

    // Clear auth files — forces a new QR Code on the next connection
    const sessionDir = path.join(sessionsBasePath, channelId)
    fs.rmSync(sessionDir, { recursive: true, force: true })
    console.log(`[wa:manager] disconnectSession ${channelId} — auth removida`)

    const emitter = this.channelEmitters.get(channelId)
    if (emitter) {
      emitter.removeAllListeners()
      this.channelEmitters.delete(channelId)
    }
  }

  // Returns the Baileys message ID (key.id) so the worker can link delivery ACKs.
  async sendMessage(
    channelId: string,
    phone: string,
    text: string,
    opts?: { imageUrl?: string; caption?: string }
  ): Promise<string> {
    const session = this.sessions.get(channelId)
    if (!session) {
      throw new Error(`Sessão WhatsApp ${channelId} não encontrada`)
    }
    return session.sendMessage(phone, text, opts)
  }

  async getGroups(channelId: string): Promise<{ id: string; name: string; participantsCount: number }[]> {
    const session = this.sessions.get(channelId)
    if (!session) {
      throw new Error(`Sessão WhatsApp ${channelId} não encontrada`)
    }
    return session.getGroups()
  }

  getSession(channelId: string): BaileysClient | undefined {
    return this.sessions.get(channelId)
  }
}

export const whatsappSessionManager = new WhatsAppSessionManager()
