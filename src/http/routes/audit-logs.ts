import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter } from '../middlewares/scope-guard'

export async function auditLogsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.get(
    '/audit-logs',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Audit'],
        summary: 'Listar audit log filtrado por escopo do perfil',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          action: z.string().optional(),
          targetType: z.string().optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                userId: z.string().nullable(),
                organizationId: z.string().nullable(),
                action: z.string(),
                targetId: z.string().nullable(),
                targetType: z.string().nullable(),
                metadata: z.unknown().nullable(),
                ipAddress: z.string().nullable(),
                createdAt: z.date(),
              })
            ),
            total: z.number(),
            page: z.number(),
            pages: z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { action, targetType, page, limit } = request.query
      const orgFilter = await buildEntityOrgFilter(request.user)
      const skip = (page - 1) * limit

      // Map OrgScopeFilter (on notification/channel) to AuditLog's organizationId field
      const orgWhere =
        orgFilter.organizationId !== undefined
          ? { organizationId: orgFilter.organizationId }
          : {}  // OWNER: no filter

      const where = {
        ...orgWhere,
        ...(action && { action: { contains: action, mode: 'insensitive' as const } }),
        ...(targetType && { targetType }),
      }

      const [data, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.auditLog.count({ where }),
      ])

      return reply.send({ data, total, page, pages: Math.ceil(total / limit) })
    }
  )
}
