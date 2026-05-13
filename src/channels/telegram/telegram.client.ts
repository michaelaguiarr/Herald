import TelegramBot from 'node-telegram-bot-api'

export interface TelegramCredentials {
  botToken: string
}

/**
 * Sends a text message via the Telegram Bot API.
 *
 * Each call creates a lightweight bot instance (no polling/webhook) and makes
 * a single HTTPS POST to api.telegram.org. Suitable for transactional sending
 * where persistent connections are not required.
 *
 * @param chatId  Telegram chat ID of the recipient (user, group or channel).
 *                For users: numeric ID. For public channels: @handle.
 */
export async function sendViaTelegram(
  credentials: TelegramCredentials,
  chatId: string,
  text: string,
  opts?: { imageUrl?: string; caption?: string }
): Promise<void> {
  const bot = new TelegramBot(credentials.botToken)
  if (opts?.imageUrl) {
    // sendPhoto accepts a publicly accessible URL directly — no download needed
    await bot.sendPhoto(chatId, opts.imageUrl, {
      caption: opts.caption ?? text ?? '',
      parse_mode: 'HTML',
    })
  } else {
    await bot.sendMessage(chatId, text, { parse_mode: 'HTML' })
  }
}
