import { api } from '@/services/api'
import { Organization } from '@/types/api.types'

export async function listOrganizations(): Promise<Organization[]> {
  const { data } = await api.get<Organization[]>('/organizations')
  return data
}

export async function createOrganization(payload: {
  name: string
  type: 'ORGANIZACAO' | 'FILIAL'
  parentId?: string
}): Promise<Organization> {
  const { data } = await api.post<Organization>('/organizations', payload)
  return data
}

export async function updateOrganization(id: string, name: string): Promise<Organization> {
  const { data } = await api.put<Organization>(`/organizations/${id}`, { name })
  return data
}

export async function deactivateOrganization(id: string): Promise<void> {
  await api.delete(`/organizations/${id}`)
}

export async function generateApiKey(id: string): Promise<string> {
  const { data } = await api.post<{ apiKey: string }>(`/organizations/${id}/api-key`)
  return data.apiKey
}

export async function revokeApiKey(id: string): Promise<void> {
  await api.delete(`/organizations/${id}/api-key`)
}
