import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle, RefreshCw, RotateCcw, Hash, Ban, Wifi, ServerCrash,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { NotificationStatusBadge } from '@/components/shared/StatusBadge'
import { DeliveryStatusBadge } from '@/components/shared/DeliveryStatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import { getFailedQueue } from '@/services/dashboard.service'
import { retryNotification } from '@/services/notifications.service'
import { useAuthStore } from '@/store/auth.store'
import { useUIStore } from '@/store/ui.store'
import {
  FailedNotification, FailureReason, FailedQueueSummary, ChannelType,
} from '@/types/api.types'
import { cn } from '@/lib/utils'

// ─── Config ───────────────────────────────────────────────────────────────────

const CHANNEL_OPTIONS: { value: ChannelType | ''; label: string }[] = [
  { value: '',         label: 'Todos os canais' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL',    label: 'Email' },
  { value: 'TELEGRAM', label: 'Telegram' },
]

type ReasonFilter = FailureReason | 'all'

interface ReasonMeta {
  label: string
  shortLabel: string
  className: string           // badge colors
  cardColor: string           // card accent text
  cardBg: string
  cardBorder: string
  cardActiveBorder: string
  Icon: React.ElementType
  canRetry: boolean
}

const REASON_META: Record<FailureReason, ReasonMeta> = {
  NUMBER_NOT_FOUND: {
    label: 'Número inexistente', shortLabel: 'Número inexistente',
    className: 'bg-red-100 text-red-800 border-red-200',
    cardColor: 'text-red-600', cardBg: 'bg-red-50/50',
    cardBorder: 'border-red-100', cardActiveBorder: 'border-red-400',
    Icon: Hash,
    canRetry: false,
  },
  OPT_OUT: {
    label: 'Opt-out', shortLabel: 'Opt-out',
    className: 'bg-orange-100 text-orange-800 border-orange-200',
    cardColor: 'text-orange-600', cardBg: 'bg-orange-50/50',
    cardBorder: 'border-orange-100', cardActiveBorder: 'border-orange-400',
    Icon: Ban,
    canRetry: false,
  },
  DELIVERY_FAILURE: {
    label: 'Falha de entrega', shortLabel: 'Falha de entrega',
    className: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    cardColor: 'text-yellow-600', cardBg: 'bg-yellow-50/50',
    cardBorder: 'border-yellow-100', cardActiveBorder: 'border-yellow-400',
    Icon: Wifi,
    canRetry: true,
  },
  NO_CHANNEL: {
    label: 'Sem canal', shortLabel: 'Sem canal',
    className: 'bg-gray-100 text-gray-600 border-gray-200',
    cardColor: 'text-gray-500', cardBg: 'bg-gray-50/50',
    cardBorder: 'border-gray-100', cardActiveBorder: 'border-gray-400',
    Icon: ServerCrash,
    canRetry: true,
  },
}

const REASON_ORDER: FailureReason[] = ['NUMBER_NOT_FOUND', 'OPT_OUT', 'DELIVERY_FAILURE', 'NO_CHANNEL']

function FailureReasonBadge({ reason }: { reason: FailureReason | null | undefined }) {
  if (!reason) return null
  const meta = REASON_META[reason]
  return (
    <Badge className={cn('border text-xs font-medium', meta.className)}>
      {meta.label}
    </Badge>
  )
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ─── Summary cards ────────────────────────────────────────────────────────────

function SummaryCards({
  summary,
  active,
  onToggle,
}: {
  summary: FailedQueueSummary
  active: ReasonFilter
  onToggle: (r: FailureReason) => void
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {REASON_ORDER.map((reason) => {
        const meta = REASON_META[reason]
        const count = summary[reason]
        const isActive = active === reason
        const Icon = meta.Icon

        return (
          <button
            key={reason}
            onClick={() => onToggle(reason)}
            className={cn(
              'rounded-lg border p-4 text-left transition-all hover:shadow-sm',
              meta.cardBg,
              isActive ? meta.cardActiveBorder + ' border-2 shadow-sm' : meta.cardBorder
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <Icon className={cn('h-4 w-4', meta.cardColor)} />
              {isActive && (
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                  ativo
                </span>
              )}
            </div>
            <p className={cn('text-2xl font-bold', meta.cardColor)}>{count}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{meta.shortLabel}</p>
          </button>
        )
      })}
    </div>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

function FailedDetailDrawer({
  item,
  open,
  onClose,
  onRetried,
  canRetry: canRetryRole,
}: {
  item: FailedNotification | null
  open: boolean
  onClose: () => void
  onRetried: (id: string) => void
  canRetry: boolean
}) {
  const navigate = useNavigate()
  const [retrying, setRetrying] = useState(false)

  if (!item) return null
  // Capture narrowed reference so inner functions don't re-check null
  const n = item

  const meta = n.failureReason ? REASON_META[n.failureReason] : null
  const allowRetry = canRetryRole && meta?.canRetry

  async function handleRetry() {
    setRetrying(true)
    try {
      await retryNotification(n.id)
      toast.success('Notificação reenviada com sucesso.')
      onClose()
      onRetried(n.id)
    } catch {
      toast.error('Erro ao reenviar notificação.')
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pr-6">
          <SheetTitle>Detalhes da falha</SheetTitle>
          <SheetDescription>Histórico completo de tentativas de entrega</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Destinatário</p>
              <p className="font-medium">{n.recipientName}</p>
              <p className="text-xs text-muted-foreground">
                {n.recipientPhone ?? n.recipientEmail ?? '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Canal</p>
              <ChannelBadge type={n.channelType} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Motivo da falha</p>
              <FailureReasonBadge reason={n.failureReason} />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Ciclo de retry</p>
              <p className="font-medium">{n.retryCycle}</p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-muted-foreground mb-1">Registrado em</p>
              <p>{fmt(n.createdAt)}</p>
            </div>
          </div>

          {/* Message */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Mensagem</p>
            <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
              {n.message}
            </div>
          </div>

          <Separator />

          {/* Attempts */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
              Tentativas ({n.attempts?.length ?? 0})
            </p>
            {!n.attempts?.length ? (
              <p className="text-sm text-muted-foreground">Nenhuma tentativa registrada.</p>
            ) : (
              <div className="space-y-2">
                {n.attempts.map((att) => (
                  <div
                    key={att.id}
                    className={cn(
                      'rounded-md border p-3 text-xs',
                      att.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                    )}
                  >
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Badge className={cn('text-xs', att.success
                          ? 'bg-green-100 text-green-800 border-green-200'
                          : 'bg-red-100 text-red-800 border-red-200'
                        )}>
                          {att.success ? 'Sucesso' : 'Falhou'}
                        </Badge>
                        {n.channelType === 'WHATSAPP' && att.deliveryStatus && (
                          <DeliveryStatusBadge status={att.deliveryStatus} size="md" />
                        )}
                      </div>
                      <span className="text-muted-foreground">{fmt(att.attemptedAt)}</span>
                    </div>
                    {att.errorMessage && (
                      <p className="text-red-700 mt-1 font-mono">{att.errorMessage}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          {canRetryRole && (
            <>
              <Separator />
              {allowRetry && (
                <Button className="w-full" onClick={handleRetry} disabled={retrying}>
                  {retrying
                    ? <><RefreshCw className="h-4 w-4 animate-spin" /> Reenviando…</>
                    : <><RotateCcw className="h-4 w-4" /> Reenviar notificação</>}
                </Button>
              )}
              {n.failureReason === 'NUMBER_NOT_FOUND' && (
                <p className="text-xs text-center text-muted-foreground">
                  Reenvio indisponível — número não existe no WhatsApp.
                </p>
              )}
              {n.failureReason === 'OPT_OUT' && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    toast.info(`Pesquise por ${n.recipientPhone ?? ''} na tela de Opt-outs.`)
                    navigate('/opt-outs')
                    onClose()
                  }}
                >
                  <Ban className="h-4 w-4" />
                  Ver opt-out deste número
                </Button>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FailedNotificationsPage() {
  const role = useAuthStore((s) => s.user?.role)
  const canRetry = role !== 'OPERATOR'
  const navigate = useNavigate()

  const [data, setData] = useState<FailedNotification[]>([])
  const [summary, setSummary] = useState<FailedQueueSummary>({
    NUMBER_NOT_FOUND: 0, OPT_OUT: 0, DELIVERY_FAILURE: 0, NO_CHANNEL: 0,
  })
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [channelFilter, setChannelFilter] = useState<ChannelType | ''>('')
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [detailItem, setDetailItem] = useState<FailedNotification | null>(null)
  const setFailedCount = useUIStore((s) => s.setFailedCount)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await getFailedQueue(
        page, 20,
        channelFilter || undefined,
        reasonFilter !== 'all' ? reasonFilter : undefined,
      )
      setData(res.data)
      setPages(res.pages)
      setTotal(res.total)
      setFailedCount(res.total)
      if (res.summary) setSummary(res.summary)
    } catch {
      setError('Erro ao carregar falhas definitivas.')
    } finally {
      setLoading(false)
    }
  }, [page, channelFilter, reasonFilter, setFailedCount])

  useEffect(() => { setPage(1) }, [channelFilter, reasonFilter])
  useEffect(() => { load() }, [load])

  function toggleReason(r: FailureReason) {
    setReasonFilter((prev) => prev === r ? 'all' : r)
  }

  function removeItem(id: string) {
    setData((prev) => prev.filter((n) => n.id !== id))
    setTotal((t) => Math.max(0, t - 1))
    setFailedCount(Math.max(0, total - 1))
  }

  async function handleInlineRetry(n: FailedNotification) {
    const meta = n.failureReason ? REASON_META[n.failureReason] : null
    if (meta && !meta.canRetry) return
    setRetryingId(n.id)
    try {
      await retryNotification(n.id)
      toast.success('Notificação reenviada com sucesso.')
      removeItem(n.id)
    } catch {
      toast.error('Erro ao reenviar notificação.')
    } finally {
      setRetryingId(null)
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold">Falhas Definitivas</h1>
          {total > 0 && (
            <span className="inline-flex items-center justify-center rounded-full bg-destructive px-2 py-0.5 text-xs font-semibold text-destructive-foreground">
              {total}
            </span>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select
            value={channelFilter || 'all'}
            onValueChange={(v) => setChannelFilter(v === 'all' ? '' : v as ChannelType)}
          >
            <SelectTrigger className="w-40 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'all'} value={o.value || 'all'}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={reasonFilter}
            onValueChange={(v) => setReasonFilter(v as ReasonFilter)}
          >
            <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os motivos</SelectItem>
              {REASON_ORDER.map((r) => (
                <SelectItem key={r} value={r}>{REASON_META[r].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && !error && (
        <SummaryCards summary={summary} active={reasonFilter} onToggle={toggleReason} />
      )}
      {loading && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      )}

      {/* Table */}
      {loading && <SkeletonTable rows={5} cols={6} />}

      {!loading && error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={AlertCircle}
          title="Nenhuma falha definitiva"
          description={
            reasonFilter !== 'all'
              ? `Nenhuma falha com motivo "${REASON_META[reasonFilter as FailureReason]?.label}" encontrada.`
              : 'Todas as notificações foram entregues ou ainda estão em retry.'
          }
        />
      )}

      {!loading && !error && data.length > 0 && (
        <div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3 text-left">Destinatário</th>
                  <th className="px-4 py-3 text-left">Canal</th>
                  <th className="px-4 py-3 text-left">Motivo</th>
                  <th className="px-4 py-3 text-left">Ciclo</th>
                  <th className="px-4 py-3 text-left">Data</th>
                  {canRetry && <th className="px-4 py-3 text-right">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {data.map((n) => {
                  const meta = n.failureReason ? REASON_META[n.failureReason] : null
                  const rowCanRetry = canRetry && (meta?.canRetry ?? true)
                  const isOptOut = n.failureReason === 'OPT_OUT'
                  const isNoNumber = n.failureReason === 'NUMBER_NOT_FOUND'

                  return (
                    <tr
                      key={n.id}
                      className="border-b hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => setDetailItem(n)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{n.recipientName}</p>
                        <p className="text-xs text-muted-foreground">
                          {n.recipientPhone ?? n.recipientEmail ?? '—'}
                        </p>
                      </td>
                      <td className="px-4 py-3"><ChannelBadge type={n.channelType} /></td>
                      <td className="px-4 py-3"><FailureReasonBadge reason={n.failureReason} /></td>
                      <td className="px-4 py-3 text-muted-foreground">{n.retryCycle}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {fmt(n.createdAt)}
                      </td>
                      {canRetry && (
                        <td
                          className="px-4 py-3 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {rowCanRetry && (
                            <Button
                              variant="outline" size="sm"
                              disabled={retryingId === n.id}
                              onClick={() => handleInlineRetry(n)}
                              className="h-7 text-xs"
                            >
                              {retryingId === n.id
                                ? <><RefreshCw className="h-3 w-3 animate-spin" /> Reenviando</>
                                : <><RotateCcw className="h-3 w-3" /> Reenviar</>}
                            </Button>
                          )}
                          {isOptOut && (
                            <Button
                              variant="outline" size="sm"
                              className="h-7 text-xs text-orange-600 border-orange-200 hover:bg-orange-50"
                              onClick={() => {
                                toast.info(`Pesquise por ${n.recipientPhone ?? ''} na tela de Opt-outs.`)
                                navigate('/opt-outs')
                              }}
                            >
                              <Ban className="h-3 w-3" /> Ver opt-out
                            </Button>
                          )}
                          {isNoNumber && (
                            <span
                              className="text-xs text-muted-foreground cursor-default"
                              title="Número não existe no WhatsApp"
                            >
                              —
                            </span>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
        </div>
      )}

      <FailedDetailDrawer
        item={detailItem}
        open={detailItem !== null}
        onClose={() => setDetailItem(null)}
        onRetried={removeItem}
        canRetry={canRetry}
      />
    </div>
  )
}
