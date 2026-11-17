/**
 * Email over SMTP (Mailpit in development: http://localhost:8025). The transport can be swapped, so tests
 * capture messages instead of sending them.
 */
import nodemailer from 'nodemailer';
import { config } from '../../../config';
import type { EmailPayload } from '../outbox';

export type EmailTransport = (m: EmailPayload) => Promise<void>;

let smtp: nodemailer.Transporter | null = null;

const smtpTransport: EmailTransport = async (m) => {
  smtp ??= nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465 });
  await smtp.sendMail({ from: config.smtp.from, to: m.to, subject: m.subject, text: m.text });
};

let transport: EmailTransport = smtpTransport;

export const sendEmail = (m: EmailPayload) => transport(m);

/** Replace the transport (tests); call with no argument to restore SMTP. */
export function setEmailTransport(t?: EmailTransport) {
  transport = t ?? smtpTransport;
}
