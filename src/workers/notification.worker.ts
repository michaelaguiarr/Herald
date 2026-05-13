import 'dotenv/config'
import { Worker } from 'bullmq'
import { NotificationStatus } from '@prisma/client'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { selectChannels } from '../channels/channel-selector'
import { dispatch } from '../channels/channel.dispatcher'
import { enqueueAlert } from '../alerts/alert.service'
import { writeAuditLog } from '../lib/audit'
import { WhatsAppNumberNotFoundError, OptOutError } from '../channels/whatsapp/whatsapp-errors'
import type { NotificationJobData } from '../queues/notification.queue'

// 3 retry cycles after the initial attempt: +1h → +6h → +24h
const MAX_RETRY_CYCLES = 3

const RETRY_DELAYS_MS = [
  1 * 60 * 60 * 1000,   // cycle 1: +1h
  6 * 60 * 60 * 1000,   // cycle 2: +6h
  24 * 60 * 60 * 1000,  // cycle 3: +24h
]

/**
 * Processes one notification delivery attempt.
 *
 * Pool rotation: iterates ALL eligible channels in LRU order within a single
 * execution. Only if every channel fails does the job throw (triggering a
 * BullMQ retry with the configured backoff delay).
 *
 * Retry cycles: driven by job.attemptsMade (0 = initial, 1/2/3 = retries).
 * On the final attempt (attemptsMade >= MAX_RETRY_CYCLES), sets FALHOU_DEFINITIVO
 * and returns (no throw) so BullMQ marks the job as completed, not failed.
 */
async function processNotification(notificationId: string, attemptsMade: number): Promise<void> {
  const notification = await prisma.notification.findUnique({
    where: { id: notificationId },
  })

  if (!notification) {
    console.warn(`[worker] Notificação ${notificationId} não encontrada`)
    return
  }

  // AGENDADO jobs fire via delayed BullMQ — promote to PENDENTE before processing
  if (notification.status === NotificationStatus.AGENDADO) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.PENDENTE },
    })
    notification.status = NotificationStatus.PENDENTE
  }

  // Idempotency: skip if already processed by a concurrent worker
  if (notification.status !== NotificationStatus.PENDENTE) {
    console.log(`[worker] Notificação ${notificationId} já processada (${notification.status})`)
    return
  }

  const isLastAttempt = attemptsMade >= MAX_RETRY_CYCLES

  // opt-out check is inside selectChannels — catch OptOutError here as terminal
  let channels: Awaited<ReturnType<typeof selectChannels>>
  try {
    channels = await selectChannels(
      notification.organizationId,
      notification.channelType,
      { recipientPhone: notification.recipientPhone }
    )
  } catch (err) {
    if (err instanceof OptOutError) {
      console.warn(`[worker] OPT-OUT ${notificationId}: ${err.phone}`)
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: NotificationStatus.FALHOU_DEFINITIVO, retryCycle: attemptsMade },
      })
      enqueueAlert(
        'FALHOU_DEFINITIVO',
        notification.organizationId,
        `Notificação para <b>${notification.recipientName}</b> não entregue: ` +
          `número ${err.phone} optou por não receber notificações.`,
        notificationId
      )
      writeAuditLog({
        userId: null,
        organizationId: notification.organizationId,
        action: 'NOTIFICATION_FALHOU_DEFINITIVO',
        targetId: notificationId,
        targetType: 'notification',
        metadata: {
          retryCycle: attemptsMade,
          channelType: notification.channelType,
          reason: 'opt_out',
          phone: err.phone,
          actor: 'system:notification_worker',
        },
      }).catch((e) => console.error('[worker] Falha ao gravar audit_log opt-out:', e))
      return  // clean return — no throw, no BullMQ retry
    }
    throw err  // other selectChannels errors propagate normally
  }

  if (channels.length === 0) {

    // Debt: no NotificationAttempt record here (channelId FK is required).
    // Tracked in CLAUDE.md: "notification_attempt sem canal disponível".
    if (isLastAttempt) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { status: NotificationStatus.FALHOU_DEFINITIVO, retryCycle: attemptsMade },
      })
      enqueueAlert(
        'FALHOU_DEFINITIVO',
        notification.organizationId,
        `Notificação para <b>${notification.recipientName}</b> falhou definitivamente.\n` +
          `Canal: ${notification.channelType} | Motivo: sem canal elegível após ${attemptsMade} ciclo(s).`,
        notificationId
      )
      writeAuditLog({
        userId: null,
        organizationId: notification.organizationId,
        action: 'NOTIFICATION_FALHOU_DEFINITIVO',
        targetId: notificationId,
        targetType: 'notification',
        metadata: {
          retryCycle: attemptsMade,
          channelType: notification.channelType,
          reason: 'sem_canal_elegivel',
          actor: 'system:notification_worker',
        },
      }).catch((err) => console.error('[worker] Falha ao gravar audit_log FALHOU_DEFINITIVO:', err))
    } else {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { retryCycle: attemptsMade + 1 },
      })
      throw new Error(`Nenhum canal ${notification.channelType} elegível`)
    }
    return
  }

  // ── Pool rotation ──────────────────────────────────────────────────────────
  const attemptedAt = new Date()
  let deliveredChannelId: string | null = null
  let whatsappMessageId: string | undefined = undefined
  let lastError: string | null = null

  for (const channel of channels) {
    try {
      const result = await dispatch(channel, notification)
      deliveredChannelId = channel.id
      whatsappMessageId = result.whatsappMessageId
      break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`[worker] Canal ${channel.id} (${channel.type}) falhou: ${lastError}`)

      // Record the failed attempt and update lastUsedAt for LRU ordering
      await prisma.$transaction([
        prisma.notificationAttempt.create({
          data: {
            notificationId,
            channelId: channel.id,
            attemptedAt,
            success: false,
            errorMessage: lastError,
          },
        }),
        prisma.channel.update({
          where: { id: channel.id },
          data: { lastUsedAt: attemptedAt },
        }),
      ])

      // Terminal error — recipient not on WhatsApp. No other channel or retry
      // will fix this. Mark FALHOU_DEFINITIVO immediately without throwing,
      // so BullMQ sees the job as completed (not failed) and skips retry.
      if (err instanceof WhatsAppNumberNotFoundError) {
        console.warn(`[worker] TERMINAL ${notificationId}: ${lastError}`)
        await prisma.notification.update({
          where: { id: notificationId },
          data: { status: NotificationStatus.FALHOU_DEFINITIVO, retryCycle: attemptsMade },
        })
        enqueueAlert(
          'FALHOU_DEFINITIVO',
          notification.organizationId,
          `Notificação para <b>${notification.recipientName}</b> não entregue: ` +
            `número ${err.phone} não existe no WhatsApp.`,
          notificationId
        )
        writeAuditLog({
          userId: null,
          organizationId: notification.organizationId,
          action: 'NOTIFICATION_FALHOU_DEFINITIVO',
          targetId: notificationId,
          targetType: 'notification',
          metadata: {
            retryCycle: attemptsMade,
            channelType: notification.channelType,
            reason: 'numero_nao_existe_no_whatsapp',
            phone: err.phone,
            actor: 'system:notification_worker',
          },
        }).catch((e) => console.error('[worker] Falha ao gravar audit_log:', e))
        return  // clean return — no throw, no BullMQ retry
      }
    }
  }

  // ── Outcome ────────────────────────────────────────────────────────────────
  if (deliveredChannelId) {
    await prisma.$transaction([
      prisma.notificationAttempt.create({
        data: {
          notificationId,
          channelId: deliveredChannelId,
          attemptedAt,
          success: true,
          errorMessage: null,
          // WhatsApp only: save Baileys key.id for delivery receipt tracking
          ...(whatsappMessageId && {
            whatsappMessageId,
            deliveryStatus: 'SERVER_ACK',  // initial status — advances via messages.update events
          }),
        },
      }),
      prisma.notification.update({
        where: { id: notificationId },
        data: {
          status: NotificationStatus.ENVIADO,
          sentAt: attemptedAt,
          retryCycle: attemptsMade,
        },
      }),
      prisma.channel.update({
        where: { id: deliveredChannelId },
        data: { lastUsedAt: attemptedAt, sentToday: { increment: 1 } },
      }),
    ])
    return
  }

  // All channels in the pool failed this execution
  if (isLastAttempt) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { status: NotificationStatus.FALHOU_DEFINITIVO, retryCycle: attemptsMade },
    })
    console.error(
      `[worker] FALHOU_DEFINITIVO ${notificationId}: todos os canais falharam ` +
        `após ${attemptsMade} ciclo(s) de retry`
    )
    enqueueAlert(
      'FALHOU_DEFINITIVO',
      notification.organizationId,
      `Notificação para <b>${notification.recipientName}</b> falhou definitivamente.\n` +
        `Canal: ${notification.channelType} | Todos os canais falharam após ${attemptsMade} ciclo(s).\n` +
        `Último erro: ${lastError}`,
      notificationId
    )
    writeAuditLog({
      userId: null,
      organizationId: notification.organizationId,
      action: 'NOTIFICATION_FALHOU_DEFINITIVO',
      targetId: notificationId,
      targetType: 'notification',
      metadata: {
        retryCycle: attemptsMade,
        channelType: notification.channelType,
        reason: 'todos_canais_falharam',
        lastError,
        actor: 'system:notification_worker',
      },
    }).catch((err) => console.error('[worker] Falha ao gravar audit_log FALHOU_DEFINITIVO:', err))
  } else {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { retryCycle: attemptsMade + 1 },
    })
    throw new Error(
      `Todos os canais ${notification.channelType} falharam no ciclo ${attemptsMade}: ${lastError}`
    )
  }
}

export function startNotificationWorker() {
  const worker = new Worker<NotificationJobData>(
    'notifications',
    async (job) => {
      console.log(
        `[worker] Job ${job.id} — notificação ${job.data.notificationId} ` +
          `(ciclo ${job.attemptsMade}/${MAX_RETRY_CYCLES})`
      )
      await processNotification(job.data.notificationId, job.attemptsMade)
    },
    {
      connection: redis,
      concurrency: 5,
      settings: {
        // Custom backoff delays mirror the 3-cycle retry schedule (+1h/+6h/+24h).
        // attemptsMade is the number of attempts already made (1 after first failure).
        backoffStrategy: (attemptsMade: number) => {
          return RETRY_DELAYS_MS[attemptsMade - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]
        },
      },
    }
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} concluído`)
  })

  worker.on('failed', (job, err) => {
    const cycle = job?.attemptsMade ?? 0
    const maxCycles = job?.opts.attempts ?? MAX_RETRY_CYCLES + 1
    if (cycle < maxCycles - 1) {
      const nextDelay = RETRY_DELAYS_MS[cycle - 1]
      const delayStr = nextDelay ? `${nextDelay / 3_600_000}h` : '?'
      console.log(
        `[worker] Job ${job?.id} agendado para retry em +${delayStr} (ciclo ${cycle}/${MAX_RETRY_CYCLES}): ${err.message}`
      )
    } else {
      console.error(`[worker] Job ${job?.id} exauriu retries: ${err.message}`)
    }
  })

  return worker
}

