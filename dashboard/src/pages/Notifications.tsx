import { useState, useCallback, useEffect } from 'react'
import { RefreshCw, RotateCcw, Bell, Clock, ImageOff, Plus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { NotificationStatusBadge } from '@/components/shared/StatusBadge'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { DeliveryStatusBadge } from '@/components/shared/DeliveryStatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Pagination } from '@/components/shared/Pagination'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import { listNotifications, getNotification, retryNotification, sendNotification } from '@/services/notifications.service'
import { listChannels, listWhatsAppGroups } from '@/services/channels.service'
import { listOrganizations } from '@/services/organizations.service'
import { useAuthStore } from '@/store/auth.store'
import {
  NotificationItem, NotificationDetail, NotificationStatus, ChannelType,
  Channel, WhatsAppGroup, Organization,
} from '@/types/api.types'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const RETRYABLE: NotificationStatus[] = ['FALHOU', 'FALHOU_DEFINITIVO', 'ENVIADO']

const STATUS_OPTIONS: { value: NotificationStatus | ''; label: string }[] = [
  { value: '',                label: 'Todos os status' },
  { value: 'ENVIADO',         label: 'Enviado' },
  { value: 'PENDENTE',        label: 'Pendente' },
  { value: 'FALHOU',          label: 'Falhou' },
  { value: 'FALHOU_DEFINITIVO', label: 'Falha definitiva' },
  { value: 'AGENDADO',        label: 'Agendado' },
  { value: 'CANCELADO',       label: 'Cancelado' },
]

const CHANNEL_OPTIONS: { value: ChannelType | ''; label: string }[] = [
  { value: '',          label: 'Todos os canais' },
  { value: 'WHATSAPP',  label: 'WhatsApp' },
  { value: 'EMAIL',     label: 'Email' },
  { value: 'TELEGRAM',  label: 'Telegram' },
]

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ─── Image preview with error fallback ───────────────────────────────────────

function ImagePreview({ src, caption }: { src: string; caption?: string | null }) {
  const [errored, setErrored] = useState(false)

  if (errored) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/50 py-6 text-muted-foreground">
        <ImageOff className="h-6 w-6" />
        <span className="text-xs">Imagem não disponível</span>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <img
        src={src}
        alt={caption ?? 'Imagem'}
        className="rounded-md max-h-48 object-cover w-full"
        onError={() => setErrored(true)}
      />
      {caption && (
        <p className="text-xs text-muted-foreground">{caption}</p>
      )}
    </div>
  )
}

// ─── Notification Drawer ──────────────────────────────────────────────────────

function NotificationDrawer({
  id, open, onClose,
}: {
  id: string | null; open: boolean; onClose: () => void
}) {
  const role = useAuthStore((s) => s.user?.role)
  const [detail, setDetail] = useState<NotificationDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!id || !open) return
    setDetail(null)
    setLoading(true)
    getNotification(id)
      .then(setDetail)
      .catch(() => toast.error('Erro ao carregar detalhes'))
      .finally(() => setLoading(false))
  }, [id, open])

  async function handleRetry() {
    if (!detail) return
    setRetrying(true)
    try {
      await retryNotification(detail.id)
      toast.success('Notificação reenviada')
      onClose()
    } catch {
      toast.error('Erro ao reenviar notificação')
    } finally {
      setRetrying(false)
    }
  }

  const canRetry = detail && RETRYABLE.includes(detail.status) && role !== 'OPERATOR'

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader className="pr-6">
          <SheetTitle>Detalhes da notificação</SheetTitle>
          <SheetDescription>Histórico completo de tentativas de entrega</SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="mt-6 space-y-3">
            {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-4 w-full" />)}
          </div>
        )}

        {!loading && detail && (
          <div className="mt-6 space-y-5">
            {/* Recipient */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Destinatário</p>
                <p className="font-medium">{detail.recipientName}</p>
                <p className="text-muted-foreground text-xs">
                  {detail.recipientPhone ?? detail.recipientEmail ?? detail.recipientTelegramId ?? '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Status</p>
                <NotificationStatusBadge status={detail.status} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Canal</p>
                <ChannelBadge type={detail.channelType} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Ciclo de retry</p>
                <p className="font-medium">{detail.retryCycle}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Criado em</p>
                <p>{fmt(detail.createdAt)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Enviado em</p>
                <p>{fmt(detail.sentAt)}</p>
              </div>
              {detail.scheduledAt && (
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground mb-1">Agendado para</p>
                  <p>{fmt(detail.scheduledAt)}</p>
                </div>
              )}
            </div>

            {/* Image (optional — WhatsApp only) */}
            {detail.imageUrl && (
              <div>
                <p className="text-xs text-muted-foreground mb-2">Imagem</p>
                <ImagePreview src={detail.imageUrl} caption={detail.imageCaption} />
              </div>
            )}

            {/* Message */}
            <div>
              <p className="text-xs text-muted-foreground mb-2">Mensagem</p>
              <div className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap max-h-32 overflow-y-auto">
                {detail.message}
              </div>
            </div>

            <Separator />

            {/* Attempts */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-3 uppercase tracking-wide">
                Tentativas ({detail.attempts.length})
              </p>
              {detail.attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma tentativa registrada.</p>
              ) : (
                <div className="space-y-2">
                  {detail.attempts.map((att) => (
                    <div
                      key={att.id}
                      className={cn(
                        'rounded-md border p-3 text-xs',
                        att.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                      )}
                    >
                      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={cn(
                              'text-xs',
                              att.success
                                ? 'bg-green-100 text-green-800 border-green-200'
                                : 'bg-red-100 text-red-800 border-red-200'
                            )}
                          >
                            {att.success ? 'Sucesso' : 'Falhou'}
                          </Badge>
                          {detail.channelType === 'WHATSAPP' && att.deliveryStatus && (
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

            {/* Retry button */}
            {canRetry && (
              <>
                <Separator />
                <Button
                  className="w-full"
                  disabled={retrying}
                  onClick={handleRetry}
                >
                  {retrying ? (
                    <><RefreshCw className="h-4 w-4 animate-spin" /> Reenviando…</>
                  ) : (
                    <><RotateCcw className="h-4 w-4" /> Reenviar notificação</>
                  )}
                </Button>
              </>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Table row ────────────────────────────────────────────────────────────────

function NotificationRow({
  n, onSelect, onRetry, retryingId,
}: {
  n: NotificationItem
  onSelect: (id: string) => void
  onRetry: (id: string) => void
  retryingId: string | null
}) {
  const role = useAuthStore((s) => s.user?.role)
  const canRetry = RETRYABLE.includes(n.status) && role !== 'OPERATOR'

  return (
    <tr
      className="border-b hover:bg-muted/40 cursor-pointer transition-colors"
      onClick={() => onSelect(n.id)}
    >
      <td className="px-4 py-3 text-sm">
        <p className="font-medium">{n.recipientName}</p>
        <p className="text-xs text-muted-foreground">
          {n.recipientPhone ?? n.recipientEmail ?? n.recipientTelegramId ?? '—'}
        </p>
      </td>
      <td className="px-4 py-3"><ChannelBadge type={n.channelType} /></td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <NotificationStatusBadge status={n.status} />
          {n.channelType === 'WHATSAPP' && n.status === 'ENVIADO' && n.deliveryStatus && (
            <DeliveryStatusBadge status={n.deliveryStatus} size="sm" />
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmt(n.createdAt)}</td>
      <td
        className="px-4 py-3 text-right"
        onClick={(e) => e.stopPropagation()}
      >
        {canRetry && (
          <Button
            variant="outline"
            size="sm"
            disabled={retryingId === n.id}
            onClick={() => onRetry(n.id)}
            className="h-7 text-xs"
          >
            {retryingId === n.id
              ? <><RefreshCw className="h-3 w-3 animate-spin" /> Reenviando</>
              : <><RotateCcw className="h-3 w-3" /> Reenviar</>}
          </Button>
        )}
      </td>
    </tr>
  )
}

// ─── Notification Table ───────────────────────────────────────────────────────

function NotificationTable({
  statusFilter, channelFilter, extraStatusFilter, refreshKey,
}: {
  statusFilter: NotificationStatus | ''
  channelFilter: ChannelType | ''
  extraStatusFilter?: NotificationStatus
  refreshKey?: number
}) {
  const [data, setData] = useState<NotificationItem[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await listNotifications({
        page,
        limit: 20,
        status: extraStatusFilter ?? statusFilter,
        channelType: channelFilter,
      })
      setData(res.data)
      setPages(res.pages)
      setTotal(res.total)
    } catch {
      setError('Erro ao carregar notificações.')
    } finally {
      setLoading(false)
    }
  }, [page, statusFilter, channelFilter, extraStatusFilter, refreshKey])

  useEffect(() => { setPage(1) }, [statusFilter, channelFilter])
  useEffect(() => { load() }, [load])

  async function handleRetry(id: string) {
    setRetryingId(id)
    try {
      await retryNotification(id)
      toast.success('Notificação reenviada')
      load()
    } catch {
      toast.error('Erro ao reenviar')
    } finally {
      setRetryingId(null)
    }
  }

  if (loading) return <SkeletonTable rows={6} cols={5} />

  if (error) return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-destructive">{error}</p>
      <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
    </div>
  )

  if (!data.length) return (
    <EmptyState
      icon={Bell}
      title="Nenhuma notificação encontrada"
      description="Tente ajustar os filtros ou aguarde novas notificações."
    />
  )

  return (
    <div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
              <th className="px-4 py-3 text-left">Destinatário</th>
              <th className="px-4 py-3 text-left">Canal</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {data.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                onSelect={setSelectedId}
                onRetry={handleRetry}
                retryingId={retryingId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />

      <NotificationDrawer
        id={selectedId}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}

// ─── Send Notification Dialog ─────────────────────────────────────────────────

const sendSchema = z.object({
  organizationId: z.string().optional(),
  channelType: z.enum(['WHATSAPP', 'EMAIL', 'TELEGRAM']),
  recipientName: z.string().min(1, 'Nome é obrigatório'),
  message: z.string().min(1, 'Mensagem é obrigatória'),
  recipientMode: z.enum(['individual', 'group']).default('individual'),
  recipientPhone: z.string().optional(),
  recipientEmail: z.string().optional(),
  recipientTelegramId: z.string().optional(),
  whatsappChannelId: z.string().optional(),
  groupChatId: z.string().optional(),
})

type SendFormValues = z.infer<typeof sendSchema>

function SendNotificationDialog({
  open, onClose, onSent,
}: {
  open: boolean
  onClose: () => void
  onSent: () => void
}) {
  const role = useAuthStore((s) => s.user?.role)
  const storeOrgId = useAuthStore((s) => s.user?.organizationId ?? null)
  const isOwner = role === 'OWNER'

  const [orgs, setOrgs] = useState<Organization[]>([])
  const [waChannels, setWaChannels] = useState<Channel[]>([])
  const [groups, setGroups] = useState<WhatsAppGroup[]>([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<SendFormValues>({
    resolver: zodResolver(sendSchema as never),
    defaultValues: {
      organizationId: storeOrgId ?? '',
      channelType: 'WHATSAPP',
      recipientMode: 'individual',
      recipientName: '',
      message: '',
    },
  })

  const channelType = form.watch('channelType')
  const recipientMode = form.watch('recipientMode')
  const whatsappChannelId = form.watch('whatsappChannelId')
  const selectedOrgId = form.watch('organizationId')

  useEffect(() => {
    if (!open) return
    if (isOwner) {
      listOrganizations().then(setOrgs).catch(() => {})
    }
    const orgFilter = isOwner ? selectedOrgId : (storeOrgId ?? undefined)
    listChannels('WHATSAPP').then((chs) => {
      setWaChannels(
        chs.filter((c) =>
          (c.status === 'ACTIVE' || c.status === 'WARMING') &&
          (!orgFilter || c.organizationId === orgFilter)
        )
      )
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Para OWNER: refiltra canais WA quando muda a org selecionada
  useEffect(() => {
    if (!isOwner || !open) return
    form.setValue('whatsappChannelId', '')
    form.setValue('groupChatId', '')
    setGroups([])
    listChannels('WHATSAPP').then((chs) => {
      setWaChannels(
        chs.filter((c) =>
          (c.status === 'ACTIVE' || c.status === 'WARMING') &&
          (!selectedOrgId || c.organizationId === selectedOrgId)
        )
      )
    }).catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId])

  useEffect(() => {
    if (!whatsappChannelId) { setGroups([]); return }
    setLoadingGroups(true)
    listWhatsAppGroups(whatsappChannelId)
      .then(setGroups)
      .catch(() => toast.error('Falha ao carregar grupos'))
      .finally(() => setLoadingGroups(false))
  }, [whatsappChannelId])

  useEffect(() => {
    form.setValue('recipientPhone', '')
    form.setValue('recipientEmail', '')
    form.setValue('recipientTelegramId', '')
    form.setValue('recipientMode', 'individual')
    form.setValue('whatsappChannelId', '')
    form.setValue('groupChatId', '')
    setGroups([])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelType])

  useEffect(() => {
    if (recipientMode === 'individual') {
      form.setValue('whatsappChannelId', '')
      form.setValue('groupChatId', '')
      setGroups([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipientMode])

  async function onSubmit(values: SendFormValues) {
    if (values.channelType === 'WHATSAPP') {
      if (values.recipientMode === 'individual' && !values.recipientPhone?.trim()) {
        form.setError('recipientPhone', { message: 'Telefone é obrigatório' }); return
      }
      if (values.recipientMode === 'group' && !values.whatsappChannelId) {
        form.setError('whatsappChannelId', { message: 'Selecione um canal' }); return
      }
      if (values.recipientMode === 'group' && !values.groupChatId) {
        form.setError('groupChatId', { message: 'Selecione um grupo' }); return
      }
    }
    if (values.channelType === 'EMAIL' && !values.recipientEmail?.trim()) {
      form.setError('recipientEmail', { message: 'Email é obrigatório' }); return
    }
    if (values.channelType === 'TELEGRAM' && !values.recipientTelegramId?.trim()) {
      form.setError('recipientTelegramId', { message: 'Telegram ID é obrigatório' }); return
    }

    const effectiveOrgId = isOwner ? values.organizationId : (storeOrgId ?? '')
    if (!effectiveOrgId) {
      form.setError('organizationId', { message: 'Selecione uma organização' }); return
    }

    setSubmitting(true)
    try {
      const payload = {
        organizationId: effectiveOrgId,
        channelType: values.channelType,
        recipientName: values.recipientName,
        message: values.message,
        ...(values.channelType === 'WHATSAPP' && {
          recipientPhone: values.recipientMode === 'group' ? values.groupChatId : values.recipientPhone,
        }),
        ...(values.channelType === 'EMAIL' && { recipientEmail: values.recipientEmail }),
        ...(values.channelType === 'TELEGRAM' && { recipientTelegramId: values.recipientTelegramId }),
      }
      await sendNotification(payload)
      toast.success('Notificação enfileirada com sucesso')
      form.reset()
      onSent()
      onClose()
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Falha ao enviar notificação'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova Notificação</DialogTitle>
          <DialogDescription>Preencha os dados para enfileirar uma notificação.</DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-2">
          {/* Organização (apenas OWNER) */}
          {isOwner && (
            <div className="space-y-1.5">
              <Label>Organização</Label>
              <Select
                value={selectedOrgId ?? ''}
                onValueChange={(v) => form.setValue('organizationId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione a organização" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.organizationId && (
                <p className="text-xs text-destructive">{form.formState.errors.organizationId.message}</p>
              )}
            </div>
          )}

          {/* Canal */}
          <div className="space-y-1.5">
            <Label>Canal</Label>
            <Select
              value={channelType}
              onValueChange={(v) => form.setValue('channelType', v as 'WHATSAPP' | 'EMAIL' | 'TELEGRAM')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="TELEGRAM">Telegram</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Nome do destinatário */}
          <div className="space-y-1.5">
            <Label>Nome do destinatário</Label>
            <Input {...form.register('recipientName')} placeholder="Ex: João Silva" />
            {form.formState.errors.recipientName && (
              <p className="text-xs text-destructive">{form.formState.errors.recipientName.message}</p>
            )}
          </div>

          {/* WhatsApp: individual / grupo */}
          {channelType === 'WHATSAPP' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Tipo de destinatário</Label>
                <Select
                  value={recipientMode}
                  onValueChange={(v) => form.setValue('recipientMode', v as 'individual' | 'group')}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Número individual</SelectItem>
                    <SelectItem value="group">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5" />
                        Grupo
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {recipientMode === 'individual' && (
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input {...form.register('recipientPhone')} placeholder="5595991234567" />
                  {form.formState.errors.recipientPhone && (
                    <p className="text-xs text-destructive">{form.formState.errors.recipientPhone.message}</p>
                  )}
                </div>
              )}

              {recipientMode === 'group' && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Canal WhatsApp</Label>
                    <Select
                      value={whatsappChannelId ?? ''}
                      onValueChange={(v) => form.setValue('whatsappChannelId', v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={waChannels.length === 0 ? 'Nenhum canal ATIVO' : 'Selecione o canal'} />
                      </SelectTrigger>
                      <SelectContent>
                        {waChannels.map((ch) => (
                          <SelectItem key={ch.id} value={ch.id}>{ch.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.whatsappChannelId && (
                      <p className="text-xs text-destructive">{form.formState.errors.whatsappChannelId.message}</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Grupo</Label>
                    <Select
                      value={form.watch('groupChatId') ?? ''}
                      onValueChange={(v) => form.setValue('groupChatId', v)}
                      disabled={!whatsappChannelId || loadingGroups}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={
                          loadingGroups ? 'Carregando grupos...' :
                          !whatsappChannelId ? 'Selecione um canal primeiro' :
                          groups.length === 0 ? 'Nenhum grupo encontrado' :
                          'Selecione um grupo'
                        } />
                      </SelectTrigger>
                      <SelectContent>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                            <span className="ml-1.5 text-muted-foreground text-xs">({g.participantsCount})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {form.formState.errors.groupChatId && (
                      <p className="text-xs text-destructive">{form.formState.errors.groupChatId.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Email */}
          {channelType === 'EMAIL' && (
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input {...form.register('recipientEmail')} type="email" placeholder="joao@exemplo.com" />
              {form.formState.errors.recipientEmail && (
                <p className="text-xs text-destructive">{form.formState.errors.recipientEmail.message}</p>
              )}
            </div>
          )}

          {/* Telegram */}
          {channelType === 'TELEGRAM' && (
            <div className="space-y-1.5">
              <Label>Telegram ID</Label>
              <Input {...form.register('recipientTelegramId')} placeholder="123456789" />
              {form.formState.errors.recipientTelegramId && (
                <p className="text-xs text-destructive">{form.formState.errors.recipientTelegramId.message}</p>
              )}
            </div>
          )}

          {/* Mensagem */}
          <div className="space-y-1.5">
            <Label>Mensagem</Label>
            <textarea
              {...form.register('message')}
              rows={3}
              placeholder="Digite a mensagem..."
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
            />
            {form.formState.errors.message && (
              <p className="text-xs text-destructive">{form.formState.errors.message.message}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? <><RefreshCw className="h-3.5 w-3.5 animate-spin mr-1" />Enviando...</>
                : 'Enfileirar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NotificationsPage() {
  const [statusFilter, setStatusFilter] = useState('all')
  const [channelFilter, setChannelFilter] = useState('all')
  const [sendOpen, setSendOpen] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const role = useAuthStore((s) => s.user?.role)

  function toStatusFilter(v: string): NotificationStatus | '' {
    return v === 'all' ? '' : v as NotificationStatus
  }
  function toChannelFilter(v: string): ChannelType | '' {
    return v === 'all' ? '' : v as ChannelType
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Notificações</h1>

        {/* Filters + actions */}
        <div className="flex gap-2 flex-wrap items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44 h-9 text-sm">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'all'} value={o.value || 'all'}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="w-40 h-9 text-sm">
              <SelectValue placeholder="Todos os canais" />
            </SelectTrigger>
            <SelectContent>
              {CHANNEL_OPTIONS.map((o) => (
                <SelectItem key={o.value || 'all'} value={o.value || 'all'}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {role && ['OWNER', 'SUPER_ADMIN', 'ADMIN'].includes(role) && (
            <Button size="sm" onClick={() => setSendOpen(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Nova Notificação
            </Button>
          )}
        </div>
      </div>

      <SendNotificationDialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        onSent={() => setRefreshKey((k) => k + 1)}
      />

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all" className="gap-2">
            <Bell className="h-3.5 w-3.5" />
            Todas
          </TabsTrigger>
          <TabsTrigger value="scheduled" className="gap-2">
            <Clock className="h-3.5 w-3.5" />
            Agendadas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4">
          <NotificationTable
            statusFilter={toStatusFilter(statusFilter)}
            channelFilter={toChannelFilter(channelFilter)}
            refreshKey={refreshKey}
          />
        </TabsContent>

        <TabsContent value="scheduled" className="mt-4">
          <NotificationTable
            statusFilter={toStatusFilter(statusFilter)}
            channelFilter={toChannelFilter(channelFilter)}
            extraStatusFilter="AGENDADO"
            refreshKey={refreshKey}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
