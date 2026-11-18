import { describe, expect, it } from 'vitest';
import { describeSmtpTarget, readSmtpUrl, smtpOptionsFrom, smtpUrlError, transportOptions } from './smtp-url';

describe('SMTP URL', () => {
  it('reads a Zoho-style URL with an escaped @ in the user name', () => {
    const t = readSmtpUrl('smtps://user%40frequentresearch.com:App5pecificPass@smtppro.zoho.in:465');
    expect(t).toEqual({ host: 'smtppro.zoho.in', port: 465, secure: true, user: 'user@frequentresearch.com', hasPassword: true, pass: 'App5pecificPass' });
    expect(describeSmtpTarget(t)).toBe('smtppro.zoho.in port 465 (TLS)');
    expect(readSmtpUrl(' smtp://u:p@smtp.example.com ').port).toBe(587);
  });

  it('builds Nodemailer options field by field, from separate settings first and the URL otherwise', () => {
    const fields = smtpOptionsFrom({ SMTP_HOST: 'smtppro.zoho.in', SMTP_PORT: 465, SMTP_USER: 'sales@example.com', SMTP_PASSWORD: 'p', SMTP_URL: 'smtp://ignored:x@other:587' });
    expect(transportOptions(fields!)).toEqual({ host: 'smtppro.zoho.in', port: 465, secure: true, auth: { user: 'sales@example.com', pass: 'p' } });
    expect(smtpOptionsFrom({ SMTP_HOST: 'smtp.example.com', SMTP_SECURE: false })).toMatchObject({ port: 587, secure: false, user: null });
    expect(smtpOptionsFrom({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: 2525 })).toMatchObject({ secure: false });
    expect(transportOptions(smtpOptionsFrom({ SMTP_URL: 'smtps://user%40example.com:p@smtppro.zoho.in:465' })!)).toEqual({ host: 'smtppro.zoho.in', port: 465, secure: true, auth: { user: 'user@example.com', pass: 'p' } });
    expect(smtpOptionsFrom({})).toBeNull();
  });

  it('says what to fix', () => {
    expect(smtpUrlError('smtps://u%40x.com:pa#ss@smtppro.zoho.in:465')).toMatch(/%23/);
    expect(smtpUrlError('smtps://u:pa ss@h:465')).toMatch(/space/);
    expect(smtpUrlError('smtps://u:50%off@h:465')).toMatch(/% that is not followed/);
    expect(smtpUrlError('smtps://u:p@smtp.example.com:587')).toMatch(/Port 587 uses STARTTLS/);
    expect(smtpUrlError('smtp://u:p@smtp.example.com:465')).toMatch(/Port 465 is encrypted/);
    expect(smtpUrlError('smtps://user@smtp.example.com:465')).toMatch(/no password/);
    expect(smtpUrlError('smtps://u:p@smtp.example.com:465')).toBeNull();
  });
});
