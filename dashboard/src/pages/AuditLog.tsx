import { useEffect, useState, useCallback } from 'react'
import { apiFetch, type AuditLogEntry } from '../api'
import Spinner from '../components/Spinner'
import ErrorBanner from '../components/ErrorBanner'

interface Page {
  data: AuditLogEntry[]
  total: number
  page: number
  pages: number
}

const ACTION_COLOR: Record<string, string> = {
  LOGIN: '#6366f1',
  NOTIFICATION_QUEUED: '#3b82f6',
  NOTIFICATION_BROADCAST: '#8b5cf6',
  NOTIFICATION_SCHEDULED: '#6366f1',
  NOTIFICATION_MANUAL_RETRY: '#f59e0b',
  NOTIFICATION_FALHOU_DEFINITIVO: '#dc2626',
  WHATSAPP_BANNED: '#dc2626',
  CHANNEL_CREATED: '#10b981',
  CHANNEL_UPDATED: '#f59e0b',
  CHANNEL_DELETED: '#6b7280',
  CHANNEL_RECONNECT: '#f59e0b',
  ORGANIZATION_API_KEY_GENERATED: '#8b5cf6',
}

function ActionBadge({ action }: { action: string }) {
  const color = ACTION_COLOR[action] ?? '#374151'
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 4,
      fontSize: 11, fontWeight: 600, background: color + '20', color,
    }}>
      {action.replace(/_/g, ' ')}
    </span>
  )
}

export default function AuditLog({ token }: { token: string }) {
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [state, setState] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true); setError('')
    const params = new URLSearchParams({ page: String(page), limit: '50' })
    if (actionFilter) params.set('action', actionFilter)
    apiFetch<Page>(`/v1/audit-logs?${params}`, token)
      .then(setState)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [page, actionFilter, token])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Audit Log</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            placeholder="Filtrar por ação…"
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1) }}
            style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, width: 200 }}
          />
          <button onClick={load} disabled={loading}
            style={{ background: '#f3f4f6', color: '#374151', padding: '6px 14px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer' }}>
            {loading ? '⟳' : '↻'}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: '40px 0', textAlign: 'center' }}><Spinner /><p style={{ marginTop: 12, color: '#6b7280' }}>Carregando…</p></div>}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && state && (
        <>
          <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
            {state.total} registro(s)
          </p>
          <div style={{ background: '#fff', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  {['Data/Hora', 'Ação', 'Tipo', 'ID alvo', 'Ator', 'IP'].map((h) => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#374151' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.data.length === 0
                  ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#9ca3af' }}>
                        Nenhum registro encontrado.
                      </td>
                    </tr>
                  )
                  : state.data.map((entry, idx) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f3f4f6', background: idx % 2 === 0 ? '#fff' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: '#6b7280' }}>
                        {new Date(entry.createdAt).toLocaleString('pt-BR')}
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <ActionBadge action={entry.action} />
                      </td>
                      <td style={{ padding: '10px 14px', color: '#6b7280' }}>
                        {entry.targetType ?? '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>
                        {entry.targetId ? entry.targetId.slice(0, 8) + '…' : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#374151' }}>
                        {entry.userId ? entry.userId.slice(0, 8) + '…' : <span style={{ color: '#6366f1', fontSize: 11 }}>sistema</span>}
                      </td>
                      <td style={{ padding: '10px 14px', color: '#9ca3af', fontSize: 11 }}>
                        {entry.ipAddress ?? '—'}
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {state.pages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 24 }}>
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                style={{ padding: '6px 14px', borderRadius: 8, background: page <= 1 ? '#f3f4f6' : '#1d4ed8', color: page <= 1 ? '#9ca3af' : '#fff', border: 'none', cursor: page <= 1 ? 'default' : 'pointer' }}>
                ← Anterior
              </button>
              <span style={{ padding: '6px 14px', fontSize: 13, color: '#374151' }}>
                Página {page} de {state.pages}
              </span>
              <button disabled={page >= state.pages} onClick={() => setPage(p => p + 1)}
                style={{ padding: '6px 14px', borderRadius: 8, background: page >= state.pages ? '#f3f4f6' : '#1d4ed8', color: page >= state.pages ? '#9ca3af' : '#fff', border: 'none', cursor: page >= state.pages ? 'default' : 'pointer' }}>
                Próxima →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
