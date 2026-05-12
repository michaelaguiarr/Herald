import { Channel, ChannelType, Notification } from '@prisma/client'
import { decrypt } from '../lib/crypto'
import { sendViaEmail, EmailCredentials } from './email/nodemailer.client'
import { whatsappSessionManager } from './whatsapp/session.manager'
import { sendViaTelegram, TelegramCredentials } from './telegram/telegram.client'

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

    case ChannelType.TELEGRAM: {
      if (!notification.recipientTelegramId) {
        throw new Error('recipientTelegramId ausente para canal TELEGRAM')
      }
      await sendViaTelegram(
        credentials as unknown as TelegramCredentials,
        notification.recipientTelegramId,
        notification.message
      )
      break
    }

    default:
      throw new Error(`Tipo de canal desconhecido: ${channel.type}`)
  }
}
