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
  message: string,
  opts?: { imageUrl?: string; imageCaption?: string }
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: credentials.host,
    port: credentials.port,
    secure: credentials.port === 465,
    auth: { user: credentials.user, pass: credentials.pass },
  })

  // Build HTML: prepend image block when imageUrl is provided.
  // imageUrl is expected to be publicly accessible so the recipient's
  // email client can fetch it directly — no download or inline embedding.
  let html = message
  if (opts?.imageUrl) {
    const caption = opts.imageCaption ? `<p style="margin:8px 0 0;font-size:13px;color:#555">${opts.imageCaption}</p>` : ''
    html = `<div style="margin-bottom:16px">` +
      `<img src="${opts.imageUrl}" alt="${opts.imageCaption ?? 'imagem'}" ` +
      `style="max-width:100%;border-radius:8px" />` +
      caption +
      `</div>` + (message ? `<div>${message}</div>` : '')
  }

  const plainText = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()

  await transport.sendMail({
    from: credentials.from,
    to: `"${recipientName}" <${recipientEmail}>`,
    subject: 'Notificação',
    html,
    text: plainText,
  })
}
