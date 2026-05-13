import { Check, CheckCheck } from 'lucide-react'
import { DeliveryStatus } from '@/types/api.types'
import { cn } from '@/lib/utils'

interface Config {
  Icon: typeof Check
  colorClass: string
  label: string
}

const CONFIG: Record<DeliveryStatus, Config> = {
  SERVER_ACK:   { Icon: Check,      colorClass: 'text-gray-400', label: 'Entregue ao servidor' },
  DELIVERY_ACK: { Icon: CheckCheck, colorClass: 'text-gray-400', label: 'Entregue ao dispositivo' },
  READ:         { Icon: CheckCheck, colorClass: 'text-blue-500', label: 'Lido' },
}

interface Props {
  status: DeliveryStatus | null | undefined
  /** Size variant — 'sm' for table cells, 'md' for drawer (default) */
  size?: 'sm' | 'md'
}

export function DeliveryStatusBadge({ status, size = 'md' }: Props) {
  if (!status) return null
  const config = CONFIG[status]
  if (!config) return null

  const { Icon, colorClass, label } = config
  const iconSize = size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs'

  return (
    <span
      className={cn('inline-flex items-center gap-0.5 font-medium', colorClass, textSize)}
      title={label}
      aria-label={label}
    >
      <Icon className={cn(iconSize, 'shrink-0')} strokeWidth={2.5} />
      <span className="leading-none">{label}</span>
    </span>
  )
}
