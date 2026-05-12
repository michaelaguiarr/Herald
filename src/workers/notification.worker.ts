import 'dotenv/config'
import { Worker } from 'bullmq'
import { ChannelType, NotificationStatus } from '@prisma/client'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { decrypt } from '../lib/crypto'
import { sendViaEmail, EmailCredentials } from '../channels/email/nodemailer.client'
import type { NotificationJobData } from '../queues/notification.queue'

async function processNotification(notificationId: string) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  })

  if (!notification) {
    console.warn(`[worker] Notificação ${notificationId} não encontrada`)
    return
  }

  // Idempotency: skip if already processed
  if (notification.status !== NotificationStatus.PENDENTE) {
    console.log(`[worker] Notificação ${notificationId} já processada (${notification.status})`)
    return
  }

  const channel = await prisma.channel.findFirst({
    where: {
      organizationId: notification.organizationId,
      type: notification.channelType,
      status: 'ACTIVE',
    },
    orderBy: { lastUsedAt: 'asc' }, // prefer least recently used
  })

  if (!channel) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.FALHOU },
    })
    console.error(
      `[worker] Nenhum canal ${notification.channelType} ativo para org ${notification.organizationId}`
    )
    return
  }

  const attemptedAt = new Date()
  let success = false
  let errorMessage: string | null = null

  try {
    if (notification.channelType === ChannelType.EMAIL) {
      const raw = channel.credentials as { encrypted: string }
      const credentials = JSON.parse(decrypt(raw.encrypted)) as EmailCredentials

      if (!notification.recipientEmail) {
        throw new Error('recipientEmail ausente para canal EMAIL')
      }

      await sendViaEmail(
        credentials,
        notification.recipientEmail,
        notification.recipientName,
        notification.message
      )
      success = true
    } else {
      // WhatsApp and Telegram handled in Phase 3/4
      throw new Error(`Canal ${notification.channelType} ainda não implementado`)
    }
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[worker] Falha ao entregar notificação ${notificationId}:`, errorMessage)
  }

  await prisma.$transaction([
    prisma.notificationAttempt.create({
      data: {
        notificationId,
        channelId: channel.id,
        attemptedAt,
        success,
        errorMessage,
      },
    }),
    prisma.notification.update({
      where: { id: notificationId },
      data: {
        status: success ? NotificationStatus.ENVIADO : NotificationStatus.FALHOU,
        sentAt: success ? attemptedAt : null,
      },
    }),
    prisma.channel.update({
      where: { id: channel.id },
      data: {
        lastUsedAt: attemptedAt,
        ...(success && { sentToday: { increment: 1 } }),
      },
    }),
  ])
}

export function startNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    'notifications',
    async (job) => {
      console.log(`[worker] Processando job ${job.id} — notificação ${job.data.notificationId}`)
      await processNotification(job.data.notificationId)
    },
    {
      connection: redis,
      concurrency: 5,
    }
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} concluído`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} falhou:`, err.message)
  })

  return worker
}

// Allow running as a standalone process: npx tsx src/workers/notification.worker.ts
if (require.main === module) {
  startNotificationWorker()
  console.log('[worker] Notification worker iniciado como processo independente')
}
