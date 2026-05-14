import { Resend } from 'resend'
import { env } from './env'

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null

export async function sendEmail(options: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  if (!resend) {
    console.warn('[email] RESEND_API_KEY não configurado — email não enviado:', options.subject)
    return
  }

  const { error } = await resend.emails.send({
    from: env.SMTP_FROM,
    to: options.to,
    subject: options.subject,
    html: options.html,
  })

  if (error) {
    console.error('[email] Falha ao enviar para', options.to, '—', error.message)
    throw new Error(`Falha ao enviar email: ${error.message}`)
  }
}
