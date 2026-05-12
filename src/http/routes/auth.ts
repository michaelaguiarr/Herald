import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { randomUUID } from 'crypto'
import { prisma } from '../../lib/prisma'
import { sendPasswordResetEmail } from '../../lib/mailer'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { writeAuditLog } from '../../lib/audit'

export async function authRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  f.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login',
        body: z.object({
          email: z.string().email(),
          password: z.string().min(1),
        }),
        response: {
          200: z.object({
            token: z.string(),
            user: z.object({
              id: z.string(),
              name: z.string(),
              email: z.string(),
              role: z.string(),
              organizationId: z.string().nullable(),
            }),
          }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.active) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      const passwordMatch = await bcrypt.compare(password, user.passwordHash)
      if (!passwordMatch) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      })

      await writeAuditLog({
        userId: user.id,
        organizationId: user.organizationId,
        action: 'USER_LOGIN',
        targetId: user.id,
        targetType: 'user',
        ipAddress: request.ip,
      })

      const token = fastify.jwt.sign(
        {
          sub: user.id,
          role: user.role,
          organizationId: user.organizationId,
          name: user.name,
        },
        { expiresIn: '8h' }
      )

      return reply.send({
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organizationId,
        },
      })
    }
  )

  f.post(
    '/auth/forgot-password',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Solicitar redefinição de senha',
        body: z.object({
          email: z.string().email(),
        }),
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body

      // Always return 200 to avoid email enumeration
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.active) {
        return reply.send({ message: 'Se o email existir, você receberá as instruções em breve.' })
      }

      const token = randomUUID()
      const exp = new Date(Date.now() + 60 * 60 * 1000) // 1h

      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: token, resetTokenExp: exp },
      })

      await sendPasswordResetEmail(email, token)

      return reply.send({ message: 'Se o email existir, você receberá as instruções em breve.' })
    }
  )

  f.post(
    '/auth/reset-password',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Redefinir senha via token',
        body: z.object({
          token: z.string().uuid(),
          password: z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
        }),
        response: {
          200: z.object({ message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const { token, password } = request.body

      const user = await prisma.user.findFirst({
        where: {
          resetToken: token,
          resetTokenExp: { gt: new Date() },
          active: true,
        },
      })

      if (!user) {
        throw new AppError(400, 'Token inválido ou expirado')
      }

      const passwordHash = await bcrypt.hash(password, 12)

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, resetToken: null, resetTokenExp: null },
      })

      await writeAuditLog({
        userId: user.id,
        organizationId: user.organizationId,
        action: 'USER_PASSWORD_RESET',
        targetId: user.id,
        targetType: 'user',
        ipAddress: request.ip,
      })

      return reply.send({ message: 'Senha redefinida com sucesso.' })
    }
  )

  // Admin-triggered password reset (sends reset email to target user)
  f.post(
    '/users/:id/reset-password',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Forçar redefinição de senha de um usuário',
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

      // OPERATOR cannot reset passwords
      if (actor.role === 'OPERATOR') {
        throw new AppError(403, 'Sem permissão para esta ação')
      }

      const target = await prisma.user.findUnique({ where: { id } })
      if (!target || !target.active) {
        throw new AppError(404, 'Usuário não encontrado')
      }

      // Scope: ADMIN can only reset users in their own community
      // SUPER_ADMIN can reset users in their parish and its communities
      // OWNER can reset anyone
      if (actor.role === 'ADMIN') {
        if (target.organizationId !== actor.organizationId) {
          throw new AppError(403, 'Sem permissão para redefinir senha deste usuário')
        }
      } else if (actor.role === 'SUPER_ADMIN') {
        if (target.organizationId !== actor.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: target.organizationId ?? '' },
          })
          if (org?.parentId !== actor.organizationId) {
            throw new AppError(403, 'Sem permissão para redefinir senha deste usuário')
          }
        }
      }

      const token = randomUUID()
      const exp = new Date(Date.now() + 60 * 60 * 1000)

      await prisma.user.update({
        where: { id: target.id },
        data: { resetToken: token, resetTokenExp: exp },
      })

      await sendPasswordResetEmail(target.email, token)

      await writeAuditLog({
        userId: actor.sub,
        organizationId: actor.organizationId,
        action: 'USER_FORCE_PASSWORD_RESET',
        targetId: target.id,
        targetType: 'user',
        ipAddress: request.ip,
      })

      return reply.send({ message: 'Email de redefinição enviado para o usuário.' })
    }
  )
}
