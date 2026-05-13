// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserRole = 'OWNER' | 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR'

export interface AuthUser {
  id: string
  name: string
  email: string
  role: UserRole
  organizationId: string
}

export interface LoginResponse {
  token: string
  refreshToken?: string
  user: AuthUser
}

export interface ApiError {
  message: string
  statusCode?: number
}

// ─── Users ───────────────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  role: UserRole
  organizationId: string | null
  telegramId: string | null
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export interface CreateUserData {
  name: string
  email: string
  password: string
  role: UserRole
  organizationId?: string | null
  telegramId?: string
}

export interface UpdateUserData {
  name?: string
  telegramId?: string | null
}

// ─── Organizations ────────────────────────────────────────────────────────────

export type OrganizationType = 'ORGANIZACAO' | 'FILIAL'

export interface Organization {
  id: string
  name: string
  type: OrganizationType
  parentId: string | null
  active: boolean
  createdAt: string
}

// ─── Channels ─────────────────────────────────────────────────────────────────

export type ChannelType = 'WHATSAPP' | 'EMAIL' | 'TELEGRAM'
export type ChannelStatus = 'ACTIVE' | 'INACTIVE' | 'BANNED' | 'WARMING' | 'DISCONNECTED'

export interface Channel {
  id: string
  organizationId: string
  type: ChannelType
  label: string
  status: ChannelStatus
  dailyLimit: number
  hourlyLimit: number
  sentToday: number
  lastUsedAt: string | null
  createdAt: string
}

export interface EmailCredentials {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export interface TelegramCredentials {
  botToken: string
}

export interface CreateChannelData {
  organizationId: string
  type: ChannelType
  label: string
  credentials: Record<string, unknown>
  dailyLimit?: number
  hourlyLimit?: number
}

export interface UpdateChannelData {
  label?: string
  credentials?: Record<string, unknown>
  dailyLimit?: number
  hourlyLimit?: number
  status?: 'ACTIVE' | 'INACTIVE'
}

// ─── Opt-outs ────────────────────────────────────────────────────────────────

export interface OptOut {
  id: string
  phone: string
  organizationId: string
  reason: string | null
  createdAt: string
}

// ─── Audit Log ───────────────────────────────────────────────────────────────

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

// ─── Notifications ────────────────────────────────────────────────────────────

export type NotificationStatus =
  | 'PENDENTE'
  | 'ENVIADO'
  | 'FALHOU'
  | 'FALHOU_DEFINITIVO'
  | 'AGENDADO'
  | 'CANCELADO'

export interface NotificationItem {
  id: string
  organizationId: string
  channelType: ChannelType
  recipientName: string
  recipientPhone: string | null
  /** Only present for WHATSAPP+ENVIADO if backend includes it in the list response */
  deliveryStatus?: DeliveryStatus | null
  recipientEmail: string | null
  recipientTelegramId: string | null
  message: string
  imageUrl?: string | null
  imageCaption?: string | null
  status: NotificationStatus
  scheduledAt: string | null
  sentAt: string | null
  retryCycle: number
  bullJobId: string | null
  createdAt: string
}

export type DeliveryStatus = 'SERVER_ACK' | 'DELIVERY_ACK' | 'READ'

export interface NotificationAttempt {
  id: string
  channelId: string
  attemptedAt: string
  success: boolean
  errorMessage: string | null
  whatsappMessageId?: string | null
  deliveryStatus?: DeliveryStatus | null
}

export interface NotificationDetail extends NotificationItem {
  attempts: NotificationAttempt[]
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  pages: number
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardPeriod = 'today' | '7d' | '30d'

export interface DashboardSummary {
  period: string
  totalNotifications: number
  deliveryRate: number
  byStatus: { status: string; count: number }[]
  byChannel: { channelType: string; count: number }[]
  channels: { status: string; count: number }[]
  jidCacheStats?: { hits: number; misses: number } | null
}

export type FailureReason = 'NUMBER_NOT_FOUND' | 'OPT_OUT' | 'DELIVERY_FAILURE' | 'NO_CHANNEL'

export interface FailedQueueSummary {
  NUMBER_NOT_FOUND: number
  OPT_OUT: number
  DELIVERY_FAILURE: number
  NO_CHANNEL: number
}

export interface FailedNotification {
  id: string
  organizationId: string
  channelType: ChannelType
  recipientName: string
  recipientPhone: string | null
  recipientEmail: string | null
  message: string
  retryCycle: number
  createdAt: string
  failureReason?: FailureReason | null
  attempts?: NotificationAttempt[]
}

export interface FailedQueueResponse {
  data: FailedNotification[]
  total: number
  page: number
  pages: number
  summary: FailedQueueSummary
}
