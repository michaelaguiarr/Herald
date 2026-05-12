import { useEffect, useRef, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'

// ─── Types ────────────────────────────────────────────────────────────────────

type WaStatus = 'WARMING' | 'ACTIVE' | 'DISCONNECTED' | 'BANNED' | 'INACTIVE'

interface Channel {
  id: string
  label: string
  status: WaStatus
  organizationId: string
  createdAt: string
}

interface SseState {
  status: WaStatus
  qr: string | null
  qrAt: Date | null        // when the latest QR was received
  streamAlive: boolean     // SSE fetch stream is connected
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META: Record<WaStatus, { label: string; color: string; bg: string }> = {
  WARMING:      { label: 'Aguardando QR',  color: '#92400e', bg: '#fef3c7' },
  ACTIVE:       { label: 'Ativo',          color: '#065f46', bg: '#d1fae5' },
  DISCONNECTED: { label: 'Desconectado',   color: '#374151', bg: '#f3f4f6' },
  BANNED:       { label: 'Suspenso',       color: '#991b1b', bg: '#fee2e2' },
  INACTIVE:     { label: 'Inativo',        color: '#6b7280', bg: '#f9fafb' },
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 5)  return 'agora mesmo'
  if (s < 60) return `há ${s}s`
  return `há ${Math.floor(s / 60)}m${s % 60}s`
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WaStatus }) {
  const meta = STATUS_META[status] ?? STATUS_META.INACTIVE
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      color: meta.color, background: meta.bg,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: meta.color,
        animation: status === 'WARMING' ? 'pulse 1.5s infinite' : undefined,
      }} />
      {meta.label}
    </span>
  )
}

// ─── Session card ─────────────────────────────────────────────────────────────

function SessionCard({ channel, token }: { channel: Channel; token: string }) {
  const [sse, setSse] = useState<SseState>({
    status: channel.status,
    qr: null,
    qrAt: null,
    streamAlive: false,
  })
  const [reconnecting, setReconnecting] = useState(false)
  const [sseKey, setSseKey] = useState(0)          // increment to reopen SSE stream
  const [tick, setTick] = useState(0)               // 1s ticker for "time ago" display
  const abortRef = useRef<AbortController | null>(null)

  // 1-second ticker to keep "Atualizado há Xs" fresh
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  // SSE stream — auto-reconnects on drop, restarts when sseKey changes
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    abortRef.current = controller

    const decoder = new TextDecoder()

    async function connect() {
      while (!cancelled) {
        setSse((prev) => ({ ...prev, streamAlive: false }))
        try {
          const res = await fetch(`/v1/channels/${channel.id}/qrcode`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          })

          if (!res.ok || !res.body) {
            await sleep(3_000)
            continue
          }

          const reader = res.body.getReader()
          setSse((prev) => ({ ...prev, streamAlive: true }))
          let buffer = ''

          while (!cancelled) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              try {
                const evt = JSON.parse(line.slice(6))
                if (evt.type === 'status') {
                  setSse((prev) => ({ ...prev, status: evt.status as WaStatus }))
                }
                if (evt.type === 'qr') {
                  setSse((prev) => ({ ...prev, qr: evt.data as string, qrAt: new Date() }))
                }
              } catch {
                // ignore parse errors on malformed lines
              }
            }
          }
        } catch (err: unknown) {
          if (!cancelled && (err as { name?: string }).name !== 'AbortError') {
            setSse((prev) => ({ ...prev, streamAlive: false }))
            await sleep(3_000)
          }
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [channel.id, token, sseKey])

  const handleReconnect = useCallback(async () => {
    setReconnecting(true)
    setSse((prev) => ({ ...prev, qr: null, qrAt: null }))
    try {
      await fetch(`/v1/channels/${channel.id}/reconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      // Force SSE stream to reopen — new session emits events through the channel emitter
      setSseKey((k) => k + 1)
    } catch {
      // ignore — status will update via SSE anyway
    } finally {
      setReconnecting(false)
    }
  }, [channel.id, token])

  const canReconnect = sse.status !== 'ACTIVE' && sse.status !== 'INACTIVE'
  const isWaitingForQr = sse.status === 'WARMING' && sse.qr === null

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{channel.label}</div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
            {channel.organizationId.slice(0, 8)}…
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <StatusBadge status={sse.status} />
          <span style={{ fontSize: 10, color: sse.streamAlive ? '#10b981' : '#f59e0b' }}>
            {sse.streamAlive ? '● stream ativo' : '○ reconectando…'}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>

        {/* ACTIVE */}
        {sse.status === 'ACTIVE' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 32, marginBottom: 4 }}>✓</div>
            <div style={{ color: '#065f46', fontWeight: 600, fontSize: 14 }}>Sessão ativa</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
              Mensagens sendo entregues normalmente
            </div>
          </div>
        )}

        {/* WARMING — waiting for QR */}
        {isWaitingForQr && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <Spinner />
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 8 }}>
              Conectando ao WhatsApp…
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
              Aguarde até 30 segundos para o QR Code aparecer.
            </div>
            <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
              (Baileys busca versão do WA + estabelece WebSocket)
            </div>
          </div>
        )}

        {/* QR Code available */}
        {sse.qr && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 8, background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <QRCodeSVG value={sse.qr} size={200} level="M" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>
                Escaneie com o WhatsApp
              </div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Abra o app → Dispositivos conectados → Conectar dispositivo
              </div>
              {sse.qrAt && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                  {/* tick dependency keeps this live */}
                  QR gerado {timeAgo(sse.qrAt)}{tick > 0 ? '' : ''}
                </div>
              )}
            </div>
          </div>
        )}

        {/* DISCONNECTED */}
        {sse.status === 'DISCONNECTED' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>⚠</div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Sessão encerrada</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
              A conexão com o WhatsApp foi perdida.
            </div>
          </div>
        )}

        {/* BANNED */}
        {sse.status === 'BANNED' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>🚫</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b' }}>
              Número suspenso
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
              Este número foi suspenso pelo WhatsApp.
              <br />A tentativa de reconexão vai gerar um novo QR,
              <br />mas o número pode não voltar a funcionar.
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      {canReconnect && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            onClick={handleReconnect}
            disabled={reconnecting}
            style={{
              flex: 1, background: reconnecting ? '#d1d5db' : '#1d4ed8',
              color: '#fff', padding: '9px 0', borderRadius: 8, fontSize: 14, fontWeight: 600,
            }}
          >
            {reconnecting
              ? '⟳ Reconectando…'
              : sse.qr
                ? '↺ Gerar novo QR'
                : '↺ Conectar'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 36, height: 36, margin: '0 auto',
      border: '3px solid #e5e7eb',
      borderTop: '3px solid #1d4ed8',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
  )
}

// ─── Main list ────────────────────────────────────────────────────────────────

export default function WhatsAppSessions({ token }: { token: string }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    fetch('/v1/channels?type=WHATSAPP', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setChannels(data)
        else setError(data.message ?? 'Erro ao carregar canais')
      })
      .catch(() => setError('Falha na conexão com a API'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.4 } }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>
          Sessões WhatsApp {!loading && `(${channels.length})`}
        </h2>
        <button
          onClick={load}
          disabled={loading}
          style={{ background: '#f3f4f6', color: '#374151', padding: '6px 14px', borderRadius: 6, fontSize: 13 }}
        >
          {loading ? '⟳' : '↻ Atualizar'}
        </button>
      </div>

      {loading && (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <Spinner />
          <p style={{ color: '#6b7280', marginTop: 12, fontSize: 14 }}>Carregando canais…</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && channels.length === 0 && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            Nenhum canal WhatsApp cadastrado
          </div>
          <div style={{ fontSize: 13 }}>
            Crie um via API: <code>POST /v1/channels</code> com{' '}
            <code>type: "WHATSAPP"</code>
          </div>
        </div>
      )}

      {!loading && !error && channels.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {channels.map((ch) => (
            <SessionCard key={ch.id} channel={ch} token={token} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  padding: 20,
  width: 280,
  boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
  border: '1px solid #f3f4f6',
}