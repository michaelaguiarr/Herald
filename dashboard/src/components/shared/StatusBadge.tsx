import { Badge } from '@/components/ui/badge'
import { NotificationStatus, ChannelStatus } from '@/types/api.types'
import { cn } from '@/lib/utils'

const NOTIFICATION_STATUS_CONFIG: Record<
  NotificationStatus,
  { label: string; className: string }
> = {
  ENVIADO:          { label: 'Enviado',           className: 'bg-green-100 text-green-800 border-green-200' },
  PENDENTE:         { label: 'Pendente',           className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  FALHOU:           { label: 'Falhou',             className: 'bg-orange-100 text-orange-800 border-orange-200' },
  FALHOU_DEFINITIVO:{ label: 'Falha definitiva',   className: 'bg-red-100 text-red-800 border-red-200' },
  AGENDADO:         { label: 'Agendado',           className: 'bg-blue-100 text-blue-800 border-blue-200' },
  CANCELADO:        { label: 'Cancelado',          className: 'bg-gray-100 text-gray-600 border-gray-200' },
}

const CHANNEL_STATUS_CONFIG: Record<ChannelStatus, { label: string; className: string }> = {
  ACTIVE:       { label: 'Ativo',         className: 'bg-green-100 text-green-800 border-green-200' },
  WARMING:      { label: 'Aquecendo',     className: 'bg-blue-100 text-blue-800 border-blue-200' },
  DISCONNECTED: { label: 'Desconectado',  className: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  BANNED:       { label: 'Banido',        className: 'bg-red-100 text-red-800 border-red-200' },
  INACTIVE:     { label: 'Inativo',       className: 'bg-gray-100 text-gray-600 border-gray-200' },
}

export function NotificationStatusBadge({ status }: { status: NotificationStatus }) {
  const config = NOTIFICATION_STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return (
    <Badge className={cn('border font-medium', config.className)}>
      {config.label}
    </Badge>
  )
}

export function ChannelStatusBadge({ status }: { status: ChannelStatus }) {
  const config = CHANNEL_STATUS_CONFIG[status] ?? { label: status, className: 'bg-gray-100 text-gray-600' }
  return (
    <Badge className={cn('border font-medium', config.className)}>
      {config.label}
    </Badge>
  )
}
