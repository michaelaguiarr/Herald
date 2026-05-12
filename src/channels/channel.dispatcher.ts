import { Channel, ChannelType, Notification } from '@prisma/client'
import { decrypt } from '../lib/crypto'
import { sendViaEmail, EmailCredentials } from './email/nodemailer.client'

/**
 * Routes a notification to the correct channel client.
 * Each phase adds a new case:
 *   Phase 2 → EMAIL (implemented)
 *   Phase 3 → WHATSAPP (Baileys)
 *   Phase 4 → TELEGRAM
 */
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

    case ChannelType.WHATSAPP:
      // Phase 3 — Baileys client
      throw new Error('Canal WHATSAPP ainda não implementado')

    case ChannelType.TELEGRAM:
      // Phase 4 — node-telegram-bot-api
      throw new Error('Canal TELEGRAM ainda não implementado')

    default:
      throw new Error(`Tipo de canal desconhecido: ${channel.type}`)
  }
}
