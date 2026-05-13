import EventEmitter from 'events'
import path from 'path'
import fs from 'fs'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys'
import { getCachedJid, setCachedJid, setPhoneForLid, getPhoneForLid } from '../../lib/whatsapp-jid.cache'
import { calculateBackoff } from '../../lib/backoff'
import { WhatsAppNumberNotFoundError } from './whatsapp-errors'

export type WaSessionStatus = 'WARMING' | 'ACTIVE' | 'DISCONNECTED' | 'BANNED'

const OPT_OUT_KEYWORDS = ['parar', 'stop', 'cancelar', 'sair', 'remover', 'descadastrar']

// proto.WebMessageInfo.Status — mirrors the protobuf enum for human-readable logs
function waStatusLabel(status: number | null | undefined): string {
  const labels: Record<number, string> = {
    0: 'ERROR', 1: 'PENDING', 2: 'SERVER_ACK', 3: 'DELIVERY_ACK', 4: 'READ', 5: 'PLAYED',
  }
  return labels[status ?? -1] ?? `unknown(${status})`
}

// Minimal pino-compatible logger that suppresses Baileys noise.
// Baileys v7 expects a pino Logger — cast via `as never` to bypass TS.
const makeSilentLogger = (channelId: string) =>
  ({
    level: 'warn',
    trace: () => {},
    debug: () => {},
    info:  () => {},
    warn:  (msg: unknown) => console.warn(`[wa:${channelId}]`, msg),
    error: (msg: unknown) => console.error(`[wa:${channelId}]`, msg),
    fatal: (msg: unknown) => console.error(`[wa:${channelId}] FATAL`, msg),
    child: function () { return this },
  }) as never

export class BaileysClient extends EventEmitter {
  private socket: ReturnType<typeof makeWASocket> | null = null
  private _status: WaSessionStatus = 'WARMING'
  readonly channelId: string
  private readonly sessionDir: string
  private _shouldReconnect = true
  private _reconnectAttempt = 0
  // Set by disconnect() to suppress auto-reconnect and SESSAO_DESCONECTADA alerts.
  // Cleared on the next successful connection.open.
  private _manualDisconnect = false

  constructor(channelId: string, sessionsBasePath: string) {
    super()
    this.channelId = channelId
    this.sessionDir = path.join(sessionsBasePath, channelId)
    fs.mkdirSync(this.sessionDir, { recursive: true })
  }

  get status(): WaSessionStatus {
    return this._status
  }

  private setStatus(status: WaSessionStatus): void {
    this._status = status
    this.emit('status-change', status)
  }

  async connect(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir)

    // v7: version is hardcoded in DEFAULT_CONNECTION_CONFIG ([2, 3000, 1035194821]).
    // fetchLatestBaileysVersion() was removed — just omit `version` from config.
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu('Chrome'),
      generateHighQualityLinkPreview: false,
      logger: makeSilentLogger(this.channelId),
      // Required for protocol-level message redelivery on reconnect.
      // Without this, Baileys closes Signal sessions causing
      // "Decrypted message with closed session" errors.
      getMessage: async () => ({ conversation: '' }),
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)

    // ── Delivery receipt listener ────────────────────────────────────────────
    // Fires when WA servers update the delivery status of our outgoing messages.
    // We only track fromMe=true messages we sent; statuses ≥ SERVER_ACK are
    // meaningful for the recipient pipeline (PENDING is local-only).
    socket.ev.on('messages.update', (updates) => {
      if (this.socket !== socket) return  // stale socket guard
      for (const { key, update } of updates) {
        if (!key.fromMe || !key.id) continue
        const numStatus = update.status != null ? Number(update.status) : undefined
        if (numStatus === undefined || numStatus < 2) continue  // skip ERROR/PENDING
        const label = waStatusLabel(numStatus)
        if (!label) continue
        this.emit('delivery-update', { messageId: key.id, status: label })
        console.log(`[wa:${this.channelId}] delivery-update → msgId=${key.id} ${label}`)
      }
    })

    // ── Opt-out listener ────────────────────────────────────────────────────
    // Detects when a recipient replies with an opt-out keyword and emits
    // 'opt-out-request' so the session manager can register it and reply.
    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (this.socket !== socket) return  // stale socket guard
      if (type !== 'notify') return       // skip history / append events
      for (const message of messages) {
        if (message.key.fromMe) continue  // only incoming messages
        const remoteJid = message.key.remoteJid ?? ''

        // Accept both @s.whatsapp.net and @lid JIDs — exclude groups (@g.us)
        // and newsletter JIDs. In Baileys v7, newer WA users may have LID-based JIDs.
        const isDirectMessage = remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@lid')
        if (!isDirectMessage) continue

        const text = (
          message.message?.conversation ??
          message.message?.extendedTextMessage?.text ??
          ''
        ).trim().toLowerCase()
        if (!text || !OPT_OUT_KEYWORDS.some((kw) => text.includes(kw))) continue

        let phone = remoteJid.split('@')[0]
        if (!phone) continue

        // LID JIDs need to be resolved to a phone number.
        // Strategy 1: check Redis reverse cache (populated by previous sendMessage calls)
        // Strategy 2: query Baileys' internal signalRepository.lidMapping.getPNForLID
        if (remoteJid.endsWith('@lid')) {
          let resolvedPhone = await getPhoneForLid(phone)

          if (!resolvedPhone) {
            // Fallback: query Baileys' own LID-to-PN mapping.
            // getPNForLID requires the FULL JID (e.g. "54954257608829@lid"),
            // not just the user part — isLidUser() inside checks for @lid suffix.
            // The returned PN may have device suffix (e.g. "559591590235:0@s.whatsapp.net"),
            // so strip everything before the first colon or @.
            try {
              const pn = await socket.signalRepository.lidMapping.getPNForLID(remoteJid)
              if (pn) resolvedPhone = pn.split('@')[0].split(':')[0].replace(/\D/g, '')
            } catch {}
          }

          if (resolvedPhone) {
            phone = resolvedPhone
            // Warm the reverse cache for future messages from this LID
            await setPhoneForLid(phone.split('@')[0], resolvedPhone).catch(() => {})
          } else {
            console.warn(
              `[wa:${this.channelId}] opt-out de LID ${phone} — ` +
              `sem mapeamento (lidMapping + reverse cache). Opt-out ignorado.`
            )
            continue
          }
        }

        console.log(`[wa:${this.channelId}] opt-out-request de +${phone}: "${text}"`)
        this.emit('opt-out-request', { phone, reason: text })
      }
    })

    // Capture `socket` in closure: if this.socket is replaced (reconnect/disconnect),
    // events from the old socket are ignored — prevents spurious DB writes.
    socket.ev.on('connection.update', (update) => {
      if (this.socket !== socket) return

      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.emit('qr', qr)
      }

      if (connection === 'open') {
        this._reconnectAttempt = 0   // reset backoff counter
        this._manualDisconnect = false  // clear flag if somehow reconnected
        this.setStatus('ACTIVE')
      }

      if (connection === 'close') {
        const statusCode = (
          lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode

        // forbidden (403) = genuine WhatsApp ban.
        // loggedOut (401) = user removed device from phone — can reconnect via QR.
        if (statusCode === DisconnectReason.forbidden) {
          this.setStatus('BANNED')
          this._shouldReconnect = false
          return
        }

        this.setStatus('DISCONNECTED')

        if (this._shouldReconnect) {
          const delay = calculateBackoff(this._reconnectAttempt)
          const nextAt = new Date(Date.now() + delay).toTimeString().slice(0, 8)
          console.log(
            `[wa:reconnect] ${this.channelId.slice(0, 8)} ` +
            `tentativa=${this._reconnectAttempt} delay=${delay}ms próxima=${nextAt}`
          )
          this._reconnectAttempt++
          setTimeout(() => {
            this.connect().catch((err) =>
              console.error(`[wa:${this.channelId}] Falha ao reconectar:`, err)
            )
          }, delay)
        }
      }
    })
  }

  async disconnect(emitStatusChange = true): Promise<void> {
    this._shouldReconnect = false
    this._manualDisconnect = true  // signals: no auto-reconnect, no SESSAO_DESCONECTADA alert
    const socket = this.socket
    this.socket = null  // nullify before end() — stale guard in connection.update ignores the close event
    if (socket) {
      socket.end(undefined)
    }
    this._status = 'DISCONNECTED'
    if (emitStatusChange) {
      this.emit('status-change', 'DISCONNECTED' as WaSessionStatus)
    }
  }

  get manualDisconnect(): boolean {
    return this._manualDisconnect
  }

  // Downloads an image from a public URL within a 10s timeout.
  private async downloadImage(url: string): Promise<Buffer> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      const resp = await fetch(url, { signal: controller.signal })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
      }
      return Buffer.from(await resp.arrayBuffer())
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Falha ao baixar imagem: ${url} — ${msg}`)
    } finally {
      clearTimeout(timer)
    }
  }

  // Returns the Baileys message ID (key.id) so callers can link delivery ACKs.
  async sendMessage(
    phone: string,
    text: string,
    opts?: { imageUrl?: string; caption?: string }
  ): Promise<string> {
    if (!this.socket || this._status !== 'ACTIVE') {
      throw new Error(
        `Sessão WhatsApp ${this.channelId} não está ativa (status: ${this._status})`
      )
    }

    const normalized = phone.replace(/\D/g, '')
    const jid = `${normalized}@s.whatsapp.net`

    // Step 1 — Resolve JID (cache-first).
    // onWhatsApp returns the canonical JID from WhatsApp servers, which in
    // Baileys v7 can be LID-based. Sending to the raw phone JID causes silent
    // delivery failures. Results are cached 24h to avoid a round-trip per send
    // for recurring recipients (dizimistas, broadcast lists).
    let resolvedJid = jid
    let jidVerified = false

    const cachedJid = await getCachedJid(phone)
    if (cachedJid) {
      resolvedJid = cachedJid
      jidVerified = true
      console.log(`[wa:cache] HIT ${phone} → ${resolvedJid}`)
    } else {
      console.log(`[wa:cache] MISS ${phone} → resolvendo via onWhatsApp()`)
      try {
        const checks = await this.socket.onWhatsApp(jid)
        const check = checks?.[0]
        // Baileys v7 returns [] (empty array) for non-existent numbers — NOT { exists: false }.
        // Strict equality `=== false` misses this case: undefined === false → false.
        // !check catches the empty-array case; check.exists === false catches the explicit case.
        if (!check || check.exists === false) {
          throw new WhatsAppNumberNotFoundError(phone)
        }
        if (check.exists && check.jid) {
          resolvedJid = check.jid  // canonical JID (may be LID in v7)
          jidVerified = true
          await setCachedJid(phone, resolvedJid)  // warm the JID cache for next send
          // Store reverse LID→phone mapping so incoming opt-out messages can be
          // matched back to the phone number stored in notifications.
          const lidUser = resolvedJid.split('@')[0]
          if (resolvedJid.endsWith('@lid') && lidUser) {
            await setPhoneForLid(lidUser, normalized)
          }
        }
        console.log(
          `[wa:${this.channelId}] onWhatsApp → raw=${jid} resolved=${resolvedJid} exists=${jidVerified}`
        )
      } catch (verifyErr) {
        // WhatsAppNumberNotFoundError is a terminal condition — propagate as-is
        // so the worker can detect it and skip retry scheduling.
        if (verifyErr instanceof WhatsAppNumberNotFoundError) throw verifyErr

        const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
        // Re-throw all other errors — transient socket/session failures should
        // be retried. Sending with an unresolved raw JID causes silent delivery
        // failure in Baileys v7 (LID-based routing).
        throw new Error(`Falha ao verificar JID no WhatsApp para ${jid}: ${msg}`)
      }
    }

    // Step 2 — Build message content (text or image)
    let content: Parameters<typeof this.socket.sendMessage>[1]
    if (opts?.imageUrl) {
      const imageBuffer = await this.downloadImage(opts.imageUrl)
      content = { image: imageBuffer, caption: opts.caption ?? '' }
      console.log(`[wa:${this.channelId}] sending image ${opts.imageUrl} caption="${opts.caption ?? ''}"`)
    } else {
      content = { text }
    }

    // Step 3 — Send to the resolved JID
    const result = await this.socket.sendMessage(resolvedJid, content)

    // Step 4 — Validate result: Baileys must return a message with an ID.
    // proto.WebMessageInfo.Status: 0=ERROR, 1=PENDING, 2=SERVER_ACK, 3=DELIVERY_ACK
    if (!result?.key?.id) {
      throw new Error(
        `Baileys não retornou ID de mensagem para ${jid} — envio falhou silenciosamente`
      )
    }
    if (result.status === 0) {
      throw new Error(
        `WA server rejeitou a mensagem para ${jid} ` +
        `(status=0 ERROR, msgId=${result.key.id})`
      )
    }

    console.log(
      `[wa:${this.channelId}] sendMessage OK → resolvedJid=${resolvedJid} ` +
      `jidVerified=${jidVerified} msgId=${result.key.id} ` +
      `status=${result.status}(${waStatusLabel(result.status)})`
    )

    return result.key.id
  }

  // Sends a message directly to a full JID without the onWhatsApp() verification step.
  // Used for system replies (opt-out confirmations) where the JID is already known
  // from an incoming message. Errors are swallowed — this is non-critical.
  async sendDirectMessage(jid: string, text: string): Promise<void> {
    if (!this.socket || this._status !== 'ACTIVE') return
    try {
      await this.socket.sendMessage(jid, { text })
    } catch (err) {
      console.warn(`[wa:${this.channelId}] sendDirectMessage falhou para ${jid}:`, err)
    }
  }

  async diagnose(
    phone: string,
    sendText?: string
  ): Promise<{
    jid: string
    exists: boolean | null
    checkError?: string
    messageSent: boolean
    messageStatus?: number
    sendError?: string
  }> {
    if (!this.socket) {
      return { jid: '', exists: null, checkError: 'Socket não inicializado', messageSent: false }
    }

    const normalized = phone.replace(/\D/g, '')
    const jid = `${normalized}@s.whatsapp.net`

    let exists: boolean | null = null
    let checkError: string | undefined

    try {
      const checks = await this.socket.onWhatsApp(jid)
      exists = checks?.[0]?.exists ?? false
    } catch (err) {
      checkError = err instanceof Error ? err.message : String(err)
    }

    if (!sendText || exists === false) {
      return { jid, exists, checkError, messageSent: false }
    }

    try {
      const result = await this.socket.sendMessage(jid, { text: sendText })
      const rawStatus = result?.status
      const numStatus = rawStatus != null ? Number(rawStatus) : undefined

      // Treat missing ID or status=0 (ERROR) as delivery failure
      if (!result?.key?.id) {
        return { jid, exists, checkError, messageSent: false, sendError: 'Baileys não retornou ID de mensagem' }
      }
      if (rawStatus === 0) {
        return { jid, exists, checkError, messageSent: false, messageStatus: 0,
          sendError: `WA server rejeitou (status=0 ERROR, msgId=${result.key.id})` }
      }

      return {
        jid, exists, checkError, messageSent: true, messageStatus: numStatus,
      }
    } catch (err) {
      return {
        jid, exists, checkError,
        messageSent: false,
        sendError: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
