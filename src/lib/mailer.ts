import nodemailer from 'nodemailer'
import { env } from './env'

function createTransport() {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) {
    return null
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  })
}

const transport = createTransport()

export async function sendMail(options: {
  to: string
  subject: string
  html: string
}) {
  if (!transport) {
    console.warn('[mailer] SMTP não configurado — email não enviado:', options.subject)
    return
  }
  try {
    await transport.sendMail({ from: env.SMTP_FROM, ...options })
  } catch (err) {
    console.error('[mailer] Falha ao enviar email para', options.to, '—', (err as Error).message)
    // Falha de envio não deve propagar como erro HTTP
  }
}

export async function sendPasswordResetEmail(to: string, token: string) {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`
  await sendMail({
    to,
    subject: 'Redefinição de senha — Herald',
    html: `
      <p>Você solicitou a redefinição da sua senha.</p>
      <p><a href="${resetUrl}">Clique aqui para redefinir sua senha</a></p>
      <p>O link expira em 1 hora.</p>
      <p>Se não foi você, ignore este email.</p>
    `,
  })
}
