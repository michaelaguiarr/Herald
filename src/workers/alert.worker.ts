import 'dotenv/config'
import { Worker } from 'bullmq'
import { ChannelStatus, ChannelType, UserRole } from '@prisma/client'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { decrypt } from '../lib/crypto'
import { sendViaTelegram, type TelegramCredentials } from '../channels/telegram/telegram.client'
import type { AlertJobData } from '../queues/alert.queue'

const EMOJI: Record<AlertJobData['event'], string> = {
  FALHOU_DEFINITIVO: '🔴',
  NUMERO_BANIDO: '⛔',
  SESSAO_DESCONECTADA: '⚠️',
}

const TITLE: Record<AlertJobData['event'], string> = {
  FALHOU_DEFINITIVO: 'Falha definitiva de entrega',
  NUMERO_BANIDO: 'Número WhatsApp banido',
  SESSAO_DESCONECTADA: 'Sessão WhatsApp desconectada',
}

function buildMessage(data: AlertJobData): string {
  const lines = [
    `${EMOJI[data.event]} <b>Herald — ${TITLE[data.event]}</b>`,
    '',
    data.message,
  ]
  if (data.targetId) {
    lines.push(`\n🆔 <code>${data.targetId}</code>`)
  }
  return lines.join('\n')
}

async function processAlert(data: AlertJobData): Promise<void> {
  const { event, organizationId, message, targetId } = data

  // Find the org's first active Telegram channel (provides the bot token)
  const telegramChannel = await prisma.channel.findFirst({
    where: {
      organizationId,
      type: ChannelType.TELEGRAM,
      status: ChannelStatus.ACTIVE,
    },
  })

  if (!telegramChannel) {
    console.warn(
      `[alert:worker] Org ${organizationId} sem canal Telegram ativo — alerta "${event}" ignorado`
    )
    return
  }

  const raw = telegramChannel.credentials as { encrypted: string }
  const credentials = JSON.parse(decrypt(raw.encrypted)) as TelegramCredentials

  // Recipients: OWNER (any org, monitors all) + SUPER_ADMIN/ADMIN of this org
  const recipients = await prisma.user.findMany({
    where: {
      telegramId: { not: null },
      active: true,
      OR: [
        { role: UserRole.OWNER },
        {
          organizationId,
          role: { in: [UserRole.SUPER_ADMIN, UserRole.ADMIN] },
        },
      ],
    },
    select: { telegramId: true, name: true },
  })

  if (recipients.length === 0) {
    console.warn(
      `[alert:worker] Nenhum usuário com telegramId para alerta "${event}" (org ${organizationId})`
    )
    return
  }

  const text = buildMessage(data)

  // Deduplicate in case OWNER also belongs to the org
  const seen = new Set<string>()
  for (const user of recipients) {
    if (!user.telegramId || seen.has(user.telegramId)) continue
    seen.add(user.telegramId)

    await sendViaTelegram(credentials, user.telegramId, text).catch((err) =>
      console.error(
        `[alert:worker] Falha ao enviar alerta para ${user.name} (${user.telegramId}):`,
        err.message
      )
    )
  }

  console.log(
    `[alert:worker] Alerta "${event}" enviado para ${seen.size} destinatário(s) ` +
      `(org ${organizationId}${targetId ? `, target: ${targetId}` : ''})`
  )
}

export function startAlertWorker() {
  const worker = new Worker<AlertJobData>(
    'alerts',
    async (job) => {
      console.log(`[alert:worker] Job ${job.id} — evento: ${job.data.event}`)
      await processAlert(job.data)
    },
    { connection: redis, concurrency: 2 }
  )

  worker.on('completed', (job) => {
    console.log(`[alert:worker] Job ${job.id} concluído`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[alert:worker] Job ${job?.id} falhou:`, err.message)
  })

  return worker
}
