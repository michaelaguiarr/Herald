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

// Minimal logger to suppress Baileys internal noise
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

    this.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.ubuntu('Desktop'),
      generateHighQualityLinkPreview: false,
      logger: makeSilentLogger(this.channelId),
    })

    this.socket.ev.on('creds.update', saveCreds)

    this.socket.ev.on('connection.update', (update) => {
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

        if (statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.forbidden) {
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
    if (this.socket) {
      this.socket.end(undefined)
      this.socket = null
    }
    this._status = 'DISCONNECTED'
    if (emitStatusChange) {
      this.emit('status-change', 'DISCONNECTED' as WaSessionStatus)
    }
  }

  async reconnect(): Promise<void> {
    this._shouldReconnect = true
    await this.disconnect(false)
    await this.connect()
  }

  async sendMessage(phone: string, text: string): Promise<void> {
    if (!this.socket || this._status !== 'ACTIVE') {
      throw new Error(
        `Sessão WhatsApp ${this.channelId} não está ativa (status: ${this._status})`
      )
    }

    const normalized = phone.replace(/\D/g, '')
    const jid = `${normalized}@s.whatsapp.net`
    await this.socket.sendMessage(jid, { text })
  }
}