import { useEffect, useState, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts'
import { apiFetch, type DashboardSummary } from '../api'
import Spinner from '../components/Spinner'
import ErrorBanner from '../components/ErrorBanner'

type Period = 'today' | '7d' | '30d'

const STATUS_COLOR: Record<string, string> = {
  ENVIADO: '#10b981',
  PENDENTE: '#f59e0b',
  AGENDADO: '#6366f1',
  FALHOU: '#f97316',
  FALHOU_DEFINITIVO: '#dc2626',
  CANCELADO: '#9ca3af',
}

const CHANNEL_COLOR: Record<string, string> = {
  WHATSAPP: '#25d366',
  EMAIL: '#3b82f6',
  TELEGRAM: '#0088cc',
}

const SESSION_COLOR: Record<string, string> = {
  ACTIVE: '#10b981',
  WARMING: '#f59e0b',
  DISCONNECTED: '#6b7280',
  BANNED: '#dc2626',
}

const PERIOD_LABELS: Record<Period, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
}

function StatCard({ label, value, color = '#1d4ed8', sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: '20px 24px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', minWidth: 140 }}>
      <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function Summary({ token }: { token: string }) {
  const [period, setPeriod] = useState<Period>('7d')
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true); setError('')
    apiFetch<DashboardSummary>(`/v1/dashboard/summary?period=${period}`, token)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [period, token])

  useEffect(() => { load() }, [load])

  return (
    <div>
      {/* Header + period selector */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Visão Geral</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['today', '7d', '30d'] as Period[]).map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500,
                background: period === p ? '#1d4ed8' : '#f3f4f6',
                color: period === p ? '#fff' : '#374151',
                border: 'none', cursor: 'pointer',
              }}>
              {PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: '40px 0', textAlign: 'center' }}><Spinner /><p style={{ marginTop: 12, color: '#6b7280' }}>Carregando métricas…</p></div>}
      {error && <ErrorBanner message={error} onRetry={load} />}

      {!loading && !error && data && (
        <>
          {/* Stat cards */}
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 32 }}>
            <StatCard label="Total de notificações" value={data.totalNotifications} />
            <StatCard label="Taxa de entrega" value={`${data.deliveryRate}%`} color="#10b981"
              sub={data.totalNotifications === 0 ? 'sem dados' : undefined} />
            <StatCard label="Falhas definitivas"
              value={data.byStatus.find(s => s.status === 'FALHOU_DEFINITIVO')?.count ?? 0}
              color="#dc2626" />
            <StatCard label="Agendadas"
              value={data.byStatus.find(s => s.status === 'AGENDADO')?.count ?? 0}
              color="#6366f1" />
          </div>

          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {/* Status bar chart */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, flex: '1 1 320px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Por status</h3>
              {data.byStatus.length === 0
                ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Sem dados no período.</p>
                : (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.byStatus} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="status" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Notificações" radius={[4, 4, 0, 0]}>
                      {data.byStatus.map((entry) => (
                        <Cell key={entry.status} fill={STATUS_COLOR[entry.status] ?? '#9ca3af'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel pie chart */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, flex: '1 1 240px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Por canal</h3>
              {data.byChannel.length === 0
                ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Sem dados no período.</p>
                : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={data.byChannel} dataKey="count" nameKey="channelType" cx="50%" cy="50%" outerRadius={70} label={({ channelType, percent }) => `${channelType} ${(percent * 100).toFixed(0)}%`}>
                      {data.byChannel.map((entry) => (
                        <Cell key={entry.channelType} fill={CHANNEL_COLOR[entry.channelType] ?? '#9ca3af'} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Channel sessions */}
            <div style={{ background: '#fff', borderRadius: 12, padding: 20, flex: '1 1 240px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Sessões WhatsApp</h3>
              {data.channels.length === 0
                ? <p style={{ color: '#9ca3af', fontSize: 13 }}>Nenhum canal cadastrado.</p>
                : data.channels.map((c) => (
                  <div key={c.status} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
                    <span style={{ fontSize: 13, color: SESSION_COLOR[c.status] ?? '#374151', fontWeight: 500 }}>
                      ● {c.status}
                    </span>
                    <span style={{ fontSize: 16, fontWeight: 700 }}>{c.count}</span>
                  </div>
                ))
              }
            </div>
          </div>
        </>
      )}
    </div>
  )
}
