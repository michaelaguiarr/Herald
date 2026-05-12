import { Queue } from 'bullmq'
import { redis } from '../lib/redis'

export interface AlertJobData {
  event: 'FALHOU_DEFINITIVO' | 'NUMERO_BANIDO' | 'SESSAO_DESCONECTADA'
  organizationId: string
  message: string
  targetId?: string
}

// Implemented in Phase 4
export const alertQueue = new Queue<AlertJobData>('alerts', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1000 },
  },
})
