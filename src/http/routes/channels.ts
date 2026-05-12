import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { ChannelStatus, ChannelType, UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { encrypt, decrypt } from '../../lib/crypto'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildEntityOrgFilter, assertOrgAccess } from '../middlewares/scope-guard'
import { writeAuditLog } from '../../lib/audit'

const credentialsEmailSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(1),
})

const channelShape = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: z.nativeEnum(ChannelType),
  label: z.string(),
  status: z.nativeEnum(ChannelStatus),
  dailyLimit: z.number(),
  hourlyLimit: z.number(),
  sentToday: z.number(),
  lastUsedAt: z.date().nullable(),
  createdAt: z.date(),
})

export async function channelsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.post(
    '/channels',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Channels'],
        summary: 'Criar canal',
        security: [{ bearerAuth: [] }],
        body: z.object({
          organizationId: z.string().uuid(),
          type: z.nativeEnum(ChannelType),
          label: z.string().min(2),
          credentials: z.record(z.unknown()),
          dailyLimit: z.number().int().min(1).default(200),
          hourlyLimit: z.number().int().min(1).default(30),
        }),
        response: { 201: channelShape },
      },
    },
    async (request, reply) => {
      const { organizationId, type, label, credentials, dailyLimit, hourlyLimit } = request.body
      const actor = request.user

      await assertOrgAccess(actor, organizationId)

      if (type === ChannelType.EMAIL) {
        credentialsEmailSchema.parse(credentials)
      }

      const encryptedCredentials = { encrypted: encrypt(JSON.stringify(credentials)) }

      const channel = await prisma.$transaction(async (tx) => {
        const created = await tx.channel.create({
          data: {
            organizationId,
            type,
            label,
            credentials: encryptedCredentials,
            dailyLimit,
            hourlyLimit,
          },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'CHANNEL_CREATED',
            targetId: created.id,
            targetType: 'channel',
            metadata: { type, label, organizationId },
            ipAddress: request.ip,
          },
          tx
        )
        return created
      })

      return reply.status(201).send(channel)
    }
  )

  f.get(
    '/channels',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Channels'],
        summary: 'Listar canais (filtrado por escopo)',
        security: [{ bearerAuth: [] }],
        response: { 200: z.array(channelShape) },
      },
    },
    async (request, reply) => {
      const filter = await buildEntityOrgFilter(request.user)
      const channels = await prisma.channel.findMany({
        where: { ...(filter as object), status: { not: ChannelStatus.INACTIVE } },
        orderBy: [{ type: 'asc' }, { label: 'asc' }],
      })
      return reply.send(channels)
    }
  )

  f.get(
    '/channels/:id',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Channels'],
        summary: 'Buscar canal por ID',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: channelShape },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const filter = await buildEntityOrgFilter(request.user)
      const channel = await prisma.channel.findFirst({
        where: { id, ...(filter as object), status: { not: ChannelStatus.INACTIVE } },
      })
      if (!channel) throw new AppError(404, 'Canal não encontrado')
      return reply.send(channel)
    }
  )

  f.put(
    '/channels/:id',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Channels'],
        summary: 'Atualizar canal',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          label: z.string().min(2).optional(),
          credentials: z.record(z.unknown()).optional(),
          dailyLimit: z.number().int().min(1).optional(),
          hourlyLimit: z.number().int().min(1).optional(),
          status: z
            .enum([ChannelStatus.ACTIVE, ChannelStatus.INACTIVE])
            .optional(),
        }),
        response: { 200: channelShape },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const channel = await prisma.channel.findUnique({ where: { id } })
      if (!channel || channel.status === ChannelStatus.INACTIVE) {
        throw new AppError(404, 'Canal não encontrado')
      }

      await assertOrgAccess(actor, channel.organizationId)

      const { credentials, ...rest } = request.body

      let credentialsUpdate: { encrypted: string } | undefined
      if (credentials) {
        if (channel.type === ChannelType.EMAIL) {
          credentialsEmailSchema.parse(credentials)
        }
        credentialsUpdate = { encrypted: encrypt(JSON.stringify(credentials)) }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.channel.update({
          where: { id },
          data: {
            ...rest,
            ...(credentialsUpdate && { credentials: credentialsUpdate }),
          },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'CHANNEL_UPDATED',
            targetId: id,
            targetType: 'channel',
            metadata: { ...rest, credentialsUpdated: !!credentials },
            ipAddress: request.ip,
          },
          tx
        )
        return result
      })

      return reply.send(updated)
    }
  )

  f.delete(
    '/channels/:id',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Channels'],
        summary: 'Desativar canal (soft delete)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const channel = await prisma.channel.findUnique({ where: { id } })
      if (!channel || channel.status === ChannelStatus.INACTIVE) {
        throw new AppError(404, 'Canal não encontrado')
      }

      await assertOrgAccess(actor, channel.organizationId)

      await prisma.$transaction(async (tx) => {
        await tx.channel.update({ where: { id }, data: { status: ChannelStatus.INACTIVE } })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'CHANNEL_DELETED',
            targetId: id,
            targetType: 'channel',
            ipAddress: request.ip,
          },
          tx
        )
      })

      return reply.send({ message: 'Canal desativado com sucesso.' })
    }
  )

  // Endpoint to expose decrypted credentials for debugging (OWNER only, dev only)
  f.get(
    '/channels/:id/credentials',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER)],
      schema: {
        tags: ['Channels'],
        summary: '[Dev] Exibir credenciais descriptografadas',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ credentials: z.record(z.unknown()) }) },
      },
    },
    async (request, reply) => {
      if (process.env.NODE_ENV === 'production') {
        throw new AppError(403, 'Não disponível em produção')
      }
      const channel = await prisma.channel.findUnique({ where: { id: request.params.id } })
      if (!channel) throw new AppError(404, 'Canal não encontrado')
      const raw = channel.credentials as { encrypted: string }
      return reply.send({ credentials: JSON.parse(decrypt(raw.encrypted)) })
    }
  )
}
