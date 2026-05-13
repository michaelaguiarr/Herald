import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { OrgType, UserRole } from '@prisma/client'
import { randomBytes, createHash } from 'crypto'
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

function assertOrgScope(
  actor: { role: string; organizationId: string | null },
  org: { id: string; parentId: string | null },
  message = 'Sem permissão para esta ação'
): void {
  if (actor.role === UserRole.OWNER) return
  if (actor.role === UserRole.SUPER_ADMIN) {
    const inScope = org.id === actor.organizationId || org.parentId === actor.organizationId
    if (!inScope) throw new AppError(403, message)
  }
}

export async function organizationsRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.post(
    '/organizations',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN)],
      schema: {
        tags: ['Organizations'],
        summary: 'Criar organização — OWNER: qualquer tipo; SUPER_ADMIN: apenas FILIAL dentro da própria organização',
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
      const actor = request.user

      if (actor.role === UserRole.SUPER_ADMIN) {
        if (type !== OrgType.FILIAL) {
          throw new AppError(403, 'SUPER_ADMIN só pode criar filiais')
        }
        if (!parentId) {
          throw new AppError(400, 'Filial deve ter uma organização pai')
        }
        const parent = await prisma.organization.findUnique({ where: { id: parentId, active: true } })
        if (!parent) throw new AppError(400, 'Organização pai não encontrada ou inativa')
        const inScope =
          parent.id === actor.organizationId || parent.parentId === actor.organizationId
        if (!inScope) throw new AppError(403, 'Sem permissão para criar filial nesta organização')
        if (parent.type !== OrgType.ORGANIZACAO) {
          throw new AppError(400, 'Organização pai não encontrada ou inativa')
        }
      } else {
        if (type === OrgType.FILIAL) {
          if (!parentId) throw new AppError(400, 'Filial deve ter uma organização pai')
          const parent = await prisma.organization.findUnique({ where: { id: parentId } })
          if (!parent || parent.type !== OrgType.ORGANIZACAO || !parent.active) {
            throw new AppError(400, 'Organização pai não encontrada ou inativa')
          }
        }
        if (type === OrgType.ORGANIZACAO && parentId) {
          throw new AppError(400, 'Organização raiz não pode ter organização pai')
        }
      }

      const org = await prisma.$transaction(async (tx) => {
        const created = await tx.organization.create({
          data: { name, type, parentId: parentId ?? null },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
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

      assertOrgScope(actor, org, 'Sem permissão para editar esta organização')

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
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN)],
      schema: {
        tags: ['Organizations'],
        summary: 'Desativar organização (soft delete) — SUPER_ADMIN só pode desativar filiais do seu escopo',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const org = await prisma.organization.findUnique({ where: { id, active: true } })
      if (!org) throw new AppError(404, 'Organização não encontrada')

      if (actor.role === UserRole.SUPER_ADMIN && org.type === OrgType.ORGANIZACAO) {
        throw new AppError(403, 'Apenas o dono do sistema pode desativar uma organização')
      }

      assertOrgScope(actor, org, 'Sem permissão para desativar esta organização')

      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id }, data: { active: false } })
        await writeAuditLog(
          {
            userId: actor.sub,
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

  // ── API Key endpoints ──────────────────────────────────────────────────────

  f.post(
    '/organizations/:id/api-key',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN)],
      schema: {
        tags: ['Organizations'],
        summary: 'Gerar (ou regen) API Key para a organização',
        description:
          'Retorna a chave gerada **apenas uma vez** — guarde-a imediatamente. ' +
          'Para revogar, chame DELETE /organizations/:id/api-key.',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ apiKey: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const org = await prisma.organization.findUnique({ where: { id, active: true } })
      if (!org) throw new AppError(404, 'Organização não encontrada')

      assertOrgScope(actor, org, 'Sem permissão para gerenciar API Key desta organização')

      const rawKey = `hld_${randomBytes(32).toString('hex')}`
      const hashedKey = createHash('sha256').update(rawKey).digest('hex')

      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id }, data: { apiKey: hashedKey } })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: id,
            action: 'ORGANIZATION_API_KEY_GENERATED',
            targetId: id,
            targetType: 'organization',
            ipAddress: request.ip,
          },
          tx
        )
      })

      return reply.send({ apiKey: rawKey })
    }
  )

  f.delete(
    '/organizations/:id/api-key',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN)],
      schema: {
        tags: ['Organizations'],
        summary: 'Revogar API Key da organização',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const org = await prisma.organization.findUnique({ where: { id, active: true } })
      if (!org) throw new AppError(404, 'Organização não encontrada')
      if (!org.apiKey) throw new AppError(400, 'Esta organização não possui API Key')

      assertOrgScope(actor, org, 'Sem permissão para gerenciar API Key desta organização')

      await prisma.$transaction(async (tx) => {
        await tx.organization.update({ where: { id }, data: { apiKey: null } })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: id,
            action: 'ORGANIZATION_API_KEY_REVOKED',
            targetId: id,
            targetType: 'organization',
            ipAddress: request.ip,
          },
          tx
        )
      })

      return reply.send({ message: 'API Key revogada com sucesso.' })
    }
  )
}
