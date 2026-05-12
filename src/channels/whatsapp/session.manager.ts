import EventEmitter from 'events'
import fs from 'fs'
import path from 'path'
import { ChannelStatus, ChannelType } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { enqueueAlert } from '../../alerts/alert.service'
import { BaileysClient, WaSessionStatus } from './baileys.client'

const sessionsBasePath =
  process.env.WA_SESSIONS_PATH ?? path.join(process.cwd(), 'whatsapp-sessions')

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
      // Return existing client (may still be connecting)
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

      client.on('status-change', async (status: WaSessionStatus) => {
        emitter.emit('status-change', status)

        const channel = await prisma.channel
          .update({
            where: { id: channelId },
            data: { status: statusToDb[status] },
          })
          .catch((err) => {
            console.error(`[wa:manager] Falha ao atualizar status ${channelId}:`, err)
            return null
          })

        console.log(`[wa:session:${channelId}] → ${status}`)

        if (status === 'BANNED' && channel) {
          enqueueAlert(
            'NUMERO_BANIDO',
            channel.organizationId,
            `O número WhatsApp <b>${channel.label}</b> foi banido pelo WhatsApp.\n` +
              `Configure um número substituto e atualize o canal.`,
            channelId
          )
        }
      })

      await client.connect()
      return client
    } finally {
      this.starting.delete(channelId)
    }
  }

  async stopSession(channelId: string): Promise<void> {
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