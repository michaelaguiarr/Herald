import { useEffect, useState, useCallback } from 'react'
import { apiFetch, type FailedNotification } from '../api'
import Spinner from '../components/Spinner'
import ErrorBanner from '../components/ErrorBanner'

interface Page {
  data: FailedNotification[]
  total: number
  page: number
  pages: number
}

export default function FailedQueue({ token }: { token: string }) {
  const [page, setPage] = useState(1)
  const [state, setState] = useState<Page | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [retried, setRetried] = useState<Record<string, boolean>>({})

  const load = useCallback(() => {
    setLoading(true); setError('')
    apiFetch<Page>(`/v1/dashboard/failed?page=${page}&limit=20`, token)
      .then(setState)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [page, token])

  useEffect(() => { load() }, [load])

  async function handleRetry(id: string) {
    setRetrying((r) => ({ ...r, [id]: true }))
    try {
      await apiFetch(`/v1/notifications/${id}/retry`, token, { method: 'POST' })
      setRetried((r) => ({ ...r, [id]: true }))
      // Remove from list after a brief delay
      setTimeout(load, 1500)
    } catch (e) {
      alert(`Erro ao reenviar: ${e instanceof Error ? e.message : 'Erro desconhecido'}`)
    } finally {
      setRetrying((r) => ({ ...r, [id]: false }))
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Falhas Definitivas</h2>
        <button onClick={load} disabled={loading}
          style={{ background: '#f3f4f6', color: '#374151', padding: '6px 14px', borderRadius: 6, fontSize: 13, border: 'none', cursor: 'pointer' }}>
          {loading ? '⟳' : '↻ Atualizar'}
        </button>
      </div>

      {loading && <div style={{ padding: '40px 0', textAlign: 'center' }}><Spinner /><p style={{ marginTop: 12, color: '#6b7280' }}>Carregando…</p></div>}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && state && (
        <>
          {state.data.length === 0
            ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280' }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>Nenhuma falha definitiva</div>
                <div style={{ fontSize: 13, marginTop: 8 }}>Todas as notificações foram entregues com sucesso.</div>
              </div>
            )
            : (
              <>
                <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
                  {state.total} notificação(ões) com falha definitiva
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {state.data.map((n) => (
                    <div key={n.id} style={{
                      background: '#fff', borderRadius: 10, padding: '16px 20px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                      border: retried[n.id] ? '1px solid #10b981' : '1px solid #f3f4f6',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{n.recipientName}</div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                            {n.channelType} · {n.recipientPhone ?? n.recipientEmail ?? '—'} · {n.retryCycle} ciclo(s)
                          </div>
                          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60ch' }}>
                            {n.message}
                          </div>
                        </div>
                        <div style={{ marginLeft: 16, flexShrink: 0 }}>
                          {retried[n.id]
                            ? <span style={{ color: '#10b981', fontSize: 13 }}>✓ Reenviado</span>
                            : (
                              <button
                                onClick={() => handleRetry(n.id)}
                                disabled={retrying[n.id]}
                                style={{
                                  background: retrying[n.id] ? '#d1d5db' : '#1d4ed8',
                                  color: '#fff', border: 'none', borderRadius: 8,
                                  padding: '6px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                                }}>
                                {retrying[n.id] ? '⟳' : '↺ Reenviar'}
                              </button>
                            )
                          }
                        </div>
                      </div>
                      <div style={{ fontSize: 11, color: '#d1d5db', marginTop: 8 }}>
                        ID: {n.id} · {new Date(n.createdAt).toLocaleString('pt-BR')}
                      </div>
                    </div>
                  ))}
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
            )
          }
        </>
      )}
    </div>
  )
}
