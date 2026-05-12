import IORedis from 'ioredis'
import { env } from './env'

// maxRetriesPerRequest: null is required by BullMQ — keeps connection alive
export const redis = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
})

redis.on('error', (err) => {
  console.error('[redis] Erro de conexão:', err.message)
})

redis.on('connect', () => {
  console.log('[redis] Conexão estabelecida')
})
