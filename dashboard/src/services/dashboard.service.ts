import { api } from '@/services/api'
import {
  DashboardSummary, DashboardPeriod, FailedQueueResponse, FailureReason,
} from '@/types/api.types'

export async function getDashboardSummary(period: DashboardPeriod): Promise<DashboardSummary> {
  const { data } = await api.get<DashboardSummary>('/dashboard/summary', { params: { period } })
  return data
}

export async function getFailedQueue(
  page = 1,
  limit = 20,
  channelType?: string,
  failureReason?: FailureReason | ''
): Promise<FailedQueueResponse> {
  const params: Record<string, unknown> = { page, limit }
  if (channelType)   params.channelType   = channelType
  if (failureReason) params.failureReason = failureReason
  const { data } = await api.get<FailedQueueResponse>('/dashboard/failed', { params })
  return data
}
