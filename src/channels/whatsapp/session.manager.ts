import EventEmitter from 'events'
import { ChannelStatus, ChannelType } from '@prisma/client'
import path from 'path'
import { prisma } from '../../lib/prisma'
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
  // SSE streams subscribe here so they keep receiving events even after /reconnect
  // creates a new BaileysClient for the same channel.
  private channelEmitters = new Map<string, EventEmitter>()

  getChannelEmitter(channelId: string): EventEmitter {
    let emitter = this.channelEmitters.get(channelId)
    if (!emitter) {
      emitter = new EventEmitter()
      emitter.setMaxListeners(30) // allow multiple concurrent SSE clients per channel
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

  async startSession(channelId: string): Promise<BaileysClient> {
    const existing = this.sessions.get(channelId)
    if (existing) {
      // Disconnect silently — no DB write, no status event from old session
      await existing.disconnect(false)
    }

    const client = new BaileysClient(channelId, sessionsBasePath)
    this.sessions.set(channelId, client)

    const emitter = this.getChannelEmitter(channelId)

    // Forward client events to the persistent channel emitter.
    // SSE streams subscribed to the emitter receive events regardless of
    // which BaileysClient instance is currently active.
    client.on('qr', (qr: string) => {
      emitter.emit('qr', qr)
    })

    client.on('status-change', async (status: WaSessionStatus) => {
      emitter.emit('status-change', status)

      await prisma.channel
        .update({
          where: { id: channelId },
          data: { status: statusToDb[status] },
        })
        .catch((err) =>
          console.error(`[wa:manager] Falha ao atualizar status ${channelId}:`, err)
        )
      console.log(`[wa:session:${channelId}] → ${status}`)
    })

    await client.connect()
    return client
  }

  async stopSession(channelId: string): Promise<void> {
    const session = this.sessions.get(channelId)
    if (session) {
      await session.disconnect(false)
      this.sessions.delete(channelId)
    }
    // Clean up the channel emitter so stale SSE listeners don't accumulate
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