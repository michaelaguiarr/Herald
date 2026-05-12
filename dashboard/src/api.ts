export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function apiFetch<T>(
  path: string,
  token: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  })
  const data = await res.json()
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `HTTP ${res.status}`)
  return data as T
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardSummary {
  period: string
  totalNotifications: number
  byStatus: { status: string; count: number }[]
  byChannel: { channelType: string; count: number }[]
  channels: { status: string; count: number }[]
  deliveryRate: number
}

export interface FailedNotification {
  id: string
  organizationId: string
  channelType: string
  recipientName: string
  recipientPhone: string | null
  recipientEmail: string | null
  message: string
  retryCycle: number
  createdAt: string
}

export interface AuditLogEntry {
  id: string
  userId: string | null
  organizationId: string | null
  action: string
  targetId: string | null
  targetType: string | null
  metadata: unknown
  ipAddress: string | null
  createdAt: string
}

export interface WaChannel {
  id: string
  label: string
  status: string
  organizationId: string
  sentToday: number
  dailyLimit: number
  connectedAt: string | null
}
