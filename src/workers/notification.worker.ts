import 'dotenv/config'
import { Worker } from 'bullmq'
import { NotificationStatus } from '@prisma/client'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { selectChannel } from '../channels/channel-selector'
import { dispatch } from '../channels/channel.dispatcher'
import type { NotificationJobData } from '../queues/notification.queue'

async function processNotification(notificationId: string) {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  })

  if (!notification) {
    console.warn(`[worker] Notificação ${notificationId} não encontrada`)
    return
  }

  // Idempotency: skip if already processed by a concurrent worker
  if (notification.status !== NotificationStatus.PENDENTE) {
    console.log(`[worker] Notificação ${notificationId} já processada (${notification.status})`)
    return
  }

  const channel = await selectChannel(notification.organizationId, notification.channelType)

  if (!channel) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.FALHOU },
    })
    console.error(
      `[worker] Nenhum canal ${notification.channelType} elegível para org ${notification.organizationId} ` +
        '(inativo, banido ou limites atingidos)'
    )
    return
  }

  const attemptedAt = new Date()
  let success = false
  let errorMessage: string | null = null

  try {
    await dispatch(channel, notification)
    success = true
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
    { connection: redis, concurrency: 5 }
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
