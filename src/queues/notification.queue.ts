import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface NotificationJobData {
  notificationId: string
}

export const notificationQueue = new Queue<NotificationJobData>('notifications', {
  connection: redis,
  defaultJobOptions: {
    attempts: 1,       // Phase 4 adds retry cycles (1h/6h/24h)
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
})
