import { sendEmail } from './email'
import { env } from './env'

export async function sendMail(options: {
  to: string
  subject: string
  html: string
}): Promise<void> {
  try {
    await sendEmail(options)
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
