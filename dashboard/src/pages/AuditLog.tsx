import { useState, useCallback, useEffect, useRef } from 'react'
import { ClipboardList, Download, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/shared/EmptyState'
import { SkeletonTable } from '@/components/shared/SkeletonTable'
import { Pagination } from '@/components/shared/Pagination'
import { listAuditLogs } from '@/services/audit-logs.service'
import { AuditLogEntry } from '@/types/api.types'
import { cn } from '@/lib/utils'

// ─── Constants ────────────────────────────────────────────────────────────────

const TARGET_TYPES = [
  { value: 'all',          label: 'Todos os recursos' },
  { value: 'user',         label: 'Usuário' },
  { value: 'channel',      label: 'Canal' },
  { value: 'notification', label: 'Notificação' },
  { value: 'organization', label: 'Organização' },
]

// Color-code actions by severity / nature
function actionClass(action: string): string {
  const u = action.toUpperCase()
  if (u.includes('CREATED') || u.includes('QUEUED') || u === 'LOGIN') return 'bg-green-100 text-green-800 border-green-200'
  if (u.includes('DELETED') || u.includes('BANNED') || u.includes('DEFINITIVO') || u.includes('DESCONECTADA')) return 'bg-red-100 text-red-800 border-red-200'
  if (u.includes('API_KEY')) return 'bg-purple-100 text-purple-800 border-purple-200'
  if (u.includes('UPDATED') || u.includes('RECONNECT') || u.includes('RETRY') || u.includes('SCHEDULED') || u.includes('BROADCAST')) return 'bg-amber-100 text-amber-800 border-amber-200'
  return 'bg-gray-100 text-gray-600 border-gray-200'
}

function actionLabel(action: string): string {
  return action.replace(/_/g, ' ')
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

function fmtFull(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'medium' })
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function escapeCell(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function exportToCsv(entries: AuditLogEntry[], filters: { action: string; targetType: string }) {
  if (!entries.length) {
    toast.warning('Nenhum dado para exportar.')
    return
  }

  const headers = ['Data/Hora', 'Ator', 'Tipo de ator', 'Ação', 'Tipo recurso', 'ID recurso', 'Org ID', 'IP']
  const rows = entries.map((e) => [
    fmtFull(e.createdAt),
    e.userId ?? 'sistema',
    e.userId ? 'humano' : 'sistema',
    e.action,
    e.targetType ?? '',
    e.targetId ?? '',
    e.organizationId ?? '',
    e.ipAddress ?? '',
  ])

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCell(String(cell))).join(','))
    .join('\n')

  // BOM for Excel UTF-8 compatibility
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const suffix = [filters.action, filters.targetType].filter(Boolean).join('-') || 'todos'
  a.download = `audit-log-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
  toast.success(`${entries.length} registros exportados.`)
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const isSystem = entry.userId === null

  return (
    <tr className="border-b hover:bg-muted/30 transition-colors">
      {/* Date */}
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {fmt(entry.createdAt)}
      </td>

      {/* Actor */}
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <Badge className={cn('border text-xs w-fit', isSystem
            ? 'bg-gray-100 text-gray-600 border-gray-200'
            : 'bg-blue-100 text-blue-800 border-blue-200'
          )}>
            {isSystem ? 'Sistema' : 'Humano'}
          </Badge>
          {!isSystem && (
            <span className="text-xs text-muted-foreground font-mono">
              {entry.userId!.slice(0, 8)}…
            </span>
          )}
        </div>
      </td>

      {/* Action */}
      <td className="px-4 py-3">
        <Badge className={cn('border text-xs', actionClass(entry.action))}>
          {actionLabel(entry.action)}
        </Badge>
      </td>

      {/* Resource */}
      <td className="px-4 py-3 text-xs">
        {entry.targetType && (
          <span className="font-medium capitalize">{entry.targetType}</span>
        )}
        {entry.targetId && (
          <span className="block text-muted-foreground font-mono">
            {entry.targetId.slice(0, 8)}…
          </span>
        )}
        {!entry.targetType && <span className="text-muted-foreground">—</span>}
      </td>

      {/* IP */}
      <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
        {entry.ipAddress ?? '—'}
      </td>
    </tr>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filters
  const [actionInput, setActionInput] = useState('')
  const [targetType, setTargetType] = useState('all')

  // Applied (debounced) action filter
  const [appliedAction, setAppliedAction] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleActionChange(value: string) {
    setActionInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setAppliedAction(value)
      setPage(1)
    }, 400)
  }

  function clearFilters() {
    setActionInput('')
    setAppliedAction('')
    setTargetType('all')
    setPage(1)
  }

  const hasFilters = appliedAction || targetType !== 'all'

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await listAuditLogs({
        page,
        limit: 50,
        action: appliedAction || undefined,
        targetType: targetType === 'all' ? undefined : targetType,
      })
      setEntries(res.data)
      setTotal(res.total)
      setPages(res.pages)
    } catch {
      setError('Erro ao carregar audit log.')
    } finally {
      setLoading(false)
    }
  }, [page, appliedAction, targetType])

  useEffect(() => { load() }, [load])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [targetType])

  async function handleExport() {
    try {
      // Fetch up to 100 records with current filters for export
      const res = await listAuditLogs({
        page: 1, limit: 100,
        action: appliedAction || undefined,
        targetType: targetType === 'all' ? undefined : targetType,
      })
      exportToCsv(res.data, { action: appliedAction, targetType })
      if (res.total > 100) {
        toast.info(`Exportados 100 de ${res.total} registros. Use filtros para exportar grupos menores.`)
      }
    } catch {
      toast.error('Erro ao exportar.')
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Audit Log</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Action text filter */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filtrar por ação…"
            value={actionInput}
            onChange={(e) => handleActionChange(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        {/* Target type select */}
        <Select value={targetType} onValueChange={(v) => { setTargetType(v); setPage(1) }}>
          <SelectTrigger className="w-44 h-9 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TARGET_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Clear filters */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
            <X className="h-3.5 w-3.5" />Limpar filtros
          </Button>
        )}

        {!loading && (
          <span className="text-xs text-muted-foreground ml-auto">
            {total.toLocaleString('pt-BR')} registro{total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Table */}
      {loading && <SkeletonTable rows={8} cols={5} />}

      {!loading && error && (
        <div className="py-8 text-center space-y-3">
          <p className="text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button>
        </div>
      )}

      {!loading && !error && entries.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="Nenhum registro encontrado"
          description={hasFilters ? 'Tente ajustar os filtros.' : 'Nenhuma ação registrada ainda.'}
        />
      )}

      {!loading && !error && entries.length > 0 && (
        <div>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  <th className="px-4 py-3 text-left">Data / Hora</th>
                  <th className="px-4 py-3 text-left">Ator</th>
                  <th className="px-4 py-3 text-left">Ação</th>
                  <th className="px-4 py-3 text-left">Recurso</th>
                  <th className="px-4 py-3 text-left">IP</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => <AuditRow key={e.id} entry={e} />)}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pages={pages} total={total} onPageChange={setPage} />
        </div>
      )}
    </div>
  )
}
