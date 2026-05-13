import { ChannelType } from '@/types/api.types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const CONFIG: Record<ChannelType, { label: string; className: string }> = {
  WHATSAPP: { label: 'WhatsApp', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  EMAIL:    { label: 'Email',    className: 'bg-purple-100 text-purple-800 border-purple-200' },
  TELEGRAM: { label: 'Telegram', className: 'bg-sky-100 text-sky-800 border-sky-200' },
}

export function ChannelBadge({ type }: { type: ChannelType }) {
  const config = CONFIG[type] ?? { label: type, className: 'bg-gray-100 text-gray-600' }
  return (
    <Badge className={cn('border font-medium', config.className)}>
      {config.label}
    </Badge>
  )
}
