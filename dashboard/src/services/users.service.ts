import { api } from '@/services/api'
import { User, CreateUserData, UpdateUserData } from '@/types/api.types'

export async function listUsers(): Promise<User[]> {
  const { data } = await api.get<User[]>('/users')
  return data
}

export async function createUser(payload: CreateUserData): Promise<User> {
  const { data } = await api.post<User>('/users', payload)
  return data
}

export async function updateUser(id: string, payload: UpdateUserData): Promise<User> {
  const { data } = await api.put<User>(`/users/${id}`, payload)
  return data
}

export async function deactivateUser(id: string): Promise<void> {
  await api.delete(`/users/${id}`)
}

export async function resetUserPassword(id: string): Promise<void> {
  await api.post(`/users/${id}/reset-password`)
}
