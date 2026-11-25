import nodemailer, { Transporter } from 'nodemailer';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { decryptSecret } from '../../utils/crypto';

export interface SmtpSenderConfig {
  id: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  encryptedSmtpPassword: string;
}

export interface SendEmailPayload {
  sender: SmtpSenderConfig;
  to: string;
  subject: string;
  body: string;
  idempotencyKey: string;
}

export interface SendEmailResult {
  messageId: string;
  etherealPreviewUrl: string | null;
}

export function createSmtpTransporter(sender: SmtpSenderConfig): Transporter {
  const password = decryptSecret(sender.encryptedSmtpPassword);
  return nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: {
      user: sender.smtpUsername,
      pass: password,
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
}

export async function verifySmtpConnection(sender: SmtpSenderConfig): Promise<boolean> {
  const transporter = createSmtpTransporter(sender);
  try {
    await transporter.verify();
    return true;
  } finally {
    transporter.close();
  }
}

export async function sendEmailViaSmtp(payload: SendEmailPayload): Promise<SendEmailResult> {
  const transporter = createSmtpTransporter(payload.sender);
  try {
    const isHtml = /<[a-z][\s\S]*>/i.test(payload.body);
    const info = await transporter.sendMail({
      from: payload.sender.email,
      to: payload.to,
      subject: payload.subject,
      ...(isHtml ? { html: payload.body, text: payload.body.replace(/<[^>]+>/g, ' ').trim() } : { text: payload.body }),
      headers: {
        'X-Idempotency-Key': payload.idempotencyKey,
      },
    });

    const previewUrlRaw = nodemailer.getTestMessageUrl(info);
    const etherealPreviewUrl = typeof previewUrlRaw === 'string' ? previewUrlRaw : null;

    if (etherealPreviewUrl) {
      logger.info(
        {
          emailTo: payload.to,
          messageId: info.messageId,
          etherealPreviewUrl,
        },
        'Email sent via Ethereal SMTP',
      );
    }

    return {
      messageId: info.messageId,
      etherealPreviewUrl,
    };
  } finally {
    transporter.close();
  }
}

export async function createEtherealTestAccount(): Promise<{
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpUsername: string;
  smtpPassword: string;
}> {
  const account = await nodemailer.createTestAccount();
  return {
    email: account.user,
    smtpHost: account.smtp.host || env.ETHEREAL_HOST,
    smtpPort: account.smtp.port || env.ETHEREAL_PORT,
    smtpUsername: account.user,
    smtpPassword: account.pass,
  };
}
