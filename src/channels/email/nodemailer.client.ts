import nodemailer from 'nodemailer'

export interface EmailCredentials {
  host: string
  port: number
  user: string
  pass: string
  from: string
}

/**
 * Subject used when the caller does not send one.
 *
 * Kept as the exact previous hardcoded value on purpose: every integration that
 * existed before `subject` was introduced keeps producing byte-identical emails.
 */
export const DEFAULT_SUBJECT = 'Notificação'

export async function sendViaEmail(
  credentials: EmailCredentials,
  recipientEmail: string,
  recipientName: string,
  message: string,
  opts?: { imageUrl?: string; imageCaption?: string; subject?: string | null }
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

  // `message` is delivered as the HTML body — it always was. Senders that pass
  // plain text still work (the client renders it as a single run); senders that
  // pass markup get it rendered. What was missing was never HTML support, only
  // a subject.
  //
  // <style> blocks are stripped here before flattening, otherwise the CSS text
  // inside them would leak into the plain-text alternative as gibberish.
  const plainText = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const subject = opts?.subject?.trim() || DEFAULT_SUBJECT

  await transport.sendMail({
    from: credentials.from,
    to: `"${recipientName}" <${recipientEmail}>`,
    subject,
    html,
    text: plainText,
  })
}
