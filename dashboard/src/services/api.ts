import axios, { type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from '@/store/auth.store'
import { type AuthUser } from '@/types/api.types'

export const api = axios.create({
  baseURL: '/v1',
  headers: { 'Content-Type': 'application/json' },
  // Needed so the browser sends the httpOnly refresh-token cookie on every request
  withCredentials: true,
})

// ─── Request interceptor — attach access token ────────────────────────────────

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── Refresh-token queue ──────────────────────────────────────────────────────
// Prevents multiple concurrent 401s from each triggering a separate refresh.

type QueueEntry = {
  resolve: (token: string) => void
  reject: (err: unknown) => void
}

let isRefreshing = false
let failedQueue: QueueEntry[] = []

function processQueue(error: unknown, token: string | null) {
  failedQueue.forEach((entry) => {
    if (error) {
      entry.reject(error)
    } else {
      entry.resolve(token!)
    }
  })
  failedQueue = []
}

// ─── Response interceptor — transparent refresh on 401 ───────────────────────

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryableConfig | undefined

    // Only handle 401s on requests we can retry
    if (error.response?.status !== 401 || !originalRequest) {
      return Promise.reject(error)
    }

    // Never retry the refresh or login endpoints — avoids infinite loops.
    // Just clear state and let React Router/BootLoader handle the redirect.
    const url = originalRequest.url ?? ''
    if (url.includes('/auth/refresh') || url.includes('/auth/login')) {
      useAuthStore.getState().clearAuth()
      return Promise.reject(error)
    }

    // Already retried once — avoid infinite retry loop
    if (originalRequest._retry) {
      useAuthStore.getState().clearAuth()
      window.location.replace('/login')
      return Promise.reject(error)
    }

    // Another refresh is already in flight — queue this request
    if (isRefreshing) {
      return new Promise<unknown>((resolve, reject) => {
        failedQueue.push({
          resolve: (newToken) => {
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            resolve(api(originalRequest))
          },
          reject,
        })
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      const { data } = await api.post<{ token: string; user: AuthUser }>('/auth/refresh')
      const { token, user } = data

      useAuthStore.getState().setAuth(token, user)
      api.defaults.headers.common.Authorization = `Bearer ${token}`
      originalRequest.headers.Authorization = `Bearer ${token}`

      processQueue(null, token)
      return api(originalRequest)
    } catch (refreshError) {
      processQueue(refreshError, null)
      useAuthStore.getState().clearAuth()
      window.location.replace('/login')
      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)

// ─── Helper ───────────────────────────────────────────────────────────────────

export function getApiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    return error.response?.data?.message ?? error.message ?? 'Erro desconhecido'
  }
  if (error instanceof Error) return error.message
  return 'Erro desconhecido'
}
