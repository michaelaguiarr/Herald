import { useState, useCallback, useEffect } from 'react'
import { CheckCircle, RefreshCw, UserCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { EmptyState } from '@/components/shared/EmptyState'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import { Pagination } from '@/components/shared/Pagination'
import { listOptOuts, deleteOptOut } from '@/services/opt-outs.service'
import { getApiErrorMessage } from '@/services/api'
import { OptOut } from '@/types/api.types'

// ─── Confirm dialog ───────────────────────────────────────────────────────────

function ReactivateDialog({
  optOut,
  open,
  onClose,
  onReactivated,
}: {
  optOut: OptOut | null
  open: boolean
  onClose: () => void
  onReactivated: (phone: string) => void
}) {
  const [loading, setLoading] = useState(false)

  async function confirm() {
    if (!optOut) return
    setLoading(true)
    try {
      await deleteOptOut(optOut.phone)
      toast.success(`${optOut.phone} reativado — voltará a receber notificações.`)
      onReactivated(optOut.phone)
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
          <DialogTitle>Reativar número</DialogTitle>
          <DialogDescription>
            Tem certeza que deseja reativar <strong>{optOut?.phone}</strong>?
            O número voltará a receber notificações.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirm} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Reativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function fmt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function OptOutsPage() {
  const [data, setData] = useState<OptOut[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<OptOut | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await listOptOuts(page, 20)
      setData(res.data)
      setTotal(res.total)
      setPages(res.pages)
    } catch {
      setError('Erro ao carregar opt-outs.')
    } finally {
      setLoading(false)
    }
  }, [page])

  useEffect(() => { load() }, [load])

  function handleReactivated(phone: string) {
    // Remove from local list immediately — no extra round-trip needed
    setData((prev) => prev.filter((o) => o.phone !== phone))
    setTotal((t) => Math.max(0, t - 1))
    setConfirmTarget(null)
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">Opt-outs</h1>
          {!loading && total > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {total} número{total !== 1 ? 's' : ''} que optaram por não receber mensagens
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* States */}
      {loading && <SkeletonTable rows={5} cols={4} />}

      {!loading && error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!loading && !error && data.length === 0 && (
        <EmptyState
          icon={CheckCircle}
          title="Nenhum opt-out registrado"
          description="Todos os destinatários estão ativos e aptos a receber notificações."
        />
      )}

      {!loading && !error && data.length > 0 && (
        <div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3 text-left">Número</th>
                  <th className="px-4 py-3 text-left">Motivo</th>
                  <th className="px-4 py-3 text-left">Data do opt-out</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-sm font-medium">{o.phone}</td>
                    <td className="px-4 py-3">
                      {o.reason ? (
                        <span className="text-sm text-muted-foreground italic max-w-xs truncate block" title={o.reason}>
                          "{o.reason}"
                        </span>
                      ) : (
                        <Badge className="bg-gray-100 text-gray-600 border-gray-200 border text-xs font-medium">
                          Automático
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {fmt(o.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => setConfirmTarget(o)}
                      >
                        <UserCheck className="h-3 w-3" />
                        Reativar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
        </div>
      )}

      <ReactivateDialog
        optOut={confirmTarget}
        open={confirmTarget !== null}
        onClose={() => setConfirmTarget(null)}
        onReactivated={handleReactivated}
      />
    </div>
  )
}
