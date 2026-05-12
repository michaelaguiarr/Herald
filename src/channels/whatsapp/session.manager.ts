import EventEmitter from 'events'
import fs from 'fs'
import path from 'path'
import { ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { enqueueAlert } from '../../alerts/alert.service'
import { writeAuditLog } from '../../lib/audit'
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

      const client = new BaileysClient(channelId, sessionsBasePath)
      this.sessions.set(channelId, client)

      const emitter = this.getChannelEmitter(channelId)

      client.on('qr', (qr: string) => {
        emitter.emit('qr', qr)
      })

      client.on('status-change', async (rawStatus: WaSessionStatus) => {
        // ── Warmup: first Baileys ACTIVE → record connectedAt, keep WARMING ──
        // The channel stays WARMING until the 7-day cron promotes it to ACTIVE.
        // After promotion, reconnections go straight to ACTIVE.
        let effectiveStatus: WaSessionStatus = rawStatus
        let extraData: { connectedAt?: Date } = {}

        if (rawStatus === 'ACTIVE') {
          const existing = await prisma.channel
            .findUnique({ where: { id: channelId }, select: { connectedAt: true } })
            .catch(() => null)

          if (!existing?.connectedAt) {
            // First ever connection — start warm-up period
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
            console.error(`[wa:manager] Falha ao atualizar status ${channelId}:`, err)
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

  async sendMessage(channelId: string, phone: string, text: string): Promise<void> {
    const session = this.sessions.get(channelId)
    if (!session) {
      throw new Error(`Sessão WhatsApp ${channelId} não encontrada`)
    }
    await session.sendMessage(phone, text)
  }

  getSession(channelId: string): BaileysClient | undefined {
    return this.sessions.get(channelId)
  }
}

export const whatsappSessionManager = new WhatsAppSessionManager()
