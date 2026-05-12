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
  qrAt: Date | null
  streamAlive: boolean
  qrTimedOut: boolean   // true when 60s pass without a QR while WARMING
}

// ─── Constants ────────────────────────────────────────────────────────────────

const QR_TIMEOUT_MS = 60_000   // show error if no QR arrives within 60s of WARMING
const SSE_RETRY_MS  = 3_000

const STATUS_META: Record<WaStatus, { label: string; color: string; bg: string }> = {
  WARMING:      { label: 'Aguardando QR',  color: '#92400e', bg: '#fef3c7' },
  ACTIVE:       { label: 'Ativo',          color: '#065f46', bg: '#d1fae5' },
  DISCONNECTED: { label: 'Desconectado',   color: '#374151', bg: '#f3f4f6' },
  BANNED:       { label: 'Suspenso',       color: '#991b1b', bg: '#fee2e2' },
  INACTIVE:     { label: 'Inativo',        color: '#6b7280', bg: '#f9fafb' },
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 5)  return 'agora mesmo'
  if (s < 60) return `há ${s}s`
  return `há ${Math.floor(s / 60)}m${s % 60}s`
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: WaStatus }) {
  const m = STATUS_META[status] ?? STATUS_META.INACTIVE
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      color: m.color, background: m.bg,
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%', background: m.color,
        animation: status === 'WARMING' ? 'pulse 1.5s infinite' : undefined,
      }} />
      {m.label}
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
    qrTimedOut: false,
  })
  const [reconnecting, setReconnecting] = useState(false)
  // Incrementing sseKey forces the SSE useEffect to restart the stream
  const [sseKey, setSseKey] = useState(0)
  const [tick, setTick]     = useState(0)

  // 1-second ticker to keep "gerado há Xs" live
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1_000)
    return () => clearInterval(id)
  }, [])

  // QR timeout: if status=WARMING and no QR arrives within QR_TIMEOUT_MS, show error
  useEffect(() => {
    if (sse.status !== 'WARMING' || sse.qr !== null) return
    const id = setTimeout(
      () => setSse((prev) => (prev.qr === null && prev.status === 'WARMING'
        ? { ...prev, qrTimedOut: true }
        : prev)),
      QR_TIMEOUT_MS
    )
    return () => clearTimeout(id)
  }, [sse.status, sse.qr, sseKey])  // reset when status changes or after reconnect

  // SSE stream — auto-reconnects, restarted when sseKey changes
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const decoder = new TextDecoder()

    async function connect() {
      while (!cancelled) {
        setSse((prev) => ({ ...prev, streamAlive: false }))
        try {
          const res = await fetch(`/v1/channels/${channel.id}/qrcode`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          })
          if (!res.ok || !res.body) { await sleep(SSE_RETRY_MS); continue }

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
                  setSse((prev) => ({
                    ...prev,
                    status: evt.status as WaStatus,
                    // reset timeout flag when status changes
                    qrTimedOut: false,
                    // clear QR when going back to WARMING (reconnect in progress)
                    qr: evt.status === 'WARMING' ? null : prev.qr,
                    qrAt: evt.status === 'WARMING' ? null : prev.qrAt,
                  }))
                }
                if (evt.type === 'qr') {
                  setSse((prev) => ({
                    ...prev,
                    qr: evt.data as string,
                    qrAt: new Date(),
                    qrTimedOut: false,
                  }))
                }
              } catch { /* ignore parse errors */ }
            }
          }
        } catch (err: unknown) {
          if (!cancelled && (err as { name?: string }).name !== 'AbortError') {
            setSse((prev) => ({ ...prev, streamAlive: false }))
            await sleep(SSE_RETRY_MS)
          }
        }
      }
    }

    connect()
    return () => { cancelled = true; controller.abort() }
  }, [channel.id, token, sseKey])

  const handleReconnect = useCallback(async () => {
    setReconnecting(true)
    // Clear QR immediately so the "Conectando…" state shows right away
    setSse((prev) => ({ ...prev, qr: null, qrAt: null, qrTimedOut: false }))
    try {
      await fetch(`/v1/channels/${channel.id}/reconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      // Restart the SSE stream so it subscribes to the new session's events
      setSseKey((k) => k + 1)
    } catch { /* status will update via SSE */ }
    finally { setReconnecting(false) }
  }, [channel.id, token])

  const isWaiting  = sse.status === 'WARMING' && sse.qr === null && !sse.qrTimedOut
  const canConnect = sse.status !== 'ACTIVE' && sse.status !== 'INACTIVE'

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
          <span style={{ fontSize: 10, color: sse.streamAlive ? '#10b981' : '#d97706' }}>
            {sse.streamAlive ? '● stream ativo' : '○ reconectando stream…'}
          </span>
        </div>
      </div>

      {/* Body */}
      <div style={{ minHeight: 100, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>

        {/* ACTIVE */}
        {sse.status === 'ACTIVE' && (
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 36, marginBottom: 6 }}>✓</div>
            <div style={{ color: '#065f46', fontWeight: 600, fontSize: 14 }}>Sessão ativa</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
              Mensagens sendo entregues normalmente
            </div>
          </div>
        )}

        {/* WARMING — waiting for QR (no timeout yet) */}
        {isWaiting && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Spinner />
            <div style={{ fontWeight: 600, fontSize: 14, marginTop: 10 }}>
              Conectando ao WhatsApp…
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              Aguarde até <strong>30 segundos</strong> enquanto o Baileys
              <br />busca a versão do WhatsApp e abre o WebSocket.
            </div>
          </div>
        )}

        {/* WARMING — QR timeout */}
        {sse.qrTimedOut && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>⏱</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#92400e' }}>
              QR Code não chegou
            </div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
              O Baileys demorou mais de 60s para gerar o QR.
              <br />Verifique os logs da API e tente novamente.
            </div>
          </div>
        )}

        {/* QR available */}
        {sse.qr && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 8, background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb' }}>
              <QRCodeSVG value={sse.qr} size={200} level="M" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Escaneie com o WhatsApp</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                Abra o app → Dispositivos conectados → Conectar dispositivo
              </div>
              {sse.qrAt && (
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                  {/* tick read to trigger re-render every second */}
                  QR gerado {timeAgo(sse.qrAt)}{tick > -1 ? '' : ''}
                  {' '}· renova automaticamente ao expirar
                </div>
              )}
            </div>
          </div>
        )}

        {/* DISCONNECTED */}
        {sse.status === 'DISCONNECTED' && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 4 }}>⚡</div>
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
            <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b' }}>Número suspenso</div>
            <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>
              Este número foi suspenso pelo WhatsApp.
              <br />Tentar reconectar pode não funcionar.
            </div>
          </div>
        )}
      </div>

      {/* Footer action */}
      {canConnect && (
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          style={{
            marginTop: 16, width: '100%',
            background: reconnecting ? '#d1d5db' : '#1d4ed8',
            color: '#fff', padding: '10px 0', borderRadius: 8,
            fontSize: 14, fontWeight: 600,
            cursor: reconnecting ? 'not-allowed' : 'pointer',
          }}
        >
          {reconnecting
            ? '⟳ Aguarde…'
            : sse.qr
              ? '↺ Gerar novo QR'
              : sse.qrTimedOut
                ? '↺ Tentar novamente'
                : 'Conectar'}
        </button>
      )}
    </div>
  )
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 36, height: 36, margin: '0 auto',
      border: '3px solid #e5e7eb', borderTop: '3px solid #1d4ed8',
      borderRadius: '50%', animation: 'spin 0.8s linear infinite',
    }} />
  )
}

// ─── Channel list ─────────────────────────────────────────────────────────────

export default function WhatsAppSessions({ token }: { token: string }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  const load = useCallback(() => {
    setLoading(true); setError('')
    fetch('/v1/channels?type=WHATSAPP', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data) => Array.isArray(data) ? setChannels(data) : setError(data.message ?? 'Erro'))
      .catch(() => setError('Falha na conexão com a API'))
      .finally(() => setLoading(false))
  }, [token])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <style>{`
        @keyframes spin  { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:20, fontWeight:700 }}>
          Sessões WhatsApp{!loading && ` (${channels.length})`}
        </h2>
        <button
          onClick={load} disabled={loading}
          style={{ background:'#f3f4f6', color:'#374151', padding:'6px 14px', borderRadius:6, fontSize:13 }}
        >
          {loading ? '⟳' : '↻ Atualizar'}
        </button>
      </div>

      {loading && (
        <div style={{ padding:'40px 0', textAlign:'center' }}>
          <Spinner />
          <p style={{ color:'#6b7280', marginTop:12, fontSize:14 }}>Carregando canais…</p>
        </div>
      )}

      {!loading && error && (
        <div style={{ background:'#fee2e2', color:'#991b1b', padding:'12px 16px', borderRadius:8, fontSize:14 }}>
          {error}
        </div>
      )}

      {!loading && !error && channels.length === 0 && (
        <div style={{ textAlign:'center', padding:'48px 0', color:'#6b7280' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📱</div>
          <div style={{ fontSize:16, fontWeight:600, marginBottom:8 }}>
            Nenhum canal WhatsApp cadastrado
          </div>
          <div style={{ fontSize:13 }}>
            Crie via API: <code>POST /v1/channels</code> com <code>type: "WHATSAPP"</code>
          </div>
        </div>
      )}

      {!loading && !error && channels.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:20 }}>
          {channels.map((ch) => (
            <SessionCard key={ch.id} channel={ch} token={token} />
          ))}
        </div>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  background: '#fff', borderRadius: 12, padding: 20, width: 280,
  boxShadow: '0 2px 12px rgba(0,0,0,0.07)', border: '1px solid #f3f4f6',
}
