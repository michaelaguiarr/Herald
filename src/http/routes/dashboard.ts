import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ChannelStatus, ChannelType, NotificationStatus, UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter } from '../middlewares/scope-guard'
import { getJidCacheStats } from '../../lib/whatsapp-jid.cache'

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
            jidCacheStats: z.object({ hits: z.number(), misses: z.number() }),
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

      const [statusCounts, channelTypeCounts, channelStatusCounts, jidCacheStats] = await Promise.all([
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
        getJidCacheStats(),
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
        jidCacheStats,
      })
    }
  )

  // ── GET /dashboard/failed ───────────────────────────────────────────────

  const FAILURE_REASONS = ['OPT_OUT', 'NUMBER_NOT_FOUND', 'DELIVERY_FAILURE', 'NO_CHANNEL'] as const
  type FailureReason = typeof FAILURE_REASONS[number]

  function classifyFailure(
    n: { retryCycle: number; recipientPhone: string | null; organizationId: string },
    attempts: { success: boolean; errorMessage: string | null }[],
    optOutSet: Set<string>
  ): FailureReason {
    // 1. Opt-out — phone is in the opt_out table for this org
    if (n.recipientPhone && optOutSet.has(`${n.recipientPhone}:${n.organizationId}`)) {
      return 'OPT_OUT'
    }
    // 2. No attempts were created (no eligible channel found, not opt-out)
    if (attempts.length === 0) return 'NO_CHANNEL'

    const lastErr = attempts[0]?.errorMessage ?? ''

    // 3. Number not on WhatsApp (WhatsAppNumberNotFoundError path)
    if (lastErr.includes('não encontrado no WhatsApp')) return 'NUMBER_NOT_FOUND'

    // 4. Fallback — exhausted retry cycles from connection / delivery errors
    return 'DELIVERY_FAILURE'
  }

  const attemptShape = z.object({
    id: z.string(),
    channelId: z.string(),
    attemptedAt: z.date(),
    success: z.boolean(),
    errorMessage: z.string().nullable(),
    whatsappMessageId: z.string().nullable(),
    deliveryStatus: z.string().nullable(),
  })

  const failedItemShape = z.object({
    id: z.string(),
    organizationId: z.string(),
    channelType: z.string(),
    recipientName: z.string(),
    recipientPhone: z.string().nullable(),
    recipientEmail: z.string().nullable(),
    message: z.string(),
    retryCycle: z.number(),
    createdAt: z.date(),
    failureReason: z.enum(FAILURE_REASONS),
    attempts: z.array(attemptShape),
  })

  const summaryShape = z.object({
    OPT_OUT: z.number(),
    NUMBER_NOT_FOUND: z.number(),
    DELIVERY_FAILURE: z.number(),
    NO_CHANNEL: z.number(),
  })

  f.get(
    '/dashboard/failed',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR),
      ],
      schema: {
        tags: ['Dashboard'],
        summary: 'Fila de notificações com falha definitiva — com categorização de motivo',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          page:          z.coerce.number().int().min(1).default(1),
          limit:         z.coerce.number().int().min(1).max(100).default(20),
          channelType:   z.nativeEnum(ChannelType).optional(),
          failureReason: z.enum(FAILURE_REASONS).optional(),
        }),
        response: {
          200: z.object({
            summary: summaryShape,
            data:    z.array(failedItemShape),
            total:   z.number(),
            page:    z.number(),
            pages:   z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { page, limit, channelType, failureReason } = request.query
      const orgFilter = await buildEntityOrgFilter(request.user)

      const where = {
        ...orgFilter,
        status: NotificationStatus.FALHOU_DEFINITIVO,
        ...(channelType && { channelType }),
      }

      // Fetch ALL qualifying notifications with their attempts in one query.
      // Classification is computed in-memory; pagination is applied after filtering.
      const allNotifs = await prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
          attempts: {
            orderBy: { attemptedAt: 'desc' },
            select: {
              id: true,
              channelId: true,
              attemptedAt: true,
              success: true,
              errorMessage: true,
              whatsappMessageId: true,
              deliveryStatus: true,
            },
          },
        },
      })

      // Batch-load opt-outs for the phones present in this result set.
      const phoneOrgPairs = allNotifs
        .filter((n) => n.recipientPhone)
        .map((n) => ({ phone: n.recipientPhone!, organizationId: n.organizationId }))

      const optOuts = phoneOrgPairs.length > 0
        ? await prisma.optOut.findMany({
            where: { OR: phoneOrgPairs },
            select: { phone: true, organizationId: true },
          })
        : []
      const optOutSet = new Set(optOuts.map((o) => `${o.phone}:${o.organizationId}`))

      // Classify every item
      const classified = allNotifs.map((n) => ({
        ...n,
        failureReason: classifyFailure(n, n.attempts, optOutSet),
      }))

      // Build summary across the full unfiltered set
      const summary: Record<FailureReason, number> = {
        OPT_OUT: 0, NUMBER_NOT_FOUND: 0, DELIVERY_FAILURE: 0, NO_CHANNEL: 0,
      }
      for (const item of classified) summary[item.failureReason]++

      // Apply failureReason filter (if requested) then paginate
      const filtered = failureReason
        ? classified.filter((n) => n.failureReason === failureReason)
        : classified

      const total = filtered.length
      const skip  = (page - 1) * limit
      const data  = filtered.slice(skip, skip + limit)

      return reply.send({ summary, data, total, page, pages: Math.ceil(total / limit) })
    }
  )
}
