/**
 * Thrown when onWhatsApp() confirms the recipient is not registered on WhatsApp.
 * TERMINAL — retrying will not help. Worker marks FALHOU_DEFINITIVO immediately.
 *
 * Contrast with other WhatsApp errors (socket timeout, session unstable, etc.)
 * which ARE transient and benefit from the standard 1h/6h/24h retry cycle.
 */
export class WhatsAppNumberNotFoundError extends Error {
  readonly phone: string

  constructor(phone: string) {
    super(`Número ${phone} não encontrado no WhatsApp`)
    this.name = 'WhatsAppNumberNotFoundError'
    this.phone = phone
  }
}

/**
 * Thrown when the recipient has opted out of notifications for this organization.
 * TERMINAL — retrying will not help. Worker marks FALHOU_DEFINITIVO immediately.
 * Opt-out is stored in the opt_out table and can be removed by an admin via
 * DELETE /v1/opt-outs/:phone to reactivate the number.
 */
export class OptOutError extends Error {
  readonly phone: string

  constructor(phone: string) {
    super(`Número ${phone} optou por não receber notificações`)
    this.name = 'OptOutError'
    this.phone = phone
  }
}
