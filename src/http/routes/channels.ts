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
import { whatsappSessionManager } from '../../channels/whatsapp/session.manager'
import type { WaSessionStatus } from '../../channels/whatsapp/baileys.client'

const credentialsEmailSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().min(1),
  pass: z.string().min(1),
  from: z.string().min(1),
})

const credentialsWhatsappSchema = z.object({
  phoneNumber: z.string().optional(),
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
      } else if (type === ChannelType.WHATSAPP) {
        credentialsWhatsappSchema.parse(credentials)
      }

      const encryptedCredentials = { encrypted: encrypt(JSON.stringify(credentials)) }
      const initialStatus =
        type === ChannelType.WHATSAPP ? ChannelStatus.WARMING : ChannelStatus.ACTIVE

      const channel = await prisma.$transaction(async (tx) => {
        const created = await tx.channel.create({
          data: {
            organizationId,
            type,
            label,
            credentials: encryptedCredentials,
            dailyLimit,
            hourlyLimit,
            status: initialStatus,
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

      if (type === ChannelType.WHATSAPP) {
        whatsappSessionManager.startSession(channel.id).catch((err) =>
          console.error(`[channels] Falha ao iniciar sessão WA ${channel.id}:`, err)
        )
      }

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
        querystring: z.object({
          type: z.nativeEnum(ChannelType).optional(),
        }),
        response: { 200: z.array(channelShape) },
      },
    },
    async (request, reply) => {
      const filter = await buildEntityOrgFilter(request.user)
      const channels = await prisma.channel.findMany({
        where: {
          ...(filter as object),
          status: { not: ChannelStatus.INACTIVE },
          ...(request.query.type && { type: request.query.type }),
        },
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
          status: z.enum([ChannelStatus.ACTIVE, ChannelStatus.INACTIVE]).optional(),
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
        } else if (channel.type === ChannelType.WHATSAPP) {
          credentialsWhatsappSchema.parse(credentials)
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

      if (channel.type === ChannelType.WHATSAPP) {
        await whatsappSessionManager.stopSession(id)
      }

      return reply.send({ message: 'Canal desativado com sucesso.' })
    }
  )

  // ── WhatsApp-specific endpoints ────────────────────────────────────────────

  f.get(
    '/channels/:id/qrcode',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Stream de QR Code via SSE (text/event-stream)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      // Validate before hijacking so Fastify can still return error responses
      const channel = await prisma.channel.findFirst({
        where: { id, type: ChannelType.WHATSAPP, status: { not: ChannelStatus.INACTIVE } },
      })
      if (!channel) throw new AppError(404, 'Canal WhatsApp não encontrado')
      await assertOrgAccess(actor, channel.organizationId)

      reply.hijack()

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sendEvent = (data: object) => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
        }
      }

      // If session isn't loaded yet (e.g. server restart), start it now.
      // startSession() adds the client to the Map synchronously before its first
      // await, so getSession() works right after without waiting.
      if (!whatsappSessionManager.getSession(id)) {
        whatsappSessionManager.startSession(id).catch((err) =>
          console.error(`[qrcode:sse] Falha ao iniciar sessão WA ${id}:`, err)
        )
      }

      // Subscribe to the channel-level emitter — it outlives individual BaileysClient
      // instances, so events keep arriving even after /reconnect replaces the session.
      const emitter = whatsappSessionManager.getChannelEmitter(id)

      // Send current status immediately so the client doesn't have to wait
      const currentSession = whatsappSessionManager.getSession(id)
      sendEvent({ type: 'status', status: currentSession?.status ?? 'WARMING' })

      const qrHandler = (qrData: string) => sendEvent({ type: 'qr', data: qrData })
      const statusHandler = (status: WaSessionStatus) => sendEvent({ type: 'status', status })

      emitter.on('qr', qrHandler)
      emitter.on('status-change', statusHandler)

      const keepAlive = setInterval(() => {
        if (!reply.raw.writableEnded) {
          reply.raw.write(': keep-alive\n\n')
        }
      }, 30_000)

      request.raw.once('close', () => {
        clearInterval(keepAlive)
        emitter.off('qr', qrHandler)
        emitter.off('status-change', statusHandler)
        if (!reply.raw.writableEnded) {
          reply.raw.end()
        }
      })
    }
  )

  f.post(
    '/channels/:id/reconnect',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['WhatsApp'],
        summary: 'Reconectar sessão WhatsApp',
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
      if (channel.type !== ChannelType.WHATSAPP) {
        throw new AppError(400, 'Reconexão disponível apenas para canais WhatsApp')
      }

      await assertOrgAccess(actor, channel.organizationId)

      // Update DB to WARMING so SSE consumers see the state immediately
      await prisma.channel.update({
        where: { id },
        data: { status: ChannelStatus.WARMING },
      })

      // Fire and forget — startSession calls disconnect(false) on existing session
      // so the WARMING status above won't be overwritten by a stale DISCONNECTED event
      whatsappSessionManager.startSession(id).catch((err) =>
        console.error(`[channels] Falha ao reconectar WA ${id}:`, err)
      )

      await writeAuditLog({
        userId: actor.sub,
        organizationId: actor.organizationId,
        action: 'CHANNEL_RECONNECT',
        targetId: id,
        targetType: 'channel',
        ipAddress: request.ip,
      })

      return reply.send({ message: 'Reconexão iniciada. Aguarde o QR Code.' })
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