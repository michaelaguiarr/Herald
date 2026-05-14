import { useState, useEffect } from 'react'
import { useAuthStore } from '@/store/auth.store'

export type QrSseState =
  | { phase: 'connecting' }
  | { phase: 'qr'; qrData: string }
  | { phase: 'connected' }
  | { phase: 'timeout' }
  | { phase: 'error'; message: string }

// Server sends keep-alives every 30s; 60s client timeout sees at least one refresh.
const TIMEOUT_MS = 60_000

// Backend SSE format (channels.ts sendEvent):
//   data: {"type":"qr","data":"<raw-qr-string>"}\n\n
//   data: {"type":"status","status":"ACTIVE"}\n\n
//   : keep-alive\n\n   ← SSE comment, ignored by parser
//
// Status values emitted by session.manager:
//   • First connection: Baileys ACTIVE → backend maps to WARMING (starts 7-day warmup)
//   • Subsequent reconnects: Baileys ACTIVE → backend emits ACTIVE
//
// Closing rule:
//   ACTIVE  → always close (reconnect succeeded)
//   WARMING → close only if a QR was already shown (= user scanned it)
//             a bare WARMING on connect means "session is warming up, no QR yet"

type SsePayload =
  | { type: 'qr'; data: string }
  | { type: 'status'; status: string }
  | { type: 'error'; message?: string }

export function useQrCodeSse(channelId: string | null) {
  const [state, setState] = useState<QrSseState>({ phase: 'connecting' })
  const token = useAuthStore((s) => s.token)
  const [retryKey, setRetryKey] = useState(0)

  function retry() {
    setState({ phase: 'connecting' })
    setRetryKey((k) => k + 1)
  }

  useEffect(() => {
    if (!channelId || !token) return

    setState({ phase: 'connecting' })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => {
      controller.abort()
      setState({ phase: 'timeout' })
    }, TIMEOUT_MS)

    async function connect() {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/herald/v1/channels/${channelId}/qrcode`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          setState({ phase: 'error', message: `HTTP ${res.status}` })
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // Tracks whether a QR has been rendered to the user.
        // When true, a subsequent WARMING status means the user scanned the QR
        // and the first-connection warm-up period has started — close the modal.
        let qrShown = false

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // SSE events are delimited by a blank line.
          const events = buffer.split('\n\n')
          buffer = events.pop() ?? ''

          for (const raw of events) {
            for (const line of raw.split('\n')) {
              // SSE comments (": keep-alive") and event/id lines are skipped.
              if (!line.startsWith('data:')) continue

              let payload: SsePayload
              try {
                payload = JSON.parse(line.slice(5).trim()) as SsePayload
              } catch {
                continue
              }

              if (payload.type === 'qr' && payload.data) {
                qrShown = true
                setState({ phase: 'qr', qrData: payload.data })
              } else if (payload.type === 'status') {
                const { status } = payload

                if (status === 'ACTIVE') {
                  // Reconnect or already-warmed channel connected successfully.
                  clearTimeout(timeoutId)
                  setState({ phase: 'connected' })
                  controller.abort()
                  return
                }

                if (status === 'WARMING' && qrShown) {
                  // First-ever connection: QR was scanned, 7-day warm-up started.
                  // Backend maps Baileys ACTIVE → WARMING for new channels.
                  clearTimeout(timeoutId)
                  setState({ phase: 'connected' })
                  controller.abort()
                  return
                }
                // WARMING before QR shown = initial status broadcast, ignore.
                // DISCONNECTED = session dropped, keep stream open (QR might arrive).
              } else if (payload.type === 'error') {
                setState({ phase: 'error', message: payload.message ?? 'Erro no servidor' })
                controller.abort()
                return
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setState({ phase: 'error', message: 'Conexão perdida' })
      }
    }

    connect()

    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, token, retryKey])

  return { state, retry }
}
