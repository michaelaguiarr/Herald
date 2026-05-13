import { Channel, ChannelType, Notification } from '@prisma/client'
import { decrypt } from '../lib/crypto'
import { sendViaEmail, EmailCredentials } from './email/nodemailer.client'
import { whatsappSessionManager } from './whatsapp/session.manager'
import { sendViaTelegram, TelegramCredentials } from './telegram/telegram.client'

export interface DispatchResult {
  whatsappMessageId?: string  // set only for WHATSAPP channels — used for delivery receipts
}

export async function dispatch(channel: Channel, notification: Notification): Promise<DispatchResult> {
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
        notification.message,
        notification.imageUrl
          ? { imageUrl: notification.imageUrl, imageCaption: notification.imageCaption ?? undefined }
          : undefined
      )
      return {}
    }

    case ChannelType.WHATSAPP: {
      if (!notification.recipientPhone) {
        throw new Error('recipientPhone ausente para canal WHATSAPP')
      }
      const whatsappMessageId = await whatsappSessionManager.sendMessage(
        channel.id,
        notification.recipientPhone,
        notification.message,
        notification.imageUrl
          ? { imageUrl: notification.imageUrl, caption: notification.imageCaption ?? undefined }
          : undefined
      )
      return { whatsappMessageId }
    }

    case ChannelType.TELEGRAM: {
      if (!notification.recipientTelegramId) {
        throw new Error('recipientTelegramId ausente para canal TELEGRAM')
      }
      await sendViaTelegram(
        credentials as unknown as TelegramCredentials,
        notification.recipientTelegramId,
        notification.message,
        notification.imageUrl
          ? { imageUrl: notification.imageUrl, caption: notification.imageCaption ?? undefined }
          : undefined
      )
      return {}
    }

    default:
      throw new Error(`Tipo de canal desconhecido: ${channel.type}`)
  }
}
