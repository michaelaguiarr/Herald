import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ChannelStatus, ChannelType, NotificationStatus, UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter } from '../middlewares/scope-guard'

function periodStart(period: 'today' | '7d' | '30d'): Date {
  if (period === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }
  const days = period === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

export async function dashboardRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  // ── GET /dashboard/summary ──────────────────────────────────────────────

  f.get(
    '/dashboard/summary',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR),
      ],
      schema: {
        tags: ['Dashboard'],
        summary: 'Resumo de métricas filtrado por escopo do perfil',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          period: z.enum(['today', '7d', '30d']).default('7d'),
        }),
        response: {
          200: z.object({
            period: z.string(),
            totalNotifications: z.number(),
            byStatus: z.array(z.object({ status: z.string(), count: z.number() })),
            byChannel: z.array(z.object({ channelType: z.string(), count: z.number() })),
            channels: z.array(z.object({ status: z.string(), count: z.number() })),
            deliveryRate: z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { period } = request.query
      const since = periodStart(period)
      const orgFilter = await buildEntityOrgFilter(request.user)

      const notifWhere = { ...orgFilter, createdAt: { gte: since } }
      const channelWhere = { ...orgFilter, status: { not: ChannelStatus.INACTIVE } }

      // Count notifications by each status
      const notifStatuses = Object.values(NotificationStatus)
      const channelStatuses = [
        ChannelStatus.ACTIVE, ChannelStatus.WARMING,
        ChannelStatus.DISCONNECTED, ChannelStatus.BANNED,
      ] as const

      const channelTypes = Object.values(ChannelType)

      const [statusCounts, channelTypeCounts, channelStatusCounts] = await Promise.all([
        Promise.all(
          notifStatuses.map(async (status) => ({
            status,
            count: await prisma.notification.count({ where: { ...notifWhere, status } }),
          }))
        ),
        Promise.all(
          channelTypes.map(async (channelType) => ({
            channelType,
            count: await prisma.notification.count({ where: { ...notifWhere, channelType } }),
          }))
        ),
        Promise.all(
          channelStatuses.map(async (status) => ({
            status,
            count: await prisma.channel.count({ where: { ...channelWhere, status } }),
          }))
        ),
      ])

      const statusMap = Object.fromEntries(statusCounts.map((s) => [s.status, s.count]))
      const totalNotifications = statusCounts.reduce((a, s) => a + s.count, 0)
      const delivered = statusMap[NotificationStatus.ENVIADO] ?? 0
      const failed =
        (statusMap[NotificationStatus.FALHOU] ?? 0) +
        (statusMap[NotificationStatus.FALHOU_DEFINITIVO] ?? 0)
      const deliveryRate =
        delivered + failed > 0
          ? Math.round((delivered / (delivered + failed)) * 1000) / 10
          : 0

      return reply.send({
        period,
        totalNotifications,
        byStatus: statusCounts.filter((s) => s.count > 0),
        byChannel: channelTypeCounts.filter((c) => c.count > 0),
        channels: channelStatusCounts.filter((c) => c.count > 0),
        deliveryRate,
      })
    }
  )

  // ── GET /dashboard/failed ───────────────────────────────────────────────

  f.get(
    '/dashboard/failed',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR),
      ],
      schema: {
        tags: ['Dashboard'],
        summary: 'Fila de notificações com falha definitiva (FALHOU_DEFINITIVO)',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(20),
          channelType: z.nativeEnum(ChannelType).optional(),
        }),
        response: {
          200: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                organizationId: z.string(),
                channelType: z.string(),
                recipientName: z.string(),
                recipientPhone: z.string().nullable(),
                recipientEmail: z.string().nullable(),
                message: z.string(),
                retryCycle: z.number(),
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
      const { page, limit, channelType } = request.query
      const orgFilter = await buildEntityOrgFilter(request.user)
      const skip = (page - 1) * limit

      const where = {
        ...orgFilter,
        status: NotificationStatus.FALHOU_DEFINITIVO,
        ...(channelType && { channelType }),
      }

      const [data, total] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
          select: {
            id: true,
            organizationId: true,
            channelType: true,
            recipientName: true,
            recipientPhone: true,
            recipientEmail: true,
            message: true,
            retryCycle: true,
            createdAt: true,
          },
        }),
        prisma.notification.count({ where }),
      ])

      return reply.send({ data, total, page, pages: Math.ceil(total / limit) })
    }
  )
}
