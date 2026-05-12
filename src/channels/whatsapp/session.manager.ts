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
      // Disconnect silently so the in-progress DB status isn't overwritten
      await existing.disconnect(false)
    }

    const client = new BaileysClient(channelId, sessionsBasePath)
    this.sessions.set(channelId, client)

    client.on('status-change', async (status: WaSessionStatus) => {
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