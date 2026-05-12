import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { OrgType, UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { requireRole, buildOrgFilter } from '../middlewares/scope-guard'
import { writeAuditLog } from '../../lib/audit'

const organizationShape = z.object({
  id: z.string(),
  name: z.string(),
  type: z.nativeEnum(OrgType),
  parentId: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.date(),
})

export async function organizationsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.post(
    '/organizations',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER)],
      schema: {
        tags: ['Organizations'],
        summary: 'Criar organização (paróquia ou comunidade)',
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(2),
          type: z.nativeEnum(OrgType),
          parentId: z.string().uuid().nullable().optional(),
        }),
        response: {
          201: organizationShape,
        },
      },
    },
    async (request, reply) => {
      const { name, type, parentId } = request.body

      if (type === OrgType.COMUNIDADE) {
        if (!parentId) throw new AppError(400, 'Comunidade deve ter uma paróquia pai')
        const parent = await prisma.organization.findUnique({ where: { id: parentId } })
        if (!parent || parent.type !== OrgType.PAROQUIA || !parent.active) {
          throw new AppError(400, 'Paróquia pai não encontrada ou inativa')
        }
      }

      if (type === OrgType.PAROQUIA && parentId) {
        throw new AppError(400, 'Paróquia não pode ter organização pai')
      }

      const org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: { name, type, parentId: parentId ?? null },
        })
        await writeAuditLog(
          {
            userId: request.user.sub,
            organizationId: created.id,
            action: 'ORGANIZATION_CREATED',
            targetId: created.id,
            targetType: 'organization',
            metadata: { name, type, parentId },
            ipAddress: request.ip,
          },
          tx
        )
        return created
      })

      return reply.status(201).send(org)
    }
  )

  f.get(
    '/organizations',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Organizations'],
        summary: 'Listar organizações (filtrado por escopo)',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(organizationShape),
        },
      },
    },
    async (request, reply) => {
      const filter = buildOrgFilter(request.user)
      const orgs = await prisma.organization.findMany({
        where: { ...filter, active: true },
        orderBy: [{ type: 'asc' }, { name: 'asc' }],
      })
      return reply.send(orgs)
    }
  )

  f.get(
    '/organizations/:id',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Organizations'],
        summary: 'Buscar organização por ID',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: organizationShape,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const filter = buildOrgFilter(request.user)

      const org = await prisma.organization.findFirst({
        where: { AND: [{ id }, filter, { active: true }] },
      })
      if (!org) throw new AppError(404, 'Organização não encontrada')

      return reply.send(org)
    }
  )

  f.put(
    '/organizations/:id',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN)],
      schema: {
        tags: ['Organizations'],
        summary: 'Atualizar organização',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(2).optional(),
        }),
        response: {
          200: organizationShape,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const org = await prisma.organization.findUnique({ where: { id, active: true } })
      if (!org) throw new AppError(404, 'Organização não encontrada')

      if (actor.role === UserRole.SUPER_ADMIN) {
        const allowed =
          org.id === actor.organizationId || org.parentId === actor.organizationId
        if (!allowed) throw new AppError(403, 'Sem permissão para editar esta organização')
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.organization.update({
          where: { id },
          data: request.body,
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: id,
            action: 'ORGANIZATION_UPDATED',
            targetId: id,
            targetType: 'organization',
            metadata: request.body,
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
    '/organizations/:id',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER)],
      schema: {
        tags: ['Organizations'],
        summary: 'Desativar organização (soft delete)',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params

      const org = await prisma.organization.findUnique({ where: { id, active: true } })
      if (!org) throw new AppError(404, 'Organização não encontrada')

      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id }, data: { active: false } })
        await writeAuditLog(
          {
            userId: request.user.sub,
            organizationId: id,
            action: 'ORGANIZATION_DELETED',
            targetId: id,
            targetType: 'organization',
            ipAddress: request.ip,
          },
          tx
        )
      })

      return reply.send({ message: 'Organização desativada com sucesso.' })
    }
  )
}
