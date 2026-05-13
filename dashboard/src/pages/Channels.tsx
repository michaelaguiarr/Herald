import { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Radio, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ChannelStatusBadge } from '@/components/shared/StatusBadge'
import { ChannelBadge } from '@/components/shared/ChannelBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import { listChannels, createChannel, updateChannel, deactivateChannel } from '@/services/channels.service'
import { listOrganizations } from '@/services/organizations.service'
import { useAuthStore } from '@/store/auth.store'
import { Channel, ChannelType, Organization } from '@/types/api.types'
import { cn } from '@/lib/utils'

// ─── Schemas — z.number() + valueAsNumber on inputs (Zod v4 pattern) ──────────

const numField = (min = 1) => z.number({ message: 'Número inválido' }).int().min(min, `Mínimo ${min}`)

const waSchema = z.object({
  label: z.string().min(1, 'Label obrigatório'),
  dailyLimit: numField(),
  hourlyLimit: numField(),
})
const emailSchema = z.object({
  label: z.string().min(1, 'Label obrigatório'),
  host: z.string().min(1, 'Host SMTP obrigatório'),
  port: numField(1).max(65535),
  user: z.string().min(1, 'Usuário obrigatório'),
  pass: z.string().min(1, 'Senha obrigatória'),
  from: z.string().email('E-mail inválido'),
  dailyLimit: numField(),
  hourlyLimit: numField(),
})
const tgSchema = z.object({
  label: z.string().min(1, 'Label obrigatório'),
  botToken: z.string().min(1, 'Bot token obrigatório'),
  dailyLimit: numField(),
  hourlyLimit: numField(),
})
const editSchema = z.object({
  label: z.string().min(1, 'Label obrigatório'),
  dailyLimit: numField(),
  hourlyLimit: numField(),
})

type WaForm = z.infer<typeof waSchema>
type EmailForm = z.infer<typeof emailSchema>
type TgForm = z.infer<typeof tgSchema>
type EditForm = z.infer<typeof editSchema>

// ─── Number input that converts string→number before storing in RHF ────────────

function NumField({ value, onChange, name, min = 1 }: {
  value: number
  onChange: (n: number) => void
  name: string
  min?: number
}) {
  return (
    <Input
      type="number"
      name={name}
      min={min}
      value={isNaN(value) ? '' : value}
      onChange={(e) => onChange(e.target.valueAsNumber)}
    />
  )
}

// ─── Label field (shared UI pattern) ─────────────────────────────────────────

function LabelField({ form }: { form: ReturnType<typeof useForm<WaForm>> | ReturnType<typeof useForm<EmailForm>> | ReturnType<typeof useForm<TgForm>> | ReturnType<typeof useForm<EditForm>> }) {
  return (
    <FormField
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      control={form.control as any}
      name="label"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Label</FormLabel>
          <FormControl><Input placeholder="Ex: Canal Principal" {...field} /></FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )
}

function LimitsFields({ form }: { form: ReturnType<typeof useForm<WaForm>> | ReturnType<typeof useForm<EmailForm>> | ReturnType<typeof useForm<TgForm>> | ReturnType<typeof useForm<EditForm>> }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <FormField
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        control={form.control as any}
        name="dailyLimit"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Limite diário</FormLabel>
            <FormControl>
              <NumField value={field.value as number} onChange={field.onChange} name={field.name} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        control={form.control as any}
        name="hourlyLimit"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Limite/hora</FormLabel>
            <FormControl>
              <NumField value={field.value as number} onChange={field.onChange} name={field.name} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  )
}

function CancelSave({ onCancel, submitting, label = 'Criar canal' }: {
  onCancel: () => void; submitting: boolean; label?: string
}) {
  return (
    <DialogFooter className="gap-2">
      <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="h-4 w-4 animate-spin" />}{label}
      </Button>
    </DialogFooter>
  )
}

// ─── WhatsApp create form ──────────────────────────────────────────────────────

function WaCreateForm({ orgId, onCreated, onCancel }: { orgId: string; onCreated: () => void; onCancel: () => void }) {
  const navigate = useNavigate()
  const form = useForm<WaForm>({ resolver: zodResolver(waSchema), defaultValues: { label: '', dailyLimit: 50, hourlyLimit: 10 } })
  async function onSubmit(v: WaForm) {
    await createChannel({ organizationId: orgId, type: 'WHATSAPP', label: v.label, credentials: {}, dailyLimit: v.dailyLimit, hourlyLimit: v.hourlyLimit })
    toast.success('Canal WhatsApp criado! Conecte agora via QR Code.')
    onCreated()
    navigate('/whatsapp')
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <LabelField form={form} />
        <LimitsFields form={form} />
        <p className="text-xs text-muted-foreground bg-blue-50 border border-blue-200 rounded-md p-2">
          Após criar, acesse <strong>Sessões WhatsApp</strong> para conectar o número via QR Code.
        </p>
        <CancelSave onCancel={onCancel} submitting={form.formState.isSubmitting} />
      </form>
    </Form>
  )
}

// ─── Email create form ─────────────────────────────────────────────────────────

function EmailCreateForm({ orgId, onCreated, onCancel }: { orgId: string; onCreated: () => void; onCancel: () => void }) {
  const form = useForm<EmailForm>({
    resolver: zodResolver(emailSchema),
    defaultValues: { label: '', host: '', port: 587, user: '', pass: '', from: '', dailyLimit: 500, hourlyLimit: 100 },
  })
  async function onSubmit(v: EmailForm) {
    const { label, dailyLimit, hourlyLimit, ...creds } = v
    await createChannel({ organizationId: orgId, type: 'EMAIL', label, credentials: creds, dailyLimit, hourlyLimit })
    toast.success('Canal Email criado.')
    onCreated()
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <LabelField form={form} />
        <FormField control={form.control} name="host" render={({ field }) => (
          <FormItem><FormLabel>Host SMTP</FormLabel><FormControl><Input placeholder="smtp.gmail.com" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-3">
          <FormField control={form.control} name="port" render={({ field }) => (
            <FormItem><FormLabel>Porta</FormLabel><FormControl>
              <NumField value={field.value} onChange={field.onChange} name={field.name} min={1} />
            </FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="from" render={({ field }) => (
            <FormItem><FormLabel>From (e-mail)</FormLabel><FormControl><Input type="email" placeholder="noreply@org.com" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="user" render={({ field }) => (
            <FormItem><FormLabel>Usuário SMTP</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="pass" render={({ field }) => (
            <FormItem><FormLabel>Senha SMTP</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <LimitsFields form={form} />
        <CancelSave onCancel={onCancel} submitting={form.formState.isSubmitting} />
      </form>
    </Form>
  )
}

// ─── Telegram create form ──────────────────────────────────────────────────────

function TgCreateForm({ orgId, onCreated, onCancel }: { orgId: string; onCreated: () => void; onCancel: () => void }) {
  const form = useForm<TgForm>({ resolver: zodResolver(tgSchema), defaultValues: { label: '', botToken: '', dailyLimit: 1000, hourlyLimit: 200 } })
  async function onSubmit(v: TgForm) {
    await createChannel({ organizationId: orgId, type: 'TELEGRAM', label: v.label, credentials: { botToken: v.botToken }, dailyLimit: v.dailyLimit, hourlyLimit: v.hourlyLimit })
    toast.success('Canal Telegram criado.')
    onCreated()
  }
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <LabelField form={form} />
        <FormField control={form.control} name="botToken" render={({ field }) => (
          <FormItem><FormLabel>Bot Token</FormLabel><FormControl><Input placeholder="123456:ABC-DEF..." {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <LimitsFields form={form} />
        <CancelSave onCancel={onCancel} submitting={form.formState.isSubmitting} />
      </form>
    </Form>
  )
}

// ─── Org select (OWNER only) ──────────────────────────────────────────────────

function orgLabel(org: Organization): string {
  return org.type === 'FILIAL' ? `└ ${org.name}` : org.name
}

function sortedActiveOrgs(orgs: Organization[]): Organization[] {
  const active = orgs.filter((o) => o.active)
  // Root orgs first, then filiais grouped after their parent (alphabetically within each group)
  const roots = active.filter((o) => !o.parentId).sort((a, b) => a.name.localeCompare(b.name))
  const filiais = active.filter((o) => o.parentId).sort((a, b) => a.name.localeCompare(b.name))
  return [...roots, ...filiais]
}

// ─── Create dialog ────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const role = useAuthStore((s) => s.user?.role)
  const userOrgId = useAuthStore((s) => s.user?.organizationId ?? '')
  const isOwner = role === 'OWNER'

  const [channelType, setChannelType] = useState<ChannelType>('WHATSAPP')
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)

  // Fetch org list when dialog opens — only for OWNER
  useEffect(() => {
    if (!open || !isOwner) return
    setOrgsLoading(true)
    listOrganizations()
      .then((data) => setOrgs(sortedActiveOrgs(data)))
      .catch(() => toast.error('Erro ao carregar organizações'))
      .finally(() => setOrgsLoading(false))
  }, [open, isOwner])

  function handleClose() {
    setSelectedOrgId('')
    setChannelType('WHATSAPP')
    onClose()
  }

  // orgId resolved from selection (OWNER) or JWT (others)
  const orgId = isOwner ? selectedOrgId : userOrgId
  // Forms are ready when orgId is available
  const formReady = !!orgId

  const done = () => { onCreated(); handleClose() }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar canal</DialogTitle>
          <DialogDescription>Configure um novo canal de notificação.</DialogDescription>
        </DialogHeader>

        {/* Org selector — OWNER only */}
        {isOwner && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Organização <span className="text-destructive">*</span>
            </label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 h-10 px-3 border rounded-md text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Carregando organizações…
              </div>
            ) : (
              <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione uma organização…" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {orgLabel(org)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        )}

        {/* Channel type selector */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tipo de canal</label>
          <Select value={channelType} onValueChange={(v) => setChannelType(v as ChannelType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="TELEGRAM">Telegram</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Prompt OWNER to select org before showing the form */}
        {isOwner && !formReady && !orgsLoading && (
          <p className="text-sm text-muted-foreground text-center py-3 border rounded-md bg-muted/30">
            Selecione uma organização para continuar.
          </p>
        )}

        {/* Type-specific forms — rendered only when orgId is resolved */}
        {formReady && channelType === 'WHATSAPP' && <WaCreateForm orgId={orgId} onCreated={done} onCancel={handleClose} />}
        {formReady && channelType === 'EMAIL' && <EmailCreateForm orgId={orgId} onCreated={done} onCancel={handleClose} />}
        {formReady && channelType === 'TELEGRAM' && <TgCreateForm orgId={orgId} onCreated={done} onCancel={handleClose} />}
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditDialog({ channel, open, onClose, onUpdated }: { channel: Channel | null; open: boolean; onClose: () => void; onUpdated: () => void }) {
  const form = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: { label: channel?.label ?? '', dailyLimit: channel?.dailyLimit ?? 50, hourlyLimit: channel?.hourlyLimit ?? 10 },
  })
  useEffect(() => {
    if (channel) form.reset({ label: channel.label, dailyLimit: channel.dailyLimit, hourlyLimit: channel.hourlyLimit })
  }, [channel, form])
  async function onSubmit(values: EditForm) {
    if (!channel) return
    try {
      await updateChannel(channel.id, values)
      toast.success('Canal atualizado.')
      onClose(); onUpdated()
    } catch { toast.error('Erro ao atualizar canal.') }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar canal</DialogTitle>
          <DialogDescription>Altere label e limites do canal.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <LabelField form={form} />
            <LimitsFields form={form} />
            <CancelSave onCancel={onClose} submitting={form.formState.isSubmitting} label="Salvar" />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Deactivate dialog ────────────────────────────────────────────────────────

function DeactivateDialog({ channel, open, onClose, onDeactivated }: { channel: Channel | null; open: boolean; onClose: () => void; onDeactivated: () => void }) {
  const [loading, setLoading] = useState(false)
  async function confirm() {
    if (!channel) return
    setLoading(true)
    try {
      await deactivateChannel(channel.id)
      toast.success(`Canal "${channel.label}" desativado.`)
      onClose(); onDeactivated()
    } catch { toast.error('Erro ao desativar canal.') }
    finally { setLoading(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desativar canal</DialogTitle>
          <DialogDescription>
            Deseja desativar <strong>{channel?.label}</strong>? O canal não receberá novas
            notificações. Você pode reativá-lo via edição.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}Desativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChannelsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState<ChannelType | 'ALL'>('ALL')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Channel | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Channel | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listChannels(typeFilter === 'ALL' ? undefined : typeFilter)
      setChannels(data)
    } catch { setError('Erro ao carregar canais.') }
    finally { setLoading(false) }
  }, [typeFilter])

  useEffect(() => { load() }, [load])

  function fmtTime(iso: string | null) {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Canais</h1>
        <div className="flex gap-2 flex-wrap">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ChannelType | 'ALL')}>
            <SelectTrigger className="w-40 h-9 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos os tipos</SelectItem>
              <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="TELEGRAM">Telegram</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />Novo canal
          </Button>
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={6} />}

      {!loading && error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!loading && !error && channels.length === 0 && (
        <EmptyState icon={Radio} title="Nenhum canal encontrado" description="Crie um canal para começar a enviar notificações." />
      )}

      {!loading && !error && channels.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3 text-left">Label</th>
                <th className="px-4 py-3 text-left">Tipo</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Limites dia/hora</th>
                <th className="px-4 py-3 text-left">Última atividade</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((ch) => (
                <tr key={ch.id} className={cn('border-b hover:bg-muted/30 transition-colors', ch.status === 'INACTIVE' && 'opacity-50')}>
                  <td className="px-4 py-3 font-medium">{ch.label}</td>
                  <td className="px-4 py-3"><ChannelBadge type={ch.type} /></td>
                  <td className="px-4 py-3"><ChannelStatusBadge status={ch.status} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{ch.dailyLimit}/dia · {ch.hourlyLimit}/h</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{fmtTime(ch.lastUsedAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => setEditTarget(ch)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      {ch.status !== 'INACTIVE' && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Desativar" onClick={() => setDeactivateTarget(ch)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
      <EditDialog channel={editTarget} open={editTarget !== null} onClose={() => setEditTarget(null)} onUpdated={load} />
      <DeactivateDialog channel={deactivateTarget} open={deactivateTarget !== null} onClose={() => setDeactivateTarget(null)} onDeactivated={load} />
    </div>
  )
}
