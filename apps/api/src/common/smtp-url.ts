/**
 * Reads an SMTP_URL the way the mailer will (smtps://USER:PASSWORD@HOST:PORT), so the console can say exactly what
 * is wrong with it before it is saved, and the connection test can say where it connected and as whom. The password
 * is never returned.
 */
export interface SmtpTarget {
  host: string;
  port: number;
  /** smtps:// is TLS from the start (usually 465); smtp:// upgrades with STARTTLS when the server offers it (587). */
  secure: boolean;
  user: string | null;
  hasPassword: boolean;
}

/** What the mailer connects with, Nodemailer's own option shape. Holds the password: never log or return it. */
export interface SmtpOptions extends SmtpTarget {
  pass: string;
}

const ESCAPE_HINT = 'If the user name or password contains @ : / # ? % or a space, write them as %40 %3A %2F %23 %3F %25 %20.';

export function readSmtpUrl(raw: string): SmtpOptions {
  const value = raw.trim();
  if (!/^smtps?:\/\//i.test(value)) throw new Error('The SMTP URL must start with smtp:// or smtps://.');
  if (/\s/.test(value)) throw new Error(`The SMTP URL contains a space. ${ESCAPE_HINT}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`The SMTP URL could not be read. ${ESCAPE_HINT}`);
  }
  if (url.hash || url.search || (url.pathname && url.pathname !== '/')) throw new Error(`The SMTP URL has text after the host and port. ${ESCAPE_HINT}`);
  if (!url.hostname) throw new Error('The SMTP URL has no server name, for example smtp.example.com.');
  let user: string;
  let pass: string;
  try {
    user = decodeURIComponent(url.username);
    pass = decodeURIComponent(url.password);
  } catch {
    throw new Error(`The user name or password in the SMTP URL has a % that is not followed by two hex digits. ${ESCAPE_HINT}`);
  }
  if (user && !pass) throw new Error(`The SMTP URL has a user name but no password. ${ESCAPE_HINT}`);
  const secure = url.protocol === 'smtps:';
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  if (secure && port === 587) throw new Error('Port 587 uses STARTTLS: write smtp:// (not smtps://) with port 587, or smtps:// with port 465.');
  if (!secure && port === 465) throw new Error('Port 465 is encrypted from the start: write smtps:// (not smtp://) with port 465.');
  return { host: url.hostname, port, secure, user: user || null, hasPassword: !!pass, pass };
}

/** "smtppro.zoho.in port 465 (TLS)": where the URL points, without the user or password. */
export const describeSmtpTarget = (t: SmtpTarget): string => `${t.host} port ${t.port} (${t.secure ? 'TLS' : 'STARTTLS when offered'})`;

/** For the console: null when the URL is fine, else what to fix. */
export function smtpUrlError(raw: string): string | null {
  try {
    readSmtpUrl(raw);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/**
 * The deployment's email service from the console: the separate SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER /
 * SMTP_PASSWORD settings when SMTP_HOST is set, otherwise the older SMTP_URL. Null when neither is set.
 */
export function smtpOptionsFrom(env: {
  SMTP_HOST?: string; SMTP_PORT?: number; SMTP_SECURE?: boolean; SMTP_USER?: string; SMTP_PASSWORD?: string; SMTP_URL?: string;
}): SmtpOptions | null {
  if (env.SMTP_HOST) {
    const port = env.SMTP_PORT ?? (env.SMTP_SECURE === false ? 587 : 465);
    const secure = env.SMTP_SECURE ?? port === 465;
    return { host: env.SMTP_HOST, port, secure, user: env.SMTP_USER || null, hasPassword: !!env.SMTP_PASSWORD, pass: env.SMTP_PASSWORD ?? '' };
  }
  return env.SMTP_URL ? readSmtpUrl(env.SMTP_URL) : null;
}

/** Nodemailer transport options, written out field by field: host, port, secure, auth. */
export const transportOptions = (o: SmtpOptions) => ({
  host: o.host,
  port: o.port,
  secure: o.secure,
  ...(o.user ? { auth: { user: o.user, pass: o.pass } } : {}),
});
