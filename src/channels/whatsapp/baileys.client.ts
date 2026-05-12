import EventEmitter from 'events'
import path from 'path'
import fs from 'fs'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys'

export type WaSessionStatus = 'WARMING' | 'ACTIVE' | 'DISCONNECTED' | 'BANNED'

const RECONNECT_DELAY_MS = 5_000

const makeSilentLogger = (channelId: string) =>
  ({
    level: 'silent',
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (msg: unknown) => console.warn(`[wa:${channelId}]`, msg),
    error: (msg: unknown) => console.error(`[wa:${channelId}]`, msg),
    fatal: (msg: unknown) => console.error(`[wa:${channelId}]`, msg),
    child: function () {
      return this
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any

export class BaileysClient extends EventEmitter {
  // Kept public-readable for session.manager reconnect checks
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
    const { version } = await fetchLatestBaileysVersion()

    // Capture local reference so that events from a replaced/disconnected socket
    // are silently ignored — prevents spurious DB writes during reconnect.
    const socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Desktop'),
      generateHighQualityLinkPreview: false,
      logger: makeSilentLogger(this.channelId),
    })
    this.socket = socket

    socket.ev.on('creds.update', saveCreds)

    socket.ev.on('connection.update', (update) => {
      // FIX: if this.socket was replaced (null or new socket), the event came
      // from a stale socket — ignore it to prevent phantom DISCONNECTED writes.
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

        // FIX: only DisconnectReason.forbidden (403) is a genuine WhatsApp ban.
        // loggedOut (401) means the user removed the device from their phone —
        // the number is NOT banned and can be re-connected by scanning QR again.
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
    // Nullify before end() so any async close event from the socket
    // sees this.socket !== socket and returns immediately.
    this.socket = null
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

    // Best-effort JID verification — only blocks when WA explicitly says the number
    // doesn't exist. If onWhatsApp itself throws (network/session error), we log and
    // proceed so a transient failure here doesn't silently drop the message.
    try {
      const [check] = await this.socket.onWhatsApp(jid)
      if (check !== undefined && !check.exists) {
        throw new Error(`Número ${phone} não encontrado no WhatsApp (JID: ${jid})`)
      }
    } catch (verifyErr) {
      const msg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      if (msg.includes('não encontrado no WhatsApp')) throw verifyErr
      console.warn(`[wa:${this.channelId}] onWhatsApp falhou — enviando mesmo assim:`, msg)
    }

    const result = await this.socket.sendMessage(jid, { text })
    console.log(
      `[wa:${this.channelId}] sendMessage → jid=${jid} ` +
        `msgId=${result?.key?.id} status=${result?.status}`
    )
  }

  /**
   * Diagnoses a phone number: checks WhatsApp registration and optionally sends
   * a test message. Used by the [Dev] test endpoint.
   */
  async diagnose(
    phone: string,
    sendText?: string
  ): Promise<{ jid: string; exists: boolean | null; checkError?: string; messageSent: boolean; messageStatus?: number; sendError?: string }> {
    if (!this.socket) {
      return { jid: '', exists: null, checkError: 'Socket não inicializado', messageSent: false }
    }

    const normalized = phone.replace(/\D/g, '')
    const jid = `${normalized}@s.whatsapp.net`

    let exists: boolean | null = null
    let checkError: string | undefined

    try {
      const [check] = await this.socket.onWhatsApp(jid)
      exists = check?.exists ?? false
    } catch (err) {
      checkError = err instanceof Error ? err.message : String(err)
    }

    if (!sendText || exists === false) {
      return { jid, exists, checkError, messageSent: false }
    }

    try {
      const result = await this.socket.sendMessage(jid, { text: sendText })
      return { jid, exists, checkError, messageSent: true, messageStatus: result?.status }
    } catch (err) {
      return {
        jid, exists, checkError,
        messageSent: false,
        sendError: err instanceof Error ? err.message : String(err),
      }
    }
  }
}
