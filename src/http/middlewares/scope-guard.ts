import { FastifyReply, FastifyRequest } from 'fastify'
import { Prisma, UserRole } from '@prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../../lib/prisma'

export function requireRole(...roles: UserRole[]) {
  return async function (request: FastifyRequest, _reply: FastifyReply) {
    if (!roles.includes(request.user.role)) {
      throw new AppError(403, 'Acesso não autorizado para este perfil')
    }
  }
}

// Returns a Prisma-typed WHERE clause for organization-scoped queries.
// Uses '' as fallback for null organizationId so non-matching rows return empty.
export function buildOrgFilter(user: {
  role: UserRole
  organizationId: string | null
}): Prisma.OrganizationWhereInput {
  if (user.role === UserRole.OWNER) {
    return {}
  }
  if (user.role === UserRole.SUPER_ADMIN) {
    const orgId = user.organizationId ?? ''
    return { OR: [{ id: orgId }, { parentId: orgId }] }
  }
  return { id: user.organizationId ?? '' }
}

// Typed filter for org-scoped Prisma queries.
// Using a single optional field makes it safely spreadable without "as object" casts:
//   OWNER: organizationId undefined → Prisma ignores it (returns all rows)
//   ADMIN/OPERATOR: organizationId string → exact match
//   SUPER_ADMIN: organizationId { in: [...] } → matches paróquia + comunidades
// { in: string[] } is structurally compatible with Prisma StringFilter
// (all StringFilter fields are optional), so TypeScript accepts it without casting.
export type OrgScopeFilter = {
  organizationId?: string | { in: string[] }
}

export async function buildEntityOrgFilter(user: {
  role: UserRole
  organizationId: string | null
}): Promise<OrgScopeFilter> {
  if (user.role === UserRole.OWNER) {
    return {}
  }

  if (user.role === UserRole.SUPER_ADMIN) {
    const paroquiaId = user.organizationId ?? ''
    const comunidades = await prisma.organization.findMany({
      where: { parentId: paroquiaId, active: true },
      select: { id: true },
    })
    const orgIds = [paroquiaId, ...comunidades.map((c) => c.id)]
    return { organizationId: { in: orgIds } }
  }

  // ADMIN, OPERATOR — apenas a própria comunidade
  return { organizationId: user.organizationId ?? '' }
}

// Throws if the authenticated user cannot access the given organizationId
export async function assertOrgAccess(
  user: { role: UserRole; organizationId: string | null },
  targetOrgId: string
) {
  if (user.role === UserRole.OWNER) return

  if (user.role === UserRole.SUPER_ADMIN) {
    if (user.organizationId === targetOrgId) return
    const org = await prisma.organization.findUnique({ where: { id: targetOrgId } })
    if (org?.parentId === user.organizationId) return
    throw new AppError(403, 'Acesso negado a esta organização')
  }

  if (user.organizationId !== targetOrgId) {
    throw new AppError(403, 'Acesso negado a esta organização')
  }
}
