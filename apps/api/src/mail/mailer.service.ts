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
  message: 'This DealFlow site cannot send email yet. Ask your workspace administrator for help.',
};

/**
 * DealFlow's own email (password resets), sent through the email service in SMTP_URL. This is separate from
 * people's connected mailboxes, which send their one-to-one and sequence emails.
 */
@Injectable()
export class MailerService {
  private readonly log = new Logger(MailerService.name);
  private readonly transport: Transporter | null;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.transport = env.SMTP_URL ? createTransport(env.SMTP_URL, { from: env.MAIL_FROM }) : null;
  }

  get configured(): boolean {
    return this.transport !== null;
  }

  /** Throws MAIL_NOT_CONFIGURED when there is no email service, and a 503 when it refuses the message. */
  async send(mail: SystemMail): Promise<void> {
    if (!this.transport) throw new ServiceUnavailableException(MAIL_NOT_CONFIGURED);
    try {
      await this.transport.sendMail({ from: this.env.MAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text });
    } catch (err) {
      // The address stays out of the log; the provider's message says what went wrong.
      this.log.error({ err: err instanceof Error ? err.message : String(err) }, 'System email was not sent');
      throw new ServiceUnavailableException({ code: 'MAIL_FAILED', message: 'The email could not be sent. Try again in a few minutes.' });
    }
  }
}
