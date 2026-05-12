import { Channel, ChannelType, Notification } from '@prisma/client'
import { decrypt } from '../lib/crypto'
import { sendViaEmail, EmailCredentials } from './email/nodemailer.client'
import { whatsappSessionManager } from './whatsapp/session.manager'

export async function dispatch(channel: Channel, notification: Notification): Promise<void> {
  const raw = channel.credentials as { encrypted: string }
  const credentials = JSON.parse(decrypt(raw.encrypted)) as Record<string, unknown>

  switch (channel.type) {
    case ChannelType.EMAIL: {
      if (!notification.recipientEmail) {
        throw new Error('recipientEmail ausente para canal EMAIL')
      }
      await sendViaEmail(
        credentials as unknown as EmailCredentials,
        notification.recipientEmail,
        notification.recipientName,
        notification.message
      )
      break
    }

    case ChannelType.WHATSAPP: {
      if (!notification.recipientPhone) {
        throw new Error('recipientPhone ausente para canal WHATSAPP')
      }
      await whatsappSessionManager.sendMessage(
        channel.id,
        notification.recipientPhone,
        notification.message
      )
      break
    }

    case ChannelType.TELEGRAM:
      // Phase 4 — node-telegram-bot-api
      throw new Error('Canal TELEGRAM ainda não implementado')

    default:
      throw new Error(`Tipo de canal desconhecido: ${channel.type}`)
  }
}
