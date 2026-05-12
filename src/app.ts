import fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { serializerCompiler, validatorCompiler, jsonSchemaTransform } from 'fastify-type-provider-zod'
import { env } from './lib/env'
import { errorHandler } from './http/errors/handler'
import { authRoutes } from './http/routes/auth'
import { organizationsRoutes } from './http/routes/organizations'
import { usersRoutes } from './http/routes/users'
import { channelsRoutes } from './http/routes/channels'
import { notificationsRoutes } from './http/routes/notifications'
import { startNotificationWorker } from './workers/notification.worker'
import { startAlertWorker } from './workers/alert.worker'
import { startSchedulerWorker, registerDailyJobs } from './workers/scheduler.worker'
import { whatsappSessionManager } from './channels/whatsapp/session.manager'

export async function buildApp() {
  const app = fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        env.NODE_ENV !== 'production'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  })

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(cors, { origin: true })

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  })

  await app.register(jwt, {
    secret: env.JWT_SECRET,
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Herald API',
        description: 'Serviço de notificações multi-canal',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  })

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  })

  app.setErrorHandler(errorHandler)

  await app.register(authRoutes, { prefix: '/v1' })
  await app.register(organizationsRoutes, { prefix: '/v1' })
  await app.register(usersRoutes, { prefix: '/v1' })
  await app.register(channelsRoutes, { prefix: '/v1' })
  await app.register(notificationsRoutes, { prefix: '/v1' })

  startNotificationWorker()
  startAlertWorker()
  startSchedulerWorker()
  registerDailyJobs().catch((err) =>
    app.log.error({ err }, '[scheduler] Falha ao registrar crons diários')
  )

  // Restore WhatsApp sessions for existing WARMING/ACTIVE/DISCONNECTED channels
  whatsappSessionManager.initialize().catch((err) =>
    app.log.error({ err }, '[wa:manager] Falha ao inicializar sessões WhatsApp')
  )

  return app
}
