import { useState, useCallback, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Building2, Plus, Pencil, Trash2, Key, ShieldOff, Loader2,
  RefreshCw, Copy, Check, AlertTriangle,
} from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import {
  listOrganizations, createOrganization, updateOrganization,
  deactivateOrganization, generateApiKey, revokeApiKey,
} from '@/services/organizations.service'
import { Organization, UserRole } from '@/types/api.types'
import { getApiErrorMessage } from '@/services/api'
import { useAuthStore } from '@/store/auth.store'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface OrgTree {
  org: Organization
  children: Organization[]
}

function buildTree(orgs: Organization[]): OrgTree[] {
  const active = orgs.filter((o) => o.active)
  const roots = active.filter((o) => o.type === 'ORGANIZACAO').sort((a, b) => a.name.localeCompare(b.name))
  const filiais = active.filter((o) => o.type === 'FILIAL')

  return roots.map((root) => ({
    org: root,
    children: filiais
      .filter((f) => f.parentId === root.id)
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

// ─── Permission helper ────────────────────────────────────────────────────────

interface OrgPermissions {
  rename: boolean
  deactivate: boolean
  apiKey: boolean
}

function canManageOrg(
  role: UserRole | undefined,
  org: Organization,
  userOrgId: string,
): OrgPermissions {
  if (role === 'OWNER') return { rename: true, deactivate: true, apiKey: true }
  if (role === 'SUPER_ADMIN') {
    const inScope = org.id === userOrgId || org.parentId === userOrgId
    if (!inScope) return { rename: false, deactivate: false, apiKey: false }
    return { rename: true, deactivate: org.type === 'FILIAL', apiKey: true }
  }
  return { rename: false, deactivate: false, apiKey: false }
}

// ─── API Key modal (shown ONCE after generation) ──────────────────────────────

function ApiKeyModal({
  apiKey,
  orgName,
  onClose,
}: {
  apiKey: string
  orgName: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 3000)
    })
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            API Key gerada — {orgName}
          </DialogTitle>
        </DialogHeader>

        {/* One-time warning */}
        <div className="flex gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0 mt-0.5" />
          <p className="text-yellow-800">
            <strong>Esta chave será exibida apenas uma vez.</strong> Copie e guarde em local seguro.
            Após fechar este modal não será possível recuperá-la.
          </p>
        </div>

        {/* Key display */}
        <div className="flex gap-2">
          <Input
            readOnly
            value={apiKey}
            className="font-mono text-xs"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button size="icon" variant="outline" onClick={copy} title="Copiar">
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>

        <DialogFooter>
          <Button className="w-full" onClick={onClose} variant={copied ? 'default' : 'outline'}>
            {copied ? 'Já copiei — Fechar' : 'Fechar (sem copiar)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Rename dialog ────────────────────────────────────────────────────────────

const renameSchema = z.object({ name: z.string().min(2, 'Mínimo 2 caracteres') })
type RenameForm = z.infer<typeof renameSchema>

function RenameDialog({ org, open, onClose, onRenamed }: {
  org: Organization | null; open: boolean; onClose: () => void; onRenamed: () => void
}) {
  const form = useForm<RenameForm>({
    resolver: zodResolver(renameSchema) as never,
    defaultValues: { name: org?.name ?? '' },
  })
  useEffect(() => { if (org) form.reset({ name: org.name }) }, [org, form])

  async function onSubmit(values: RenameForm) {
    if (!org) return
    try {
      await updateOrganization(org.id, values.name)
      toast.success('Nome atualizado.')
      onClose(); onRenamed()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Renomear {org?.type === 'FILIAL' ? 'filial' : 'organização'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}Salvar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create dialog ────────────────────────────────────────────────────────────

const createOrgSchema = z.object({ name: z.string().min(2, 'Mínimo 2 caracteres') })
type CreateOrgForm = z.infer<typeof createOrgSchema>

function CreateOrgDialog({ open, onClose, onCreated, rootOrgs }: {
  open: boolean; onClose: () => void; onCreated: () => void; rootOrgs: Organization[]
}) {
  const [orgType, setOrgType] = useState<'ORGANIZACAO' | 'FILIAL'>('ORGANIZACAO')
  const [parentId, setParentId] = useState('')
  const [parentError, setParentError] = useState('')

  const form = useForm<CreateOrgForm>({
    resolver: zodResolver(createOrgSchema) as never,
    defaultValues: { name: '' },
  })

  function handleClose() {
    form.reset(); setOrgType('ORGANIZACAO'); setParentId(''); setParentError(''); onClose()
  }

  async function onSubmit(values: CreateOrgForm) {
    if (orgType === 'FILIAL' && !parentId) {
      setParentError('Selecione a organização pai')
      return
    }
    try {
      await createOrganization({
        name: values.name,
        type: orgType,
        parentId: orgType === 'FILIAL' ? parentId : undefined,
      })
      toast.success(`${orgType === 'ORGANIZACAO' ? 'Organização' : 'Filial'} criada com sucesso.`)
      handleClose(); onCreated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Criar organização</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Tipo</label>
          <Select value={orgType} onValueChange={(v) => { setOrgType(v as 'ORGANIZACAO' | 'FILIAL'); setParentId(''); setParentError('') }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ORGANIZACAO">Organização (paróquia)</SelectItem>
              <SelectItem value="FILIAL">Filial (comunidade)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {orgType === 'FILIAL' && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Organização pai <span className="text-destructive">*</span></label>
            <Select value={parentId} onValueChange={(v) => { setParentId(v); setParentError('') }}>
              <SelectTrigger className={parentError ? 'border-destructive' : ''}>
                <SelectValue placeholder="Selecione a organização…" />
              </SelectTrigger>
              <SelectContent>
                {rootOrgs.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {parentError && <p className="text-xs text-destructive">{parentError}</p>}
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}Criar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Create filial dialog (SUPER_ADMIN) ──────────────────────────────────────

function CreateFilialDialog({ open, onClose, onCreated, parentId }: {
  open: boolean; onClose: () => void; onCreated: () => void; parentId: string
}) {
  const form = useForm<CreateOrgForm>({
    resolver: zodResolver(createOrgSchema) as never,
    defaultValues: { name: '' },
  })

  function handleClose() { form.reset(); onClose() }

  async function onSubmit(values: CreateOrgForm) {
    try {
      await createOrganization({ name: values.name, type: 'FILIAL', parentId })
      toast.success('Filial criada com sucesso.')
      handleClose(); onCreated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova filial</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}Criar
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Deactivate confirm ───────────────────────────────────────────────────────

function DeactivateOrgDialog({ org, open, onClose, onDeactivated, isSuperAdmin = false }: {
  org: Organization | null; open: boolean; onClose: () => void; onDeactivated: () => void
  isSuperAdmin?: boolean
}) {
  const [loading, setLoading] = useState(false)
  async function confirm() {
    if (!org) return
    setLoading(true)
    try {
      await deactivateOrganization(org.id)
      toast.success(`"${org.name}" desativada.`)
      onClose(); onDeactivated()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally { setLoading(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desativar {org?.type === 'FILIAL' ? 'filial' : 'organização'}</DialogTitle>
          <DialogDescription>
            {isSuperAdmin
              ? 'Tem certeza que deseja desativar esta filial?'
              : <>Deseja desativar <strong>{org?.name}</strong>?{org?.type === 'ORGANIZACAO' && ' Todas as filiais vinculadas também serão afetadas.'}</>
            }
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

// ─── Revoke API key confirm ───────────────────────────────────────────────────

function RevokeApiKeyDialog({ org, open, onClose }: {
  org: Organization | null; open: boolean; onClose: () => void
}) {
  const [loading, setLoading] = useState(false)
  async function confirm() {
    if (!org) return
    setLoading(true)
    try {
      await revokeApiKey(org.id)
      toast.success('API Key revogada.')
      onClose()
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally { setLoading(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Revogar API Key</DialogTitle>
          <DialogDescription>
            Revogar a API Key de <strong>{org?.name}</strong>? A API externa perderá acesso imediatamente.
            Uma nova chave pode ser gerada a qualquer momento.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}Revogar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Org card ─────────────────────────────────────────────────────────────────

function OrgCard({
  org, isFilial = false, role, userOrgId,
  onRename, onDeactivate, onGenerateKey, onRevokeKey,
}: {
  org: Organization
  isFilial?: boolean
  role: UserRole | undefined
  userOrgId: string
  onRename: (o: Organization) => void
  onDeactivate: (o: Organization) => void
  onGenerateKey: (o: Organization) => void
  onRevokeKey: (o: Organization) => void
}) {
  const perms = canManageOrg(role, org, userOrgId)

  return (
    <div className={cn(
      'rounded-md border p-4 space-y-3',
      isFilial && 'ml-6 border-dashed bg-muted/20'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 className={cn('h-4 w-4 shrink-0', isFilial ? 'text-muted-foreground' : 'text-primary')} />
          <div className="min-w-0">
            <p className="font-medium text-sm truncate">{org.name}</p>
            <Badge className={cn('text-xs border mt-0.5', isFilial
              ? 'bg-slate-100 text-slate-600 border-slate-200'
              : 'bg-primary/10 text-primary border-primary/20'
            )}>
              {isFilial ? 'Filial' : 'Organização'}
            </Badge>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {perms.rename && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Renomear" onClick={() => onRename(org)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          )}
          {perms.apiKey && (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="Gerar / Regenerar API Key" onClick={() => onGenerateKey(org)}>
              <Key className="h-3.5 w-3.5" />
            </Button>
          )}
          {perms.apiKey && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-orange-600" title="Revogar API Key" onClick={() => onRevokeKey(org)}>
              <ShieldOff className="h-3.5 w-3.5" />
            </Button>
          )}
          {perms.deactivate && (
            <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" title="Desativar" onClick={() => onDeactivate(org)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrganizationsPage() {
  const user = useAuthStore((s) => s.user)
  const isSuperAdmin = user?.role === 'SUPER_ADMIN'

  const [tree, setTree] = useState<OrgTree[]>([])
  const [allOrgs, setAllOrgs] = useState<Organization[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<Organization | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<Organization | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Organization | null>(null)
  const [newApiKey, setNewApiKey] = useState<{ key: string; orgName: string } | null>(null)
  const [generatingKeyFor, setGeneratingKeyFor] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const data = await listOrganizations()
      setAllOrgs(data)
      setTree(buildTree(data))
    } catch {
      setError('Erro ao carregar organizações.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleGenerateKey(org: Organization) {
    setGeneratingKeyFor(org.id)
    try {
      const key = await generateApiKey(org.id)
      setNewApiKey({ key, orgName: org.name })
    } catch (err) {
      toast.error(getApiErrorMessage(err))
    } finally {
      setGeneratingKeyFor(null)
    }
  }

  const rootOrgs = allOrgs.filter((o) => o.type === 'ORGANIZACAO' && o.active)

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-9 w-32" />
        </div>
        {[1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-20 rounded-md" />
            <Skeleton className="h-16 rounded-md ml-6" />
            <Skeleton className="h-16 rounded-md ml-6" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Organizações</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />{isSuperAdmin ? 'Nova Filial' : 'Nova organização'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!error && tree.length === 0 && (
        <EmptyState icon={Building2} title="Nenhuma organização" description="Crie uma organização para começar." />
      )}

      {/* Tree */}
      {!error && tree.length > 0 && (
        <div className="space-y-6">
          {tree.map(({ org, children }) => (
            <div key={org.id} className="space-y-2">
              {/* Root org */}
              <OrgCard
                org={org}
                role={user?.role}
                userOrgId={user?.organizationId ?? ''}
                onRename={setRenameTarget}
                onDeactivate={setDeactivateTarget}
                onGenerateKey={handleGenerateKey}
                onRevokeKey={setRevokeTarget}
              />

              {/* Children (filiais) */}
              {children.length > 0 && (
                <div className="space-y-2">
                  {children.map((filial) => (
                    <OrgCard
                      key={filial.id}
                      org={filial}
                      isFilial
                      role={user?.role}
                      userOrgId={user?.organizationId ?? ''}
                      onRename={setRenameTarget}
                      onDeactivate={setDeactivateTarget}
                      onGenerateKey={handleGenerateKey}
                      onRevokeKey={setRevokeTarget}
                    />
                  ))}
                </div>
              )}

              {children.length === 0 && (
                <p className="ml-6 text-xs text-muted-foreground italic">Nenhuma filial</p>
              )}

              <Separator />
            </div>
          ))}
        </div>
      )}

      {/* Generating key spinner overlay */}
      {generatingKeyFor && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex items-center gap-3 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Gerando API Key…</span>
          </div>
        </div>
      )}

      {/* API Key one-time modal */}
      {newApiKey && (
        <ApiKeyModal
          apiKey={newApiKey.key}
          orgName={newApiKey.orgName}
          onClose={() => setNewApiKey(null)}
        />
      )}

      {isSuperAdmin ? (
        <CreateFilialDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={load}
          parentId={user?.organizationId ?? ''}
        />
      ) : (
        <CreateOrgDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={load}
          rootOrgs={rootOrgs}
        />
      )}
      <RenameDialog
        org={renameTarget}
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        onRenamed={load}
      />
      <DeactivateOrgDialog
        org={deactivateTarget}
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onDeactivated={load}
        isSuperAdmin={isSuperAdmin}
      />
      <RevokeApiKeyDialog
        org={revokeTarget}
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
      />
    </div>
  )
}
