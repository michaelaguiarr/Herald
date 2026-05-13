import { useState, useCallback, useEffect } from 'react'
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { RefreshCw, TrendingUp, AlertCircle, Smartphone, CheckCircle, Zap } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelStatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { getDashboardSummary } from '@/services/dashboard.service'
import { listChannels } from '@/services/channels.service'
import { useUIStore } from '@/store/ui.store'
import { useInterval } from '@/hooks/useInterval'
import { DashboardSummary, DashboardPeriod, Channel, ChannelStatus } from '@/types/api.types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

// ─── Constants ────────────────────────────────────────────────────────────────

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'today', label: 'Hoje' },
  { value: '7d',    label: '7 dias' },
  { value: '30d',   label: '30 dias' },
]

const STATUS_COLORS: Record<string, string> = {
  ENVIADO:          '#22c55e',
  PENDENTE:         '#eab308',
  FALHOU:           '#f97316',
  FALHOU_DEFINITIVO:'#ef4444',
  AGENDADO:         '#3b82f6',
  CANCELADO:        '#9ca3af',
}

const CHANNEL_COLORS: Record<string, string> = {
  WHATSAPP: '#25d366',
  EMAIL:    '#8b5cf6',
  TELEGRAM: '#0ea5e9',
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, icon: Icon, className,
}: {
  label: string; value: React.ReactNode; icon: React.ElementType; className?: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
            <p className={cn('text-2xl font-bold mt-1', className)}>{value}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── WA Session Row ───────────────────────────────────────────────────────────

function WaSessionRow({ channel }: { channel: Channel }) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3">
        <Smartphone className="h-4 w-4 text-muted-foreground shrink-0" />
        <div>
          <p className="text-sm font-medium">{channel.label}</p>
          <p className="text-xs text-muted-foreground">
            {channel.sentToday}/{channel.dailyLimit} hoje
            {channel.lastUsedAt && ` · ${new Date(channel.lastUsedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>
      <ChannelStatusBadge status={channel.status as ChannelStatus} />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [period, setPeriod] = useState<DashboardPeriod>('7d')
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [waChannels, setWaChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const failedCount = useUIStore((s) => s.failedCount)

  const load = useCallback(async (showToast = false) => {
    setError('')
    try {
      const [sum, channels] = await Promise.all([
        getDashboardSummary(period),
        listChannels('WHATSAPP'),
      ])
      setSummary(sum)
      setWaChannels(channels)
      if (showToast) toast.success('Dashboard atualizado')
    } catch {
      setError('Não foi possível carregar as métricas.')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // Auto-refresh every 60s
  useInterval(() => load(false), 60_000)

  const activeWa = summary?.channels.find((c) => c.status === 'ACTIVE')?.count ?? 0

  // ── Skeleton ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-6">
          <Card><CardContent className="p-5"><Skeleton className="h-48 w-full" /></CardContent></Card>
          <Card><CardContent className="p-5"><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Tentar novamente</Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Visão Geral</h1>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex rounded-md border overflow-hidden">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  'px-3 py-1.5 text-xs font-medium transition-colors',
                  period === p.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-background text-muted-foreground hover:bg-muted'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => load(true)}>
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total enviado"
          value={summary?.totalNotifications.toLocaleString('pt-BR') ?? '—'}
          icon={TrendingUp}
        />
        <KpiCard
          label="Taxa de entrega"
          value={summary ? `${summary.deliveryRate.toFixed(1)}%` : '—'}
          icon={CheckCircle}
          className="text-green-600"
        />
        <KpiCard
          label="Falhas definitivas"
          value={failedCount.toLocaleString('pt-BR')}
          icon={AlertCircle}
          className={failedCount > 0 ? 'text-destructive' : undefined}
        />
        <KpiCard
          label="WA ativos"
          value={activeWa.toLocaleString('pt-BR')}
          icon={Smartphone}
          className="text-emerald-600"
        />
      </div>

      {/* Charts */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Bar chart — by status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Envios por status</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.byStatus.length ? (
              <EmptyState title="Sem dados no período" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.byStatus} margin={{ top: 4, right: 8, left: -20, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    dataKey="status"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v) => v.replace('_DEFINITIVO', '').replace('_', ' ')}
                  />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip
                    formatter={(value) => [value, 'Envios']}
                    labelFormatter={(l) => l.replace(/_/g, ' ')}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {summary.byStatus.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? '#94a3b8'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Pie chart — by channel */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Distribuição por canal</CardTitle>
          </CardHeader>
          <CardContent>
            {!summary?.byChannel.length ? (
              <EmptyState title="Sem dados no período" />
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={summary.byChannel}
                    dataKey="count"
                    nameKey="channelType"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) =>
                      `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                    }
                    labelLine={false}
                  >
                    {summary.byChannel.map((entry) => (
                      <Cell key={entry.channelType} fill={CHANNEL_COLORS[entry.channelType] ?? '#94a3b8'} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value, name) => [value, name]} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* WA Sessions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Sessões WhatsApp</CardTitle>
        </CardHeader>
        <CardContent>
          {!waChannels.length ? (
            <EmptyState
              icon={Smartphone}
              title="Nenhuma sessão WhatsApp"
              description="Crie um canal WhatsApp em Canais para começar."
            />
          ) : (
            <div>
              {waChannels.map((ch) => (
                <WaSessionRow key={ch.id} channel={ch} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* JID Cache Stats — only shown when backend returns the field and has data */}
      {summary?.jidCacheStats &&
        summary.jidCacheStats.hits + summary.jidCacheStats.misses > 0 && (
          <JidCacheCard stats={summary.jidCacheStats} />
        )}
    </div>
  )
}

// ─── JID Cache Card ───────────────────────────────────────────────────────────

function JidCacheCard({ stats }: { stats: { hits: number; misses: number } }) {
  const total = stats.hits + stats.misses
  const hitRate = total > 0 ? (stats.hits / total) * 100 : 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          Cache JID WhatsApp
          <span
            className="text-xs font-normal text-muted-foreground cursor-default ml-auto"
            title="Verificações de número WhatsApp servidas pelo cache Redis nas últimas 24h"
          >
            ⓘ últimas 24h
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Hit rate — primary metric */}
          <div>
            <p className="text-2xl font-bold text-amber-500">{hitRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground">Hit rate</p>
          </div>

          <div className="h-8 w-px bg-border shrink-0" />

          {/* Breakdown */}
          <div className="flex gap-4 text-sm">
            <div>
              <p className="font-semibold text-green-600">{stats.hits.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Hits</p>
            </div>
            <div>
              <p className="font-semibold text-muted-foreground">{stats.misses.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Misses</p>
            </div>
            <div>
              <p className="font-semibold">{total.toLocaleString('pt-BR')}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
