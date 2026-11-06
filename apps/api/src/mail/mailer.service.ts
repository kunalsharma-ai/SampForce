import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { API_ENV, type ApiEnv } from '../common/env';

export interface SystemMail {
  to: string;
  subject: string;
  text: string;
}

export const MAIL_NOT_CONFIGURED = {
  code: 'MAIL_NOT_CONFIGURED',
  message: 'This SampForce site cannot send email yet. Ask your workspace administrator for help.',
};

/**
 * SampForce's own email (password resets), sent through the email service in SMTP_URL. This is separate from
 * people's connected mailboxes, which send their one-to-one and sequence emails.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private cached: { key: string; transport: Transporter } | null = null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Built on first use and rebuilt when SMTP_URL or MAIL_FROM changes, so a key saved in the operator console applies at once. */
  private get transport(): Transporter | null {
    const url = this.env.SMTP_URL;
    if (!url) return null;
    const key = `${url}\n${this.env.MAIL_FROM ?? ''}`;
    if (this.cached?.key !== key) {
      this.cached?.transport.close();
      this.cached = { key, transport: createTransport(url, { from: this.env.MAIL_FROM }) };
    }
    return this.cached.transport;
  }

  /** Opens a connection and signs in without sending anything (the operator console's connection test). */
  async verify(): Promise<string> {
    const t = this.transport;
    if (!t) throw new Error('SMTP_URL is not set.');
    if (!this.env.MAIL_FROM) throw new Error('MAIL_FROM is not set.');
    await t.verify();
    return 'The email service accepted the connection and sign-in. No email was sent.';
  }

  get configured(): boolean {
    return !!this.env.SMTP_URL && !!this.env.MAIL_FROM;
  }

  /** Throws MAIL_NOT_CONFIGURED when there is no email service, and a 503 when it refuses the message. */
  async send(mail: SystemMail): Promise<void> {
    const transport = this.transport;
    if (!transport || !this.env.MAIL_FROM) throw new ServiceUnavailableException(MAIL_NOT_CONFIGURED);
    try {
      await transport.sendMail({ from: this.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    } catch (err) {
      // The address stays out of the log; the provider's message says what went wrong.
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, 'System email was not sent');
      throw new ServiceUnavailableException({ code: 'MAIL_FAILED', message: 'The email could not be sent. Try again in a few minutes.' });
    }
  }
}
