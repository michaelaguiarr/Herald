import { api } from '@/services/api'
import { OptOut, PaginatedResponse } from '@/types/api.types'

interface RawResponse {
  data: OptOut[]
  total: number
  page: number
  limit: number
}

export async function listOptOuts(page = 1, limit = 20): Promise<PaginatedResponse<OptOut>> {
  const { data } = await api.get<RawResponse>('/opt-outs', { params: { page, limit } })
  return {
    data: data.data,
    total: data.total,
    page: data.page,
    // API returns 'limit' instead of 'pages' — compute here
    pages: Math.ceil(data.total / data.limit),
  }
}

export async function deleteOptOut(phone: string): Promise<void> {
  await api.delete(`/opt-outs/${encodeURIComponent(phone)}`)
}
