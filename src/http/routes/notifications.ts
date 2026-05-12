import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ChannelType, NotificationStatus, UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter, assertOrgAccess } from '../middlewares/scope-guard'
import { notificationQueue } from '../../queues/notification.queue'
import { writeAuditLog } from '../../lib/audit'

const notificationShape = z.object({
  id: z.string(),
  organizationId: z.string(),
  channelType: z.nativeEnum(ChannelType),
  recipientName: z.string(),
  recipientPhone: z.string().nullable(),
  recipientEmail: z.string().nullable(),
  recipientTelegramId: z.string().nullable(),
  message: z.string(),
  status: z.nativeEnum(NotificationStatus),
  scheduledAt: z.date().nullable(),
  sentAt: z.date().nullable(),
  retryCycle: z.number(),
  createdAt: z.date(),
})

const attemptShape = z.object({
  id: z.string(),
  channelId: z.string(),
  attemptedAt: z.date(),
  success: z.boolean(),
  errorMessage: z.string().nullable(),
})

export async function notificationsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  // Called by the external API (Phase 5 adds X-Api-Key; for now, JWT with ADMIN+)
  f.post(
    '/notifications/send',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Notifications'],
        summary: 'Enfileirar notificação para entrega imediata',
        security: [{ bearerAuth: [] }],
        body: z.object({
          organizationId: z.string().uuid(),
          channelType: z.nativeEnum(ChannelType),
          recipientName: z.string().min(1),
          recipientPhone: z.string().optional(),
          recipientEmail: z.string().email().optional(),
          recipientTelegramId: z.string().optional(),
          message: z.string().min(1),
        }),
        response: { 202: notificationShape },
      },
    },
    async (request, reply) => {
      const {
        organizationId,
        channelType,
        recipientName,
        recipientPhone,
        recipientEmail,
        recipientTelegramId,
        message,
      } = request.body
      const actor = request.user

      await assertOrgAccess(actor, organizationId)

      // Validate recipient fields per channel type
      if (channelType === ChannelType.EMAIL && !recipientEmail) {
        throw new AppError(400, 'recipientEmail é obrigatório para canal EMAIL')
      }
      if (channelType === ChannelType.WHATSAPP && !recipientPhone) {
        throw new AppError(400, 'recipientPhone é obrigatório para canal WHATSAPP')
      }
      if (channelType === ChannelType.TELEGRAM && !recipientTelegramId) {
        throw new AppError(400, 'recipientTelegramId é obrigatório para canal TELEGRAM')
      }

      const notification = await prisma.$transaction(async (tx) => {
        const created = await tx.notification.create({
          data: {
            organizationId,
            channelType,
            recipientName,
            recipientPhone: recipientPhone ?? null,
            recipientEmail: recipientEmail ?? null,
            recipientTelegramId: recipientTelegramId ?? null,
            message,
            status: NotificationStatus.PENDENTE,
          },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'NOTIFICATION_QUEUED',
            targetId: created.id,
            targetType: 'notification',
            metadata: { channelType, recipientName, organizationId },
            ipAddress: request.ip,
          },
          tx
        )
        return created
      })

      await notificationQueue.add('send', { notificationId: notification.id })

      return reply.status(202).send(notification)
    }
  )

  f.get(
    '/notifications',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'Listar notificações (filtrado por escopo)',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          status: z.nativeEnum(NotificationStatus).optional(),
          channelType: z.nativeEnum(ChannelType).optional(),
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            data: z.array(notificationShape),
            total: z.number(),
            page: z.number(),
            pages: z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { status, channelType, page, limit } = request.query
      const filter = await buildEntityOrgFilter(request.user)
      const skip = (page - 1) * limit

      const where = {
        ...(filter as object),
        ...(status && { status }),
        ...(channelType && { channelType }),
      }

      const [data, total] = await prisma.$transaction([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.notification.count({ where }),
      ])

      return reply.send({ data, total, page, pages: Math.ceil(total / limit) })
    }
  )

  f.get(
    '/notifications/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Notifications'],
        summary: 'Buscar notificação por ID com tentativas',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: notificationShape.extend({
            attempts: z.array(attemptShape),
          }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const filter = await buildEntityOrgFilter(request.user)

      const notification = await prisma.notification.findFirst({
        where: { id, ...(filter as object) },
        include: {
          attempts: {
            orderBy: { attemptedAt: 'desc' },
            select: {
              id: true,
              channelId: true,
              attemptedAt: true,
              success: true,
              errorMessage: true,
            },
          },
        },
      })

      if (!notification) throw new AppError(404, 'Notificação não encontrada')

      return reply.send(notification)
    }
  )

  // Reenvio manual (Phase 4 adds retry cycles; this resets to PENDENTE and re-enqueues)
  f.post(
    '/notifications/:id/retry',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.OPERATOR),
      ],
      schema: {
        tags: ['Notifications'],
        summary: 'Reenviar notificação manualmente',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 202: notificationShape },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user
      const filter = await buildEntityOrgFilter(actor)

      const notification = await prisma.notification.findFirst({
        where: { id, ...(filter as object) },
      })

      if (!notification) throw new AppError(404, 'Notificação não encontrada')

      const retryableStatuses: NotificationStatus[] = [
        NotificationStatus.FALHOU,
        NotificationStatus.FALHOU_DEFINITIVO,
        NotificationStatus.ENVIADO, // ENVIADO garante apenas que o Baileys não lançou erro,
                                    // não que o destinatário recebeu — operador pode forçar reenvio
      ]

      if (!retryableStatuses.includes(notification.status)) {
        throw new AppError(
          400,
          `Não é possível reenviar uma notificação com status ${notification.status}. ` +
            `Status permitidos: ${retryableStatuses.join(', ')}`
        )
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.notification.update({
          where: { id },
          data: { status: NotificationStatus.PENDENTE, retryCycle: 0 },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'NOTIFICATION_MANUAL_RETRY',
            targetId: id,
            targetType: 'notification',
            ipAddress: request.ip,
          },
          tx
        )
        return result
      })

      await notificationQueue.add('send', { notificationId: id })

      return reply.status(202).send(updated)
    }
  )
}
