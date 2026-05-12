import EventEmitter from 'events'
import path from 'path'
import fs from 'fs'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
} from '@whiskeysockets/baileys'

export type WaSessionStatus = 'WARMING' | 'ACTIVE' | 'DISCONNECTED' | 'BANNED'

const RECONNECT_DELAY_MS = 5_000

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
      browser: Browsers.ubuntu('Desktop'),
      generateHighQualityLinkPreview: false,
      logger: makeSilentLogger(this.channelId),
      // printQRInTerminal removed in v7 — handle QR via connection.update event
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)

    // Capture `socket` in closure: if this.socket is replaced (reconnect/disconnect),
    // events from the old socket are ignored — prevents spurious DB writes.
    socket.ev.on('connection.update', (update) => {
      if (this.socket !== socket) return

      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this.emit('qr', qr)
      }

      if (connection === 'open') {
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
          setTimeout(() => {
            this.connect().catch((err) =>
              console.error(`[wa:${this.channelId}] Falha ao reconectar:`, err)
            )
          }, RECONNECT_DELAY_MS)
        }
      }
    })
  }

  async disconnect(emitStatusChange = true): Promise<void> {
    this._shouldReconnect = false
    const socket = this.socket
    this.socket = null  // nullify first so close event is ignored
    if (socket) {
      socket.end(undefined)
    }
    this._status = 'DISCONNECTED'
    if (emitStatusChange) {
      this.emit('status-change', 'DISCONNECTED' as WaSessionStatus)
    }
  }

  async sendMessage(phone: string, text: string): Promise<void> {
    if (!this.socket || this._status !== 'ACTIVE') {
      throw new Error(
        `Sessão WhatsApp ${this.channelId} não está ativa (status: ${this._status})`
      )
    }

    const normalized = phone.replace(/\D/g, '')
    const jid = `${normalized}@s.whatsapp.net`

    // Step 1 — Verify number is on WhatsApp.
    // Three outcomes: exists=true (proceed), exists=false (block), error (propagate).
    // We no longer swallow errors silently: an onWhatsApp failure should surface
    // as a worker error so the notification is retried, not silently marked ENVIADO.
    let jidVerified = false
    try {
      const checks = await this.socket.onWhatsApp(jid)
      const check = checks?.[0]
      if (check?.exists === false) {
        throw new Error(`Número ${phone} não encontrado no WhatsApp (JID: ${jid})`)
      }
      jidVerified = !!check?.exists
      console.log(
        `[wa:${this.channelId}] onWhatsApp → jid=${jid} exists=${jidVerified}`
      )
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      // Re-throw "not found" — this is definitive, the number has no WhatsApp
      if (msg.includes('não encontrado no WhatsApp')) throw verifyErr
      // For other errors (timeout, LID issue, network) warn but proceed.
      // The result.status check below will catch server-side rejections.
      console.warn(
        `[wa:${this.channelId}] onWhatsApp error (${msg}) — prosseguindo sem verificação`
      )
    }

    // Step 2 — Send the message
    const result = await this.socket.sendMessage(jid, { text })

    // Step 3 — Validate result: Baileys must return a message with an ID.
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
      `[wa:${this.channelId}] sendMessage OK → jid=${jid} ` +
      `jidVerified=${jidVerified} msgId=${result.key.id} ` +
      `status=${result.status}(${waStatusLabel(result.status)})`
    )
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
