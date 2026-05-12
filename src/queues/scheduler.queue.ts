import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface SchedulerJobData {
  task: 'daily-reset-sent-today' | 'daily-warmup-promote'
}

export const schedulerQueue = new Queue<SchedulerJobData>('scheduler', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})
