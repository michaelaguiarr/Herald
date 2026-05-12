import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface NotificationJobData {
  notificationId: string
}

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: redis,
  defaultJobOptions: {
    attempts: 4,                 // 1 initial + 3 retry cycles (+1h / +6h / +24h)
    backoff: { type: 'custom' }, // delays defined in the worker's backoffStrategy
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
})
