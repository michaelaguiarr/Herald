import { FastifyInstance } from 'fastify'
import { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'
import bcrypt from 'bcrypt'
import { randomUUID, createHash, randomBytes } from 'crypto'
import { prisma } from '../../lib/prisma'
import { env } from '../../lib/env'
import { sendPasswordResetEmail } from '../../lib/mailer'
import { AppError } from '../errors/app-error'
import { authenticate } from '../middlewares/authenticate'
import { writeAuditLog } from '../../lib/audit'

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000   // 30 days
const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60          // 30 days (for maxAge)
const REFRESH_COOKIE_PATH = '/v1/auth/refresh'

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function generateRefreshToken() {
  const raw = randomBytes(32).toString('hex')
  const hash = hashToken(raw)
  const exp = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  return { raw, hash, exp }
}

const userShape = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.string(),
  organizationId: z.string().nullable(),
})

export async function authRoutes(fastify: FastifyInstance) {
  const f = fastify.withTypeProvider<ZodTypeProvider>()

  // ── POST /auth/login ──────────────────────────────────────────────────────

  f.post(
    '/auth/login',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Login — retorna access token (8h) e seta refresh token em cookie httpOnly (30d)',
        body: z.object({
          email: z.string().email(),
          password: z.string().min(1),
        }),
        response: {
          200: z.object({ token: z.string(), user: userShape }),
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body

      const user = await prisma.user.findUnique({ where: { email } })
      if (!user || !user.active) throw new AppError(401, 'Credenciais inválidas')

      const passwordMatch = await bcrypt.compare(password, user.passwordHash)
      if (!passwordMatch) throw new AppError(401, 'Credenciais inválidas')

      const { raw, hash, exp } = generateRefreshToken()

      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          refreshTokenHash: hash,
          refreshTokenExp: exp,
        },
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
        { sub: user.id, role: user.role, organizationId: user.organizationId, name: user.name },
        { expiresIn: '8h' }
      )

      reply.setCookie('refreshToken', raw, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_TOKEN_TTL_SEC,
      })

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

  // ── POST /auth/refresh ────────────────────────────────────────────────────

  f.post(
    '/auth/refresh',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Renovar access token via refresh token (cookie httpOnly)',
        description:
          'Lê o cookie `refreshToken` (httpOnly, path `/v1/auth/refresh`), verifica o hash SHA-256 e ' +
          'a expiração no banco, emite um novo access token JWT e **rotaciona** o refresh token ' +
          '(invalida o anterior, emite novo cookie). Retorna 401 se o cookie estiver ausente, ' +
          'inválido ou expirado.',
        response: {
          200: z.object({ token: z.string(), user: userShape }),
        },
      },
    },
    async (request, reply) => {
      const rawToken = request.cookies?.refreshToken
      if (!rawToken) throw new AppError(401, 'Refresh token ausente')

      const tokenHash = hashToken(rawToken)

      const user = await prisma.user.findFirst({
        where: {
          refreshTokenHash: tokenHash,
          refreshTokenExp: { gt: new Date() },
          active: true,
        },
      })

      if (!user) throw new AppError(401, 'Refresh token inválido ou expirado')

      // Rotate: issue new refresh token, invalidate the previous one
      const { raw: newRaw, hash: newHash, exp: newExp } = generateRefreshToken()

      await prisma.user.update({
        where: { id: user.id },
        data: { refreshTokenHash: newHash, refreshTokenExp: newExp },
      })

      reply.setCookie('refreshToken', newRaw, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: REFRESH_COOKIE_PATH,
        maxAge: REFRESH_TOKEN_TTL_SEC,
      })

      const token = fastify.jwt.sign(
        { sub: user.id, role: user.role, organizationId: user.organizationId, name: user.name },
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

  // ── POST /auth/logout ─────────────────────────────────────────────────────

  f.post(
    '/auth/logout',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Logout — invalida o refresh token no banco e limpa o cookie',
        security: [{ bearerAuth: [] }],
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      const userId = request.user.sub
      if (userId) {
        await prisma.user.update({
          where: { id: userId },
          data: { refreshTokenHash: null, refreshTokenExp: null },
        })
      }

      reply.clearCookie('refreshToken', { path: REFRESH_COOKIE_PATH })

      return reply.send({ message: 'Logout efetuado com sucesso.' })
    }
  )

  // ── POST /auth/change-password ───────────────────────────────────────────

  f.post(
    '/auth/change-password',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Auth'],
        summary: 'Alterar senha do usuário autenticado',
        security: [{ bearerAuth: [] }],
        body: z.object({
          currentPassword: z.string().min(1),
          newPassword: z.string().min(8, 'A nova senha deve ter pelo menos 8 caracteres'),
          confirmPassword: z.string().min(1),
        }),
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword, confirmPassword } = request.body
      const userId = request.user.sub
      if (!userId) throw new AppError(401, 'Não autorizado')

      if (newPassword !== confirmPassword) {
        throw new AppError(400, 'Nova senha e confirmação não coincidem')
      }

      if (newPassword === currentPassword) {
        throw new AppError(400, 'A nova senha não pode ser igual à senha atual')
      }

      const user = await prisma.user.findUnique({ where: { id: userId } })
      if (!user || !user.active) throw new AppError(404, 'Usuário não encontrado')

      const passwordMatch = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!passwordMatch) throw new AppError(400, 'Senha atual incorreta')

      const passwordHash = await bcrypt.hash(newPassword, 12)

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      })

      await writeAuditLog({
        userId: user.id,
        organizationId: user.organizationId,
        action: 'USER_CHANGED_PASSWORD',
        targetId: user.id,
        targetType: 'user',
        ipAddress: request.ip,
      })

      return reply.send({ message: 'Senha alterada com sucesso.' })
    }
  )

  // ── POST /auth/forgot-password ────────────────────────────────────────────

  f.post(
    '/auth/forgot-password',
    {
      schema: {
        tags: ['Auth'],
        summary: 'Solicitar redefinição de senha',
        body: z.object({ email: z.string().email() }),
        response: { 200: z.object({ message: z.string() }) },
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

  // ── POST /auth/reset-password ─────────────────────────────────────────────

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
        response: { 200: z.object({ message: z.string() }) },
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

      if (!user) throw new AppError(400, 'Token inválido ou expirado')

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

  // ── POST /users/:id/reset-password (admin-triggered) ─────────────────────

  f.post(
    '/users/:id/reset-password',
    {
      onRequest: [authenticate],
      schema: {
        tags: ['Users'],
        summary: 'Forçar redefinição de senha de um usuário',
        security: [{ bearerAuth: [] }],
        params: z.object({ id: z.string().uuid() }),
        response: { 200: z.object({ message: z.string() }) },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const actor = request.user

      if (actor.role === 'OPERATOR') throw new AppError(403, 'Sem permissão para esta ação')

      const target = await prisma.user.findUnique({ where: { id } })
      if (!target || !target.active) throw new AppError(404, 'Usuário não encontrado')

      if (actor.role === 'ADMIN') {
        if (target.organizationId !== actor.organizationId)
          throw new AppError(403, 'Sem permissão para redefinir senha deste usuário')
      } else if (actor.role === 'SUPER_ADMIN') {
        if (target.organizationId !== actor.organizationId) {
          const org = await prisma.organization.findUnique({
            where: { id: target.organizationId ?? '' },
          })
          if (org?.parentId !== actor.organizationId)
            throw new AppError(403, 'Sem permissão para redefinir senha deste usuário')
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
