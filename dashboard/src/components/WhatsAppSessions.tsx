import { useEffect, useRef, useState, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'

interface Channel {
  id: string
  label: string
  status: 'WARMING' | 'ACTIVE' | 'DISCONNECTED' | 'BANNED' | 'INACTIVE'
  organizationId: string
  createdAt: string
}

interface SseState {
  status: string
  qr: string | null
  connected: boolean
}

const STATUS_COLOR: Record<string, string> = {
  WARMING: '#f59e0b',
  ACTIVE: '#10b981',
  DISCONNECTED: '#6b7280',
  BANNED: '#dc2626',
  INACTIVE: '#d1d5db',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: STATUS_COLOR[status] ?? '#d1d5db',
        color: '#fff',
      }}
    >
      {status}
    </span>
  )
}

function SessionCard({ channel, token }: { channel: Channel; token: string }) {
  const [sse, setSse] = useState<SseState>({ status: channel.status, qr: null, connected: false })
  const [reconnecting, setReconnecting] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const openSse = useCallback(() => {
    if (esRef.current) esRef.current.close()

    const es = new EventSource(`/v1/channels/${channel.id}/qrcode`, {
      // EventSource doesn't support custom headers natively — we use a token cookie
      // workaround: pass token as query param (acceptable for local dev only)
    })

    // Browsers don't support headers in EventSource; workaround for dev:
    // The SSE endpoint is protected by JWT. We'll fetch via a temporary approach —
    // actually for simplicity in this dev dashboard, we'll use a special endpoint
    // that bypasses auth (we handle this below by using fetch+ReadableStream instead)
    esRef.current = es

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.type === 'status') {
        setSse((prev) => ({ ...prev, status: data.status }))
      }
      if (data.type === 'qr') {
        setSse((prev) => ({ ...prev, qr: data.data, connected: false }))
      }
    }

    es.onerror = () => {
      es.close()
    }
  }, [channel.id])

  // Use fetch + ReadableStream to support Authorization header with SSE
  useEffect(() => {
    let cancelled = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const decoder = new TextDecoder()
    let buffer = ''

    async function connectSse() {
      try {
        const res = await fetch(`/v1/channels/${channel.id}/qrcode`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok || !res.body) return

        reader = res.body.getReader()

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                if (data.type === 'status') {
                  setSse((prev) => ({ ...prev, status: data.status }))
                }
                if (data.type === 'qr') {
                  setSse((prev) => ({ ...prev, qr: data.data }))
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      } catch {
        // connection error, ignore
      }
    }

    connectSse()

    return () => {
      cancelled = true
      reader?.cancel().catch(() => {})
    }
  }, [channel.id, token])

  async function handleReconnect() {
    setReconnecting(true)
    try {
      await fetch(`/v1/channels/${channel.id}/reconnect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      setSse((prev) => ({ ...prev, qr: null, status: 'WARMING' }))
    } finally {
      setReconnecting(false)
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <div>
          <span style={styles.label}>{channel.label}</span>
          <span style={styles.orgId}>{channel.organizationId.slice(0, 8)}…</span>
        </div>
        <StatusBadge status={sse.status} />
      </div>

      {sse.qr && (
        <div style={styles.qrWrap}>
          <QRCodeSVG value={sse.qr} size={220} level="M" />
          <p style={styles.qrHint}>Abra o WhatsApp → Dispositivos conectados → Conectar</p>
        </div>
      )}

      {!sse.qr && sse.status === 'WARMING' && (
        <p style={styles.waiting}>Aguardando QR Code…</p>
      )}

      {sse.status === 'ACTIVE' && (
        <p style={styles.activeMsg}>✓ Sessão ativa</p>
      )}

      {(sse.status === 'DISCONNECTED' || sse.status === 'BANNED') && (
        <button
          onClick={handleReconnect}
          disabled={reconnecting}
          style={styles.reconnectBtn}
        >
          {reconnecting ? 'Reconectando…' : 'Reconectar'}
        </button>
      )}
    </div>
  )
}

export default function WhatsAppSessions({ token }: { token: string }) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
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

  if (loading) return <p style={styles.hint}>Carregando sessões…</p>
  if (error) return <p style={{ ...styles.hint, color: '#dc2626' }}>{error}</p>
  if (channels.length === 0)
    return (
      <div style={styles.emptyState}>
        <p style={styles.emptyTitle}>Nenhum canal WhatsApp cadastrado</p>
        <p style={styles.hint}>Crie um canal via API: POST /v1/channels com type="WHATSAPP"</p>
      </div>
    )

  return (
    <div>
      <h2 style={styles.sectionTitle}>Sessões WhatsApp ({channels.length})</h2>
      <div style={styles.grid}>
        {channels.map((ch) => (
          <SessionCard key={ch.id} channel={ch} token={token} />
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  sectionTitle: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 20 },
  card: {
    background: '#fff',
    borderRadius: 12,
    padding: 20,
    width: 300,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  label: { fontWeight: 600, fontSize: 15, display: 'block' },
  orgId: { fontSize: 11, color: '#9ca3af', marginTop: 2, display: 'block' },
  qrWrap: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  qrHint: { fontSize: 12, color: '#6b7280', textAlign: 'center' },
  waiting: { color: '#f59e0b', fontSize: 13, textAlign: 'center' },
  activeMsg: { color: '#10b981', fontSize: 14, fontWeight: 600, textAlign: 'center' },
  reconnectBtn: {
    background: '#1d4ed8',
    color: '#fff',
    width: '100%',
    padding: '8px 0',
    marginTop: 8,
  },
  hint: { fontSize: 14, color: '#6b7280' },
  emptyState: { textAlign: 'center', padding: '48px 0' },
  emptyTitle: { fontSize: 16, fontWeight: 600, marginBottom: 8 },
}