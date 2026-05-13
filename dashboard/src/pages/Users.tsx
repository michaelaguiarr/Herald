import { useState, useCallback, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plus, Pencil, Trash2, Users, Loader2, RefreshCw, RotateCcw, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/shared/EmptyState'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import {
  listUsers, createUser, updateUser, deactivateUser, resetUserPassword,
} from '@/services/users.service'
import { listOrganizations } from '@/services/organizations.service'
import { useAuthStore } from '@/store/auth.store'
import { User, UserRole, Organization } from '@/types/api.types'
import { getApiErrorMessage } from '@/services/api'
import { cn } from '@/lib/utils'

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<UserRole, string> = {
  OWNER: 'Owner',
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  OPERATOR: 'Operador',
}

const ROLE_CLASS: Record<UserRole, string> = {
  OWNER:       'bg-purple-100 text-purple-800 border-purple-200',
  SUPER_ADMIN: 'bg-blue-100 text-blue-800 border-blue-200',
  ADMIN:       'bg-indigo-100 text-indigo-800 border-indigo-200',
  OPERATOR:    'bg-gray-100 text-gray-600 border-gray-200',
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <Badge className={cn('border font-medium', ROLE_CLASS[role])}>
      {ROLE_LABEL[role]}
    </Badge>
  )
}

// Roles the current user can create
function creatableRoles(myRole: UserRole): UserRole[] {
  if (myRole === 'OWNER')       return ['OWNER', 'SUPER_ADMIN']
  if (myRole === 'SUPER_ADMIN') return ['ADMIN']
  if (myRole === 'ADMIN')       return ['OPERATOR']
  return []
}

// What org type is needed for the target role?
function orgTypeForRole(targetRole: UserRole): 'ORGANIZACAO' | 'FILIAL' | null {
  if (targetRole === 'SUPER_ADMIN') return 'ORGANIZACAO'
  if (targetRole === 'ADMIN')       return 'FILIAL'
  return null // OWNER (no org) or OPERATOR (creator's org, auto)
}

function fmt(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createSchema = z.object({
  name:     z.string().min(2, 'Mínimo 2 caracteres'),
  email:    z.string().email('E-mail inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres'),
  role:     z.enum(['OWNER', 'SUPER_ADMIN', 'ADMIN', 'OPERATOR'] as const),
  telegramId: z.string().optional(),
})
type CreateForm = z.infer<typeof createSchema>

const editSchema = z.object({
  name:       z.string().min(2, 'Mínimo 2 caracteres'),
  telegramId: z.string().nullable().optional(),
})
type EditForm = z.infer<typeof editSchema>

// ─── Create dialog ────────────────────────────────────────────────────────────

function CreateDialog({ open, onClose, onCreated }: {
  open: boolean; onClose: () => void; onCreated: () => void
}) {
  const myRole = useAuthStore((s) => s.user?.role ?? 'OPERATOR')
  const myOrgId = useAuthStore((s) => s.user?.organizationId ?? null)

  const roles = creatableRoles(myRole)
  const defaultRole = roles[0] ?? 'OPERATOR'

  const [targetRole, setTargetRole] = useState<UserRole>(defaultRole)
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [orgsLoading, setOrgsLoading] = useState(false)
  const [orgError, setOrgError] = useState('')

  const needsOrgSelect = orgTypeForRole(targetRole) !== null && targetRole !== 'OPERATOR'
  const requiredOrgType = orgTypeForRole(targetRole)

  // Load orgs when org selector is needed
  useEffect(() => {
    if (!open || !needsOrgSelect) return
    setOrgsLoading(true)
    listOrganizations()
      .then((data) => {
        const filtered = data.filter((o) => o.active && o.type === requiredOrgType)
        setOrgs(filtered.sort((a, b) => a.name.localeCompare(b.name)))
      })
      .catch(() => toast.error('Erro ao carregar organizações'))
      .finally(() => setOrgsLoading(false))
  }, [open, needsOrgSelect, requiredOrgType])

  function handleClose() {
    setTargetRole(defaultRole)
    setSelectedOrgId('')
    setOrgError('')
    onClose()
  }

  const form = useForm<CreateForm>({
    resolver: zodResolver(createSchema) as never,
    defaultValues: { name: '', email: '', password: '', role: defaultRole, telegramId: '' },
  })

  // Sync role field when targetRole changes
  useEffect(() => {
    form.setValue('role', targetRole)
    setSelectedOrgId('')
    setOrgError('')
  }, [targetRole, form])

  async function onSubmit(values: CreateForm) {
    // Resolve organizationId based on target role
    let organizationId: string | null | undefined
    if (targetRole === 'OWNER') {
      organizationId = null
    } else if (targetRole === 'OPERATOR') {
      organizationId = myOrgId  // ADMIN's own org
    } else {
      if (!selectedOrgId) {
        setOrgError('Selecione uma organização')
        return
      }
      organizationId = selectedOrgId
    }

    try {
      await createUser({
        name: values.name,
        email: values.email,
        password: values.password,
        role: values.role,
        organizationId,
        telegramId: values.telegramId || undefined,
      })
      toast.success('Usuário criado com sucesso.')
      handleClose()
      onCreated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Criar usuário</DialogTitle>
          <DialogDescription>Preencha os dados do novo usuário.</DialogDescription>
        </DialogHeader>

        {/* Role selector */}
        {roles.length > 1 && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Perfil</label>
            <Select value={targetRole} onValueChange={(v) => setTargetRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Fixed role label (when only one option) */}
        {roles.length === 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Perfil:</span>
            <RoleBadge role={roles[0]} />
          </div>
        )}

        {/* Org selector (conditional) */}
        {needsOrgSelect && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Organização <span className="text-destructive">*</span>
              <span className="text-xs text-muted-foreground ml-1">
                ({requiredOrgType === 'ORGANIZACAO' ? 'paróquia' : 'comunidade'})
              </span>
            </label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 h-10 px-3 border rounded-md text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />Carregando…
              </div>
            ) : (
              <Select value={selectedOrgId} onValueChange={(v) => { setSelectedOrgId(v); setOrgError('') }}>
                <SelectTrigger className={orgError ? 'border-destructive' : ''}>
                  <SelectValue placeholder="Selecione…" />
                </SelectTrigger>
                <SelectContent>
                  {orgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {orgError && <p className="text-xs text-destructive">{orgError}</p>}
          </div>
        )}

        {/* OPERATOR: show creator's org as info */}
        {targetRole === 'OPERATOR' && myOrgId && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2">
            O operador será criado na mesma organização do seu perfil.
          </p>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome completo</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem><FormLabel>E-mail</FormLabel><FormControl><Input type="email" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem><FormLabel>Senha inicial</FormLabel><FormControl><Input type="password" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="telegramId" render={({ field }) => (
              <FormItem>
                <FormLabel>Telegram ID <span className="text-xs text-muted-foreground">(opcional)</span></FormLabel>
                <FormControl><Input placeholder="@usuário ou ID numérico" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Criar usuário
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Edit dialog ──────────────────────────────────────────────────────────────

function EditDialog({ user, open, onClose, onUpdated }: {
  user: User | null; open: boolean; onClose: () => void; onUpdated: () => void
}) {
  const form = useForm<EditForm>({
    resolver: zodResolver(editSchema) as never,
    defaultValues: { name: user?.name ?? '', telegramId: user?.telegramId ?? '' },
  })

  useEffect(() => {
    if (user) form.reset({ name: user.name, telegramId: user.telegramId ?? '' })
  }, [user, form])

  async function onSubmit(values: EditForm) {
    if (!user) return
    try {
      await updateUser(user.id, {
        name: values.name,
        telegramId: values.telegramId ?? null,
      })
      toast.success('Usuário atualizado.')
      onClose(); onUpdated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
          <DialogDescription>Altere nome e Telegram ID do usuário.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="telegramId" render={({ field }) => (
              <FormItem>
                <FormLabel>Telegram ID <span className="text-xs text-muted-foreground">(opcional)</span></FormLabel>
                <FormControl><Input placeholder="@usuário ou ID numérico" {...field} value={field.value ?? ''} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Reset password dialog ────────────────────────────────────────────────────

function ResetPasswordDialog({ user, open, onClose }: {
  user: User | null; open: boolean; onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  async function confirm() {
    if (!user) return
    setLoading(true)
    try {
      await resetUserPassword(user.id)
      toast.success(`E-mail de redefinição enviado para ${user.email}.`)
      onClose()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Resetar senha</DialogTitle>
          <DialogDescription>
            Um e-mail de redefinição de senha será enviado para <strong>{user?.email}</strong>.
            O usuário terá 1 hora para definir uma nova senha.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar e-mail
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Deactivate dialog ────────────────────────────────────────────────────────

function DeactivateDialog({ user, open, onClose, onDeactivated }: {
  user: User | null; open: boolean; onClose: () => void; onDeactivated: () => void
}) {
  const [loading, setLoading] = useState(false)
  async function confirm() {
    if (!user) return
    setLoading(true)
    try {
      await deactivateUser(user.id)
      toast.success(`Usuário "${user.name}" desativado.`)
      onClose(); onDeactivated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desativar usuário</DialogTitle>
          <DialogDescription>
            Deseja desativar <strong>{user?.name}</strong>? O acesso será revogado imediatamente.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Desativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const myRole = useAuthStore((s) => s.user?.role ?? 'OPERATOR')
  const myId = useAuthStore((s) => s.user?.id)

  const [users, setUsers] = useState<User[]>([])
  const [orgMap, setOrgMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<User | null>(null)
  const [resetTarget, setResetTarget] = useState<User | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [usersData, orgsData] = await Promise.all([
        listUsers(),
        listOrganizations().catch(() => [] as Organization[]),
      ])
      setUsers(usersData)
      const map: Record<string, string> = {}
      orgsData.forEach((o) => { map[o.id] = o.name })
      setOrgMap(map)
    } catch {
      setError('Erro ao carregar usuários.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const canCreate = creatableRoles(myRole).length > 0

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Usuários</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {canCreate && (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />Novo usuário
            </Button>
          )}
        </div>
      </div>

      {loading && <SkeletonTable rows={5} cols={6} />}

      {!loading && error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!loading && !error && users.length === 0 && (
        <EmptyState icon={Users} title="Nenhum usuário encontrado" />
      )}

      {!loading && !error && users.length > 0 && (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                <th className="px-4 py-3 text-left">Nome</th>
                <th className="px-4 py-3 text-left">E-mail</th>
                <th className="px-4 py-3 text-left">Perfil</th>
                <th className="px-4 py-3 text-left">Organização</th>
                <th className="px-4 py-3 text-left">Último login</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">
                    {u.name}
                    {u.telegramId && (
                      <span className="ml-2 text-xs text-muted-foreground">📱</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3"><RoleBadge role={u.role} /></td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.organizationId ? (orgMap[u.organizationId] ?? u.organizationId.slice(0, 8) + '…') : '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {fmt(u.lastLoginAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar" onClick={() => setEditTarget(u)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Resetar senha" onClick={() => setResetTarget(u)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                      {u.id !== myId && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Desativar" onClick={() => setDeactivateTarget(u)}>
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
      <EditDialog user={editTarget} open={editTarget !== null} onClose={() => setEditTarget(null)} onUpdated={load} />
      <ResetPasswordDialog user={resetTarget} open={resetTarget !== null} onClose={() => setResetTarget(null)} />
      <DeactivateDialog user={deactivateTarget} open={deactivateTarget !== null} onClose={() => setDeactivateTarget(null)} onDeactivated={load} />
    </div>
  )
}
