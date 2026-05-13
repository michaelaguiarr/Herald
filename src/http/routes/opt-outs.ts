import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter } from '../middlewares/scope-guard'

export async function optOutsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  // ── GET /opt-outs ──────────────────────────────────────────────────────────

  f.get(
    '/opt-outs',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN)],
      schema: {
        tags: ['Opt-outs'],
        summary: 'Listar números que optaram por não receber notificações',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          page:  z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            data: z.array(z.object({
              id:             z.string(),
              phone:          z.string(),
              organizationId: z.string(),
              reason:         z.string().nullable(),
              createdAt:      z.date(),
            })),
            total: z.number(),
            page:  z.number(),
            pages: z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { page, limit } = request.query
      const orgFilter = await buildEntityOrgFilter(request.user)
      const skip = (page - 1) * limit

      const [data, total] = await prisma.$transaction([
        prisma.optOut.findMany({
          where: orgFilter,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.optOut.count({ where: orgFilter }),
      ])

      return reply.send({ data, total, page, pages: Math.ceil(total / limit) })
    }
  )

  // ── DELETE /opt-outs/:phone ────────────────────────────────────────────────

  f.delete(
    '/opt-outs/:phone',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN)],
      schema: {
        tags: ['Opt-outs'],
        summary: 'Remover opt-out e reativar número para receber notificações',
        security: [{ bearerAuth: [] }],
        params: z.object({
          phone: z.string().min(8),
        }),
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const phone = request.params.phone.replace(/\D/g, '')
      const orgFilter = await buildEntityOrgFilter(request.user)

      const existing = await prisma.optOut.findFirst({
        where: { phone, ...orgFilter },
      })
      if (!existing) throw new AppError(404, 'Opt-out não encontrado para este número')

      await prisma.optOut.delete({ where: { id: existing.id } })

      return reply.send({ message: `Número +${phone} reativado com sucesso.` })
    }
  )
}
