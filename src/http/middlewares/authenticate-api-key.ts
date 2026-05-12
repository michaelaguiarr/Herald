import { FastifyReply, FastifyRequest } from 'fastify'
import { UserRole } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { AppError } from '../errors/app-error'
import { authenticate } from './authenticate'

/**
 * Authenticates via the X-Api-Key header.
 * Sets request.user with sub=null and the org's context.
 * API keys have ADMIN-level access scoped to their own organization.
 */
export async function authenticateApiKey(
  request: FastifyRequest,
  _reply: FastifyReply
): Promise<void> {
  const apiKey = request.headers['x-api-key']
  if (!apiKey || typeof apiKey !== 'string') {
    throw new AppError(401, 'X-Api-Key ausente ou inválida')
  }

  const org = await prisma.organization.findUnique({
    where: { apiKey },
    select: { id: true, active: true, type: true },
  })

  if (!org || !org.active) {
    throw new AppError(401, 'X-Api-Key inválida ou organização inativa')
  }

  // Synthetic user context — sub is null because this is a machine request, not a human.
  // Role = ADMIN so it can send/schedule/broadcast within its own organization.
  request.user = {
    sub: null,
    organizationId: org.id,
    role: UserRole.ADMIN,
    name: 'API Key',
  }
}

/**
 * Accepts EITHER a Bearer JWT token OR an X-Api-Key header.
 * JWT takes precedence; X-Api-Key is used as fallback.
 * Use on endpoints called both by human admins and external services.
 */
export async function authenticateJwtOrApiKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.headers['x-api-key']) {
    return authenticateApiKey(request, reply)
  }
  return authenticate(request, reply)
}
