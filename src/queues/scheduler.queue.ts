import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface SchedulerJobData {
  task: 'daily-reset-sent-today'
}

export const schedulerQueue = new Queue<SchedulerJobData>('scheduler', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
})
