import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

interface AuditParams {
  /** null for system-generated events (worker, session manager, cron jobs) */
  userId: string | null
  organizationId?: string | null
  action: string
  targetId?: string | null
  targetType?: string | null
  metadata?: Record<string, unknown>
  ipAddress?: string | null
}

export async function writeAuditLog(
  params: AuditParams,
  tx?: Prisma.TransactionClient
) {
  const client = tx ?? prisma
  await client.auditLog.create({
    data: {
      userId: params.userId ?? null,
      organizationId: params.organizationId ?? null,
      action: params.action,
      targetId: params.targetId ?? null,
      targetType: params.targetType ?? null,
      metadata: (params.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      ipAddress: params.ipAddress ?? null,
    },
  })
}
