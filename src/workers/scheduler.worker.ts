import 'dotenv/config'
import { Worker } from 'bullmq'
import { redis } from '../lib/redis'
import { prisma } from '../lib/prisma'
import { schedulerQueue, type SchedulerJobData } from '../queues/scheduler.queue'

const DAILY_RESET_CRON = '0 0 * * *' // midnight UTC every day

/**
 * Registers the "daily-reset-sent-today" repeatable job via upsertJobScheduler.
 * Idempotent — safe to call on every startup. BullMQ updates the scheduler entry
 * if it already exists rather than creating a duplicate.
 */
export async function registerDailyResetJob(): Promise<void> {
  await schedulerQueue.upsertJobScheduler(
    'daily-reset-sent-today',            // stable scheduler ID
    { pattern: DAILY_RESET_CRON },       // BullMQ v5: cron pattern uses `pattern` field
    {
      name: 'daily-reset-sent-today',
      data: { task: 'daily-reset-sent-today' },
    }
  )
  console.log(`[scheduler] Cron "daily-reset-sent-today" registrado (${DAILY_RESET_CRON} UTC)`)
}

export function startSchedulerWorker() {
  const worker = new Worker<SchedulerJobData>(
    'scheduler',
    async (job) => {
      if (job.name === 'daily-reset-sent-today') {
        const result = await prisma.channel.updateMany({
          data: { sentToday: 0 },
        })
        console.log(
          `[scheduler] daily-reset: sent_today zerado em ${result.count} canal(is) — ` +
            new Date().toISOString()
        )
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
