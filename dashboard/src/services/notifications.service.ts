import { api } from '@/services/api'
import {
  NotificationItem,
  NotificationDetail,
  NotificationStatus,
  ChannelType,
  PaginatedResponse,
} from '@/types/api.types'

interface ListParams {
  page?: number
  limit?: number
  status?: NotificationStatus | ''
  channelType?: ChannelType | ''
}

export async function listNotifications(params: ListParams): Promise<PaginatedResponse<NotificationItem>> {
  const query: Record<string, unknown> = {
    page: params.page ?? 1,
    limit: params.limit ?? 20,
  }
  if (params.status) query.status = params.status
  if (params.channelType) query.channelType = params.channelType
  const { data } = await api.get<PaginatedResponse<NotificationItem>>('/notifications', { params: query })
  return data
}

export async function getNotification(id: string): Promise<NotificationDetail> {
  const { data } = await api.get<NotificationDetail>(`/notifications/${id}`)
  return data
}

export async function retryNotification(id: string): Promise<void> {
  await api.post(`/notifications/${id}/retry`)
}
