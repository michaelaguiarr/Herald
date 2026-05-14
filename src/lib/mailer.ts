import { render } from '@react-email/render'
import { ResetPasswordEmail } from '../emails/reset-password'
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

export async function sendPasswordResetEmail(to: string, token: string, name: string) {
  const resetUrl = `${env.APP_URL}/reset-password?token=${token}`
  const html = await render(ResetPasswordEmail({ name, resetUrl }))
  await sendMail({ to, subject: 'Redefinição de senha — Herald', html })
}
