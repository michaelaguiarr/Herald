import { api } from '@/services/api'
import { Channel, ChannelType, CreateChannelData, UpdateChannelData } from '@/types/api.types'

export async function listChannels(type?: ChannelType): Promise<Channel[]> {
  const params: Record<string, string> = {}
  if (type) params.type = type
  const { data } = await api.get<Channel[]>('/channels', { params })
  return data
}

export async function createChannel(payload: CreateChannelData): Promise<Channel> {
  const { data } = await api.post<Channel>('/channels', payload)
  return data
}

export async function updateChannel(id: string, payload: UpdateChannelData): Promise<Channel> {
  const { data } = await api.put<Channel>(`/channels/${id}`, payload)
  return data
}

export async function deactivateChannel(id: string): Promise<void> {
  await api.delete(`/channels/${id}`)
}

export async function reconnectChannel(id: string): Promise<void> {
  await api.post(`/channels/${id}/reconnect`)
}

export async function disconnectChannel(id: string): Promise<void> {
  await api.post(`/channels/${id}/disconnect`)
}
