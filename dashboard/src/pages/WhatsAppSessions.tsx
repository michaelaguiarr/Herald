import { useState, useCallback, useEffect } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { RefreshCw, Smartphone, Wifi, WifiOff, AlertTriangle, CheckCircle2, Loader2, RotateCcw, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ChannelStatusBadge } from '@/components/shared/StatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { listChannels, reconnectChannel, disconnectChannel } from '@/services/channels.service'
import { useQrCodeSse } from '@/hooks/useQrCodeSse'
import { useInterval } from '@/hooks/useInterval'
import { Channel, ChannelStatus } from '@/types/api.types'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function warmingProgressPct(createdAt: string): number {
  const elapsedDays = (Date.now() - new Date(createdAt).getTime()) / 86_400_000
  return Math.min((elapsedDays / 7) * 100, 100)
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// ─── QR Code modal ────────────────────────────────────────────────────────────

function QrModal({
  channelId,
  channelLabel,
  open,
  onClose,
  onConnected,
}: {
  channelId: string
  channelLabel: string
  open: boolean
  onClose: () => void
  onConnected: () => void
}) {
  const { state, retry } = useQrCodeSse(open ? channelId : null)

  useEffect(() => {
    if (state.phase === 'connected') {
      toast.success(`${channelLabel} conectado!`)
      onConnected()
      onClose()
    }
  }, [state.phase, channelLabel, onConnected, onClose])

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Conectar {channelLabel}</DialogTitle>
          <DialogDescription>
            Abra o WhatsApp no seu celular e escaneie o QR Code abaixo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          {state.phase === 'connecting' && (
            <>
              <div className="flex h-48 w-48 items-center justify-center rounded-lg border bg-muted">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">Gerando QR Code…</p>
            </>
          )}

          {state.phase === 'qr' && (
            <>
              <div className="rounded-lg border p-3 bg-white shadow-sm">
                <QRCodeSVG value={state.qrData} size={192} />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                O QR Code atualiza a cada 30s. Tempo limite: 60s.
              </p>
            </>
          )}

          {state.phase === 'connected' && (
            <div className="flex flex-col items-center gap-2 py-6">
              <CheckCircle2 className="h-12 w-12 text-green-500" />
              <p className="font-medium text-green-700">Conectado!</p>
            </div>
          )}

          {state.phase === 'timeout' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <AlertTriangle className="h-10 w-10 text-yellow-500" />
              <p className="text-sm font-medium">Tempo esgotado</p>
              <p className="text-xs text-muted-foreground text-center">
                O QR Code expirou. Tente novamente.
              </p>
              <Button size="sm" onClick={retry}>
                <RotateCcw className="h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          )}

          {state.phase === 'error' && (
            <div className="flex flex-col items-center gap-3 py-4">
              <AlertTriangle className="h-10 w-10 text-destructive" />
              <p className="text-sm font-medium">Erro na conexão</p>
              <p className="text-xs text-muted-foreground">{state.message}</p>
              <Button size="sm" onClick={retry}>
                <RotateCcw className="h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({
  channel,
  onConnect,
  onRefresh,
  onDisconnected,
}: {
  channel: Channel
  onConnect: (ch: Channel) => void
  onRefresh: () => void
  onDisconnected: (id: string) => void
}) {
  const [reconnecting, setReconnecting] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const isBanned = channel.status === 'BANNED'
  const isWarming = channel.status === 'WARMING'
  const isDisconnected = channel.status === 'DISCONNECTED'
  const isActive = channel.status === 'ACTIVE'
  const isInactive = channel.status === 'INACTIVE'
  const canDisconnect = isActive || isWarming

  const statusIcon = {
    ACTIVE:       <Wifi          className="h-4 w-4 text-green-500" />,
    WARMING:      <Loader2       className="h-4 w-4 text-blue-500 animate-spin" />,
    // animate-pulse signals automatic reconnection is in progress
    DISCONNECTED: <WifiOff       className="h-4 w-4 text-yellow-500 animate-pulse" />,
    BANNED:       <AlertTriangle className="h-4 w-4 text-red-500" />,
    INACTIVE:     <WifiOff       className="h-4 w-4 text-gray-400" />,
  }[channel.status as ChannelStatus] ?? null

  async function handleReconnect() {
    setReconnecting(true)
    try {
      await reconnectChannel(channel.id)
      onConnect(channel)
    } catch {
      toast.error('Erro ao iniciar reconexão')
    } finally {
      setReconnecting(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await disconnectChannel(channel.id)
      toast.success('Sessão encerrada com sucesso.')
      setConfirmDisconnect(false)
      onDisconnected(channel.id)
    } catch {
      toast.error('Erro ao encerrar sessão')
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <>
    <Card className={cn(isBanned && 'border-red-200 bg-red-50/30', isInactive && 'opacity-60')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            {statusIcon}
            <CardTitle className="text-base truncate">{channel.label}</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <div className="flex items-center gap-1.5">
              <ChannelStatusBadge status={channel.status} />
              {canDisconnect && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-red-400 hover:text-red-600 hover:bg-red-50"
                  title="Desconectar sessão"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isDisconnected && (
              <span
                className="flex items-center gap-1 text-[11px] text-yellow-600"
                title="Desconectado — reconexão automática em andamento"
              >
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Reconectando em breve…
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">Enviados hoje</p>
            <p className="font-medium">{channel.sentToday} / {channel.dailyLimit}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Última atividade</p>
            <p className="font-medium">{fmtTime(channel.lastUsedAt)}</p>
          </div>
        </div>

        {/* Warming progress */}
        {isWarming && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Aquecimento (7 dias)</span>
              <span className="font-medium">{Math.round(warmingProgressPct(channel.createdAt))}%</span>
            </div>
            <Progress value={warmingProgressPct(channel.createdAt)} className="h-1.5" />
          </div>
        )}

        {/* BANNED message */}
        {isBanned && (
          <p className="text-xs text-red-600 bg-red-50 rounded-md p-2 border border-red-200">
            Este número foi banido pelo WhatsApp. Não é possível enviar mensagens.
          </p>
        )}

        {/* Actions */}
        {!isBanned && !isInactive && !isActive && (
          <Button
            size="sm"
            variant={isDisconnected ? 'destructive' : 'default'}
            className="w-full"
            disabled={reconnecting}
            onClick={isDisconnected ? handleReconnect : () => onConnect(channel)}
          >
            {reconnecting ? (
              <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Reconectando…</>
            ) : isDisconnected ? (
              <><RotateCcw className="h-3.5 w-3.5" /> Reconectar</>
            ) : (
              <><Smartphone className="h-3.5 w-3.5" /> Conectar via QR</>
            )}
          </Button>
        )}

        {isActive && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => onConnect(channel)}
          >
            <Smartphone className="h-3.5 w-3.5" />
            Ver QR Code
          </Button>
        )}
      </CardContent>
    </Card>

    {/* Disconnect confirmation dialog */}
    <Dialog open={confirmDisconnect} onOpenChange={(v) => !v && setConfirmDisconnect(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Desconectar WhatsApp?</DialogTitle>
          <DialogDescription>
            A sessão <strong>{channel.label}</strong> será encerrada e o número precisará
            ser reconectado via QR Code. Deseja continuar?
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
            Desconectar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WhatsAppSessionsPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [qrTarget, setQrTarget] = useState<Channel | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const data = await listChannels('WHATSAPP')
      setChannels(data)
    } catch {
      setError('Erro ao carregar sessões WhatsApp.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useInterval(() => load(true), 30_000)

  function handleConnect(channel: Channel) {
    setQrTarget(channel)
  }

  function handleConnected() {
    // Immediate refresh — might still get stale data because the backend
    // emits the SSE event before committing the DB status update (race condition).
    load(true)
    // Follow-up fetch after 1.5s gives the DB update time to commit,
    // guaranteeing the card reflects the definitive post-connection status.
    setTimeout(() => load(true), 1500)
  }

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-lg" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
        <p className="text-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={() => load()}>Tentar novamente</Button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold">Sessões WhatsApp</h1>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Atualizar
        </Button>
      </div>

      {channels.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title="Nenhum canal WhatsApp"
          description="Crie um canal WhatsApp na tela Canais para começar."
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {channels.map((ch) => (
            <SessionCard
              key={ch.id}
              channel={ch}
              onConnect={handleConnect}
              onRefresh={() => load(true)}
              onDisconnected={(id) => {
                // Optimistic: flip to DISCONNECTED without waiting for polling
                setChannels((prev) =>
                  prev.map((c) => c.id === id ? { ...c, status: 'DISCONNECTED' as const } : c)
                )
              }}
            />
          ))}
        </div>
      )}

      {qrTarget && (
        <QrModal
          channelId={qrTarget.id}
          channelLabel={qrTarget.label}
          open={qrTarget !== null}
          onClose={() => setQrTarget(null)}
          onConnected={handleConnected}
        />
      )}
    </div>
  )
}
