import nodemailer from 'nodemailer'

export interface EmailCredentials {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

export async function sendViaEmail(
  credentials: EmailCredentials,
  recipientEmail: string,
  recipientName: string,
  message: string
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.port === 465,
    auth: { user: credentials.user, pass: credentials.pass },
  })

  await transport.sendMail({
    from: credentials.from,
    to: `"${recipientName}" <${recipientEmail}>`,
    subject: 'Notificação',
    html: message,
    text: message.replace(/<[^>]*>/g, ' ').trim(),
  })
}
