import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { OrgType, UserRole } from '@prisma/client'
import bcrypt from 'bcrypt'
import { prisma } from '../../lib/prisma'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { requireRole } from '../middlewares/scope-guard'
import { writeAuditLog } from '../../lib/audit'

const userShape = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.nativeEnum(UserRole),
  organizationId: z.string().nullable(),
  telegramId: z.string().nullable(),
  active: z.boolean(),
  lastLoginAt: z.date().nullable(),
  createdAt: z.date(),
})

// Validates that the creator can create a user with the given role and organizationId
async function validateCreationRules(
  creator: { role: UserRole; organizationId: string | null },
  targetRole: UserRole,
  targetOrgId: string | null
) {
  if (creator.role === UserRole.OWNER) {
    if (targetRole === UserRole.OWNER) {
      if (targetOrgId !== null)
        throw new AppError(400, 'Usuário OWNER não pertence a uma organização')
      return
    }
    if (targetRole === UserRole.SUPER_ADMIN) {
      if (!targetOrgId) throw new AppError(400, 'SUPER_ADMIN deve pertencer a uma paróquia')
      const org = await prisma.organization.findUnique({ where: { id: targetOrgId } })
      if (!org || org.type !== OrgType.PAROQUIA || !org.active)
        throw new AppError(400, 'Paróquia não encontrada ou inativa')
      return
    }
    throw new AppError(403, 'OWNER só pode criar usuários OWNER ou SUPER_ADMIN')
  }

  if (creator.role === UserRole.SUPER_ADMIN) {
    if (targetRole !== UserRole.ADMIN)
      throw new AppError(403, 'SUPER_ADMIN só pode criar usuários ADMIN')
    if (!targetOrgId) throw new AppError(400, 'ADMIN deve pertencer a uma comunidade')
    const org = await prisma.organization.findUnique({ where: { id: targetOrgId } })
    if (!org || org.type !== OrgType.COMUNIDADE || !org.active)
      throw new AppError(400, 'Comunidade não encontrada ou inativa')
    if (org.parentId !== creator.organizationId)
      throw new AppError(403, 'Comunidade não pertence à sua paróquia')
    return
  }

  if (creator.role === UserRole.ADMIN) {
    if (targetRole !== UserRole.OPERATOR)
      throw new AppError(403, 'ADMIN só pode criar usuários OPERATOR')
    if (targetOrgId !== creator.organizationId)
      throw new AppError(403, 'Você só pode criar usuários na sua própria comunidade')
    return
  }

  throw new AppError(403, 'Sem permissão para criar usuários')
}

export async function usersRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.get(
    '/users',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN)],
      schema: {
        tags: ['Users'],
        summary: 'Listar usuários (filtrado por escopo)',
        security: [{ bearerAuth: [] }],
        response: {
          200: z.array(userShape),
        },
      },
    },
    async (request, reply) => {
      const actor = request.user

      let where: Record<string, unknown> = { active: true }

      if (actor.role === UserRole.SUPER_ADMIN) {
        // Sees users in their parish and all its communities
        const communities = await prisma.organization.findMany({
          where: { parentId: actor.organizationId!, active: true },
          select: { id: true },
        })
        const orgIds = [actor.organizationId!, ...communities.map((c) => c.id)]
        where = { active: true, organizationId: { in: orgIds } }
      } else if (actor.role === UserRole.ADMIN) {
        where = { active: true, organizationId: actor.organizationId }
      }

      const users = await prisma.user.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true,
          telegramId: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
        },
      })

      return reply.send(users)
    }
  )

  f.get(
    '/users/:id',
    {
      onRequest: [authenticate, requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN)],
      schema: {
        tags: ['Users'],
        summary: 'Buscar usuário por ID',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: {
          200: userShape,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const user = await prisma.user.findUnique({
        where: { id, active: true },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          organizationId: true,
          telegramId: true,
          active: true,
          lastLoginAt: true,
          createdAt: true,
        },
      })

      if (!user) throw new AppError(404, 'Usuário não encontrado')

      // Scope validation
      if (actor.role === UserRole.ADMIN && user.organizationId !== actor.organizationId) {
        throw new AppError(403, 'Acesso negado')
      }
      if (actor.role === UserRole.SUPER_ADMIN) {
        if (user.organizationId !== actor.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: user.organizationId ?? '' },
          })
          if (org?.parentId !== actor.organizationId) throw new AppError(403, 'Acesso negado')
        }
      }

      return reply.send(user)
    }
  )

  f.post(
    '/users',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Users'],
        summary: 'Criar usuário',
        security: [{ bearerAuth: [] }],
        body: z.object({
          name: z.string().min(2),
          email: z.string().email(),
          password: z.string().min(8),
          role: z.nativeEnum(UserRole),
          organizationId: z.string().uuid().nullable().optional(),
          telegramId: z.string().optional(),
        }),
        response: {
          201: userShape,
        },
      },
    },
    async (request, reply) => {
      const { name, email, password, role, organizationId, telegramId } = request.body
      const actor = request.user

      await validateCreationRules(actor, role, organizationId ?? null)

      const existing = await prisma.user.findUnique({ where: { email } })
      if (existing) throw new AppError(409, 'Email já cadastrado')

      const passwordHash = await bcrypt.hash(password, 12)

      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            role,
            organizationId: organizationId ?? null,
            telegramId: telegramId ?? null,
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            organizationId: true,
            telegramId: true,
            active: true,
            lastLoginAt: true,
            createdAt: true,
          },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'USER_CREATED',
            targetId: created.id,
            targetType: 'user',
            metadata: { name, email, role, organizationId },
            ipAddress: request.ip,
          },
          tx
        )
        return created
      })

      return reply.status(201).send(user)
    }
  )

  f.put(
    '/users/:id',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Users'],
        summary: 'Atualizar usuário',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        body: z.object({
          name: z.string().min(2).optional(),
          telegramId: z.string().nullable().optional(),
        }),
        response: {
          200: userShape,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      const target = await prisma.user.findUnique({ where: { id, active: true } })
      if (!target) throw new AppError(404, 'Usuário não encontrado')

      // Scope validation
      if (actor.role === UserRole.ADMIN && target.organizationId !== actor.organizationId) {
        throw new AppError(403, 'Acesso negado')
      }
      if (actor.role === UserRole.SUPER_ADMIN) {
        if (target.organizationId !== actor.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: target.organizationId ?? '' },
          })
          if (org?.parentId !== actor.organizationId) throw new AppError(403, 'Acesso negado')
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.user.update({
          where: { id },
          data: {
            name: request.body.name,
            telegramId: request.body.telegramId,
          },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            organizationId: true,
            telegramId: true,
            active: true,
            lastLoginAt: true,
            createdAt: true,
          },
        })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'USER_UPDATED',
            targetId: id,
            targetType: 'user',
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
    '/users/:id',
    {
      onRequest: [
        authenticate,
        requireRole(UserRole.OWNER, UserRole.SUPER_ADMIN, UserRole.ADMIN),
      ],
      schema: {
        tags: ['Users'],
        summary: 'Desativar usuário (soft delete)',
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

      if (id === actor.sub) throw new AppError(400, 'Você não pode desativar sua própria conta')

      const target = await prisma.user.findUnique({ where: { id, active: true } })
      if (!target) throw new AppError(404, 'Usuário não encontrado')

      // Only OWNER can deactivate another OWNER
      if (target.role === UserRole.OWNER && actor.role !== UserRole.OWNER) {
        throw new AppError(403, 'Sem permissão para desativar este usuário')
      }

      // Scope validation
      if (actor.role === UserRole.ADMIN && target.organizationId !== actor.organizationId) {
        throw new AppError(403, 'Acesso negado')
      }
      if (actor.role === UserRole.SUPER_ADMIN) {
        if (target.organizationId !== actor.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: target.organizationId ?? '' },
          })
          if (org?.parentId !== actor.organizationId) throw new AppError(403, 'Acesso negado')
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { active: false } })
        await writeAuditLog(
          {
            userId: actor.sub,
            organizationId: actor.organizationId,
            action: 'USER_DELETED',
            targetId: id,
            targetType: 'user',
            ipAddress: request.ip,
          },
          tx
        )
      })

      return reply.send({ message: 'Usuário desativado com sucesso.' })
    }
  )
}
