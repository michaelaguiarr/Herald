import { api } from '@/services/api'
import { LoginResponse } from '@/types/api.types'

export async function login(email: string, password: string): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/login', { email, password })
  return data
}

export async function forgotPassword(email: string): Promise<void> {
  await api.post('/auth/forgot-password', { email })
}

/** Uses the httpOnly cookie — no body needed. */
export async function refresh(): Promise<LoginResponse> {
  const { data } = await api.post<LoginResponse>('/auth/refresh')
  return data
}

/** Invalidates the refresh token server-side and clears the cookie. */
export async function logout(): Promise<void> {
  await api.post('/auth/logout')
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await api.post('/auth/reset-password', { token, password })
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<void> {
  await api.post('/auth/change-password', { currentPassword, newPassword, confirmPassword })
}
