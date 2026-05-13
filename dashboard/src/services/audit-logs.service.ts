import { api } from '@/services/api'
import { AuditLogEntry, PaginatedResponse } from '@/types/api.types'

interface AuditLogParams {
  page?: number
  limit?: number
  action?: string
  targetType?: string
}

export async function listAuditLogs(
  params: AuditLogParams
): Promise<PaginatedResponse<AuditLogEntry>> {
  const query: Record<string, unknown> = {
    page: params.page ?? 1,
    limit: params.limit ?? 50,
  }
  if (params.action?.trim())     query.action     = params.action.trim()
  if (params.targetType?.trim()) query.targetType = params.targetType.trim()

  const { data } = await api.get<PaginatedResponse<AuditLogEntry>>('/audit-logs', { params: query })
  return data
}
