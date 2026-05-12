import 'dotenv/config'
import { Worker } from 'bullmq'
import { ChannelStatus, ChannelType } from '@prisma/client'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { env } from '../lib/env'
import { schedulerQueue, type SchedulerJobData } from '../queues/scheduler.queue'

const DAILY_RESET_CRON    = '0 0 * * *'  // midnight
const WARMUP_PROMOTE_CRON = '5 0 * * *'  // 00:05, right after daily reset

/**
 * Registers all repeatable daily jobs via upsertJobScheduler.
 * Idempotent — safe to call on every startup.
 */
export async function registerDailyJobs(): Promise<void> {
  const tz = env.DAILY_RESET_TZ

  await schedulerQueue.upsertJobScheduler(
    'daily-reset-sent-today',
    { pattern: DAILY_RESET_CRON, tz },
    { name: 'daily-reset-sent-today', data: { task: 'daily-reset-sent-today' } }
  )

  await schedulerQueue.upsertJobScheduler(
    'daily-warmup-promote',
    { pattern: WARMUP_PROMOTE_CRON, tz },
    { name: 'daily-warmup-promote', data: { task: 'daily-warmup-promote' } }
  )

  console.log(
    `[scheduler] Crons registrados — reset: ${DAILY_RESET_CRON}, ` +
    `warmup-promote: ${WARMUP_PROMOTE_CRON} (tz: ${tz})`
  )
}

/** @deprecated Use registerDailyJobs instead */
export const registerDailyResetJob = registerDailyJobs

export function startSchedulerWorker() {
  const worker = new Worker<SchedulerJobData>(
    'scheduler',
    async (job) => {
      switch (job.data.task) {

        case 'daily-reset-sent-today': {
          const result = await prisma.channel.updateMany({
            data: { sentToday: 0 },
          })
          console.log(
            `[scheduler] daily-reset: sent_today zerado em ${result.count} canal(is) — ` +
              new Date().toISOString()
          )
          break
        }

        case 'daily-warmup-promote': {
          // Promote WhatsApp channels that have been connected (connectedAt set)
          // for 7+ days — they leave the warm-up period and get full rate limits.
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          const result = await prisma.channel.updateMany({
            where: {
              type: ChannelType.WHATSAPP,
              status: ChannelStatus.WARMING,
              connectedAt: { not: null, lte: sevenDaysAgo },
            },
            data: { status: ChannelStatus.ACTIVE },
          })
          if (result.count > 0) {
            console.log(
              `[scheduler] warmup-promote: ${result.count} canal(is) WhatsApp ` +
                `promovidos WARMING→ACTIVE — ${new Date().toISOString()}`
            )
          }
          break
        }

        default:
          console.warn(`[scheduler] Job desconhecido: ${job.data.task}`)
      }
    },
    { connection: redis, concurrency: 1 }
  )

  worker.on('completed', (job) => {
    console.log(`[scheduler] Job "${job.name}" concluído (id: ${job.id})`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[scheduler] Job "${job?.name}" falhou:`, err.message)
  })

  return worker
}
