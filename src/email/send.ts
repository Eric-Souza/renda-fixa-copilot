// Sends the report through Gmail's SMTP with an app password (Google account > Security >
// App passwords; needs 2-step verification).

import nodemailer from 'nodemailer'

type Env = Record<string, string | undefined>

export interface Mail {
  subject: string
  html: string
  text: string
}

export function mailConfig(env: Env = process.env) {
  const user = env.GMAIL_USER
  const pass = env.GMAIL_APP_PASSWORD?.replace(/\s+/g, '')
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set to send the email')
  return { user, pass, to: env.REPORT_TO || user }
}

export async function sendMail(mail: Mail, env: Env = process.env): Promise<string> {
  const { user, pass, to } = mailConfig(env)
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } })
  const info = await transport.sendMail({ from: `Renda Fixa Copilot <${user}>`, to, ...mail })
  return info.messageId
}
