import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

export async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        description: 'Verifica se a API está operacional',
        tags: ['System'],
        response: {
          200: z.object({
            status: z.literal('ok'),
            timestamp: z.string(),
            uptime: z.number(),
          }),
        },
      },
    },
    async (_request, reply) => {
      return reply.status(200).send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
      })
    },
  )
}