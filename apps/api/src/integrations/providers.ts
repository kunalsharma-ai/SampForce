import type { IntegrationProviderKey } from '@dealflow/types';
import type { ApiEnv } from '../common/env';

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

export interface ProviderEmail {
  providerMessageId: string;
  threadId: string | null;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  snippet: string | null;
  bodyText: string | null;
  sentAt: Date;
  /** True when the mailbox owner sent it. */
  outbound: boolean;
}

export interface ProviderEvent {
  providerEventId: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  location: string | null;
  attendees: string[];
  organizer: string | null;
  canceled: boolean;
  /** The online meeting link (Google Meet, Teams, Zoom) when the event has one. */
  joinUrl?: string | null;
}

/** First https link to a known meeting service in the text, if any. */
export function meetingLink(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t?.match(/https:\/\/(?:meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')]+/i);
    if (m) return m[0];
  }
  return null;
}

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  /** Plain-text body; always sent. */
  body: string;
  /** Optional HTML alternative (sequences use it for tracking links). */
  html?: string;
  /** Extra headers, e.g. List-Unsubscribe. Microsoft Graph only accepts `X-` headers, so others are dropped there. */
  headers?: Record<string, string>;
  /** The provider thread to reply in. Gmail files the message in that thread; Graph's sendMail cannot, so Outlook may show it separately. */
  threadId?: string;
}

/** The access token was rejected or the refresh token revoked: the user must reconnect. */
export class ReauthRequiredError extends Error {}
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ProviderAdapter {
  key: IntegrationProviderKey;
  name: string;
  scopes: string[];
  missingConfig(): string[];
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refresh(refreshToken: string): Promise<TokenSet>;
  accountEmail(accessToken: string): Promise<string>;
  /** Messages received or sent after `since`, oldest first, capped per call (later syncs continue from the newest). */
  listMessages(accessToken: string, since: Date, account: string): Promise<ProviderEmail[]>;
  listEvents(accessToken: string, from: Date, to: Date): Promise<ProviderEvent[]>;
  sendMail(accessToken: string, mail: OutgoingEmail): Promise<{ providerMessageId: string | null; threadId: string | null }>;
}

const TIMEOUT_MS = 15_000;
const MAX_MESSAGES = 50;
const MAX_PAGES = 4;

async function http<T>(url: string, init: RequestInit & { token?: string; form?: Record<string, string> } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  let body = init.body;
  if (init.form) {
    headers.set('content-type', 'application/x-www-form-urlencoded');
    body = new URLSearchParams(init.form).toString();
  }
  const res = await fetch(url, { ...init, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error page; keep json null.
  }
  if (res.status === 401 || (res.status === 400 && (json as { error?: string } | null)?.error === 'invalid_grant')) {
    throw new ReauthRequiredError('The provider rejected the stored credentials');
  }
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } | string; error_description?: string } | null);
    const detail = typeof msg?.error === 'string' ? (msg.error_description ?? msg.error) : msg?.error?.message;
    throw new ProviderError(detail ? `Provider request failed (${res.status}): ${detail}` : `Provider request failed (${res.status})`, res.status);
  }
  return json as T;
}

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** Pulls bare addresses out of RFC 5322 header values like `"Ana" <ana@x.com>, bo@y.com`. */
export function parseAddresses(value: string | undefined): string[] {
  if (!value) return [];
  const found = value.match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  return [...new Set(found.map((a) => a.toLowerCase()))];
}

function tokenSet(r: { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }, previousRefresh: string | null = null): TokenSet {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token ?? previousRefresh,
    expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000,
    scopes: (r.scope ?? '').split(/\s+/).filter(Boolean),
  };
}

/** Encodes an RFC 2822 plain-text message for Gmail's `raw` field, with headers safe from injection. */
export function rfc2822(mail: OutgoingEmail): string {
  const clean = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();
  const subject = /^[\x20-\x7e]*$/.test(mail.subject) ? clean(mail.subject) : `=?UTF-8?B?${Buffer.from(clean(mail.subject)).toString('base64')}?=`;
  const b64 = (s: string) => (Buffer.from(s).toString('base64').match(/.{1,76}/g) ?? ['']).join('\r\n');
  const extra = Object.entries(mail.headers ?? {})
    .filter(([k]) => /^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(k))
    .map(([k, v]) => `${k}: ${clean(v)}`);
  const head = [`From: ${clean(mail.from)}`, `To: ${clean(mail.to)}`, `Subject: ${subject}`, ...extra, 'MIME-Version: 1.0'];
  let lines: string[];
  if (mail.html) {
    const boundary = `df-${Buffer.from(String(Math.random())).toString('hex').slice(0, 24)}`;
    lines = [
      ...head,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(mail.body),
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      b64(mail.html),
      `--${boundary}--`,
    ];
  } else {
    lines = [...head, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64(mail.body)];
  }
  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

// ───────────── Google (Gmail + Google Calendar) ─────────────

interface GmailPart {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string };
  parts?: GmailPart[];
}

function gmailText(part: GmailPart | undefined): string | null {
  if (!part) return null;
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts ?? []) {
    const t = gmailText(p);
    if (t) return t;
  }
  return null;
}

export function googleAdapter(env: ApiEnv): ProviderAdapter {
  const scopes = [
    'openid',
    'email',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar.readonly',
  ];
  const creds = () => ({ client_id: env.GOOGLE_CLIENT_ID ?? '', client_secret: env.GOOGLE_CLIENT_SECRET ?? '' });
  return {
    key: 'GOOGLE',
    name: 'Google Workspace (Gmail and Calendar)',
    scopes,
    missingConfig: () => [!env.GOOGLE_CLIENT_ID && 'GOOGLE_CLIENT_ID', !env.GOOGLE_CLIENT_SECRET && 'GOOGLE_CLIENT_SECRET'].filter((v): v is string => !!v),
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({
        client_id: creds().client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return `${env.GOOGLE_AUTH_BASE_URL}/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode(code, redirectUri) {
      const r = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(env.GOOGLE_TOKEN_URL, {
        method: 'POST',
        form: { ...creds(), code, redirect_uri: redirectUri, grant_type: 'authorization_code' },
      });
      return tokenSet(r);
    },
    async refresh(refreshToken) {
      const r = await http<{ access_token: string; expires_in?: number; scope?: string }>(env.GOOGLE_TOKEN_URL, {
        method: 'POST',
        form: { ...creds(), refresh_token: refreshToken, grant_type: 'refresh_token' },
      });
      return tokenSet(r, refreshToken);
    },
    async accountEmail(token) {
      const r = await http<{ email?: string }>(`${env.GOOGLE_API_BASE_URL}/oauth2/v3/userinfo`, { token });
      if (!r.email) throw new ProviderError('Google did not return an email address', 502);
      return lower(r.email);
    },
    async listMessages(token, since) {
      // Gmail lists newest first, so follow a few pages to avoid skipping messages after a quiet period.
      const ids: string[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ maxResults: String(MAX_MESSAGES), q: `after:${Math.floor(since.getTime() / 1000)}`, ...(pageToken ? { pageToken } : {}) });
        const list = await http<{ messages?: { id: string }[]; nextPageToken?: string }>(`${env.GMAIL_API_BASE_URL}/gmail/v1/users/me/messages?${q}`, { token });
        ids.push(...(list.messages ?? []).map((m) => m.id));
        pageToken = list.nextPageToken;
        if (!pageToken) break;
      }
      const out: ProviderEmail[] = [];
      for (const id of ids) {
        const m = await http<{ id: string; threadId?: string; internalDate: string; snippet?: string; labelIds?: string[]; payload?: GmailPart }>(
          `${env.GMAIL_API_BASE_URL}/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`,
          { token },
        );
        const header = (n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n)?.value;
        out.push({
          providerMessageId: m.id,
          threadId: m.threadId ?? null,
          from: parseAddresses(header('from'))[0] ?? '',
          to: parseAddresses(header('to')),
          cc: parseAddresses(header('cc')),
          subject: header('subject') ?? '(no subject)',
          snippet: m.snippet ?? null,
          bodyText: gmailText(m.payload),
          sentAt: new Date(Number(m.internalDate)),
          outbound: (m.labelIds ?? []).includes('SENT'),
        });
      }
      return out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    },
    async listEvents(token, from, to) {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      const r = await http<{
        items?: {
          id: string;
          status?: string;
          summary?: string;
          location?: string;
          start?: { dateTime?: string; date?: string };
          end?: { dateTime?: string; date?: string };
          attendees?: { email?: string }[];
          organizer?: { email?: string };
          hangoutLink?: string;
          description?: string;
          conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
        }[];
      }>(`${env.GOOGLE_API_BASE_URL}/calendar/v3/calendars/primary/events?${q}`, { token });
      return (r.items ?? []).flatMap((e) => {
        const start = e.start?.dateTime ?? e.start?.date;
        const end = e.end?.dateTime ?? e.end?.date ?? start;
        if (!start || !end) return [];
        return [{
          providerEventId: e.id,
          title: e.summary ?? '(no title)',
          startsAt: new Date(start),
          endsAt: new Date(end),
          location: e.location ?? null,
          attendees: (e.attendees ?? []).map((a) => lower(a.email)).filter(Boolean),
          organizer: e.organizer?.email ? lower(e.organizer.email) : null,
          canceled: e.status === 'cancelled',
          joinUrl: e.hangoutLink ?? meetingLink(e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri, e.location, e.description),
        }];
      });
    },
    async sendMail(token, mail) {
      const r = await http<{ id?: string; threadId?: string }>(`${env.GMAIL_API_BASE_URL}/gmail/v1/users/me/messages/send`, {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: rfc2822(mail), ...(mail.threadId ? { threadId: mail.threadId } : {}) }),
      });
      return { providerMessageId: r.id ?? null, threadId: r.threadId ?? null };
    },
  };
}

// ───────────── Microsoft 365 (Outlook mail + calendar via Microsoft Graph) ─────────────

interface GraphAddress {
  emailAddress?: { address?: string };
}

/** Graph only allows custom headers that start with `X-`. */
function graphHeaders(h: Record<string, string> | undefined): { name: string; value: string }[] {
  return Object.entries(h ?? {})
    .filter(([k]) => /^x-[a-z0-9-]{1,60}$/i.test(k))
    .map(([name, value]) => ({ name, value: value.replace(/[\r\n]+/g, ' ') }));
}

export function microsoftAdapter(env: ApiEnv): ProviderAdapter {
  const scopes = ['offline_access', 'openid', 'email', 'User.Read', 'Mail.Read', 'Mail.Send', 'Calendars.Read'];
  // Read on each call: MICROSOFT_TENANT can change in the operator console without a restart.
  const tenantBase = () => `${env.MICROSOFT_LOGIN_BASE_URL}/${encodeURIComponent(env.MICROSOFT_TENANT || 'common')}/oauth2/v2.0`;
  const graph = `${env.MICROSOFT_GRAPH_BASE_URL}/v1.0`;
  const creds = () => ({ client_id: env.MICROSOFT_CLIENT_ID ?? '', client_secret: env.MICROSOFT_CLIENT_SECRET ?? '' });
  const addr = (a: GraphAddress | undefined) => lower(a?.emailAddress?.address);
  return {
    key: 'MICROSOFT',
    name: 'Microsoft 365 (Outlook mail and calendar)',
    scopes,
    missingConfig: () =>
      [!env.MICROSOFT_CLIENT_ID && 'MICROSOFT_CLIENT_ID', !env.MICROSOFT_CLIENT_SECRET && 'MICROSOFT_CLIENT_SECRET'].filter((v): v is string => !!v),
    authorizeUrl(state, redirectUri) {
      const q = new URLSearchParams({ client_id: creds().client_id, response_type: 'code', redirect_uri: redirectUri, response_mode: 'query', scope: scopes.join(' '), state });
      return `${tenantBase()}/authorize?${q}`;
    },
    async exchangeCode(code, redirectUri) {
      const r = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(`${tenantBase()}/token`, {
        method: 'POST',
        form: { ...creds(), code, redirect_uri: redirectUri, grant_type: 'authorization_code', scope: scopes.join(' ') },
      });
      return tokenSet(r);
    },
    async refresh(refreshToken) {
      const r = await http<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>(`${tenantBase()}/token`, {
        method: 'POST',
        form: { ...creds(), refresh_token: refreshToken, grant_type: 'refresh_token', scope: scopes.join(' ') },
      });
      return tokenSet(r, refreshToken);
    },
    async accountEmail(token) {
      const r = await http<{ mail?: string | null; userPrincipalName?: string }>(`${graph}/me?$select=mail,userPrincipalName`, { token });
      const email = r.mail ?? r.userPrincipalName;
      if (!email) throw new ProviderError('Microsoft did not return an email address', 502);
      return lower(email);
    },
    async listMessages(token, since, account) {
      // Inbox only: messages sent from DealFlow are recorded when sent, so the Sent folder is not re-imported.
      const q = new URLSearchParams({
        $top: String(MAX_MESSAGES),
        $orderby: 'receivedDateTime asc',
        $filter: `receivedDateTime gt ${since.toISOString()}`,
        $select: 'id,conversationId,subject,bodyPreview,body,from,toRecipients,ccRecipients,receivedDateTime',
      });
      const r = await http<{
        value?: { id: string; conversationId?: string; subject?: string; bodyPreview?: string; body?: { content?: string }; from?: GraphAddress; toRecipients?: GraphAddress[]; ccRecipients?: GraphAddress[]; receivedDateTime: string }[];
      }>(`${graph}/me/mailFolders/inbox/messages?${q}`, { token, headers: { Prefer: 'outlook.body-content-type="text"' } });
      return (r.value ?? [])
        .map((m) => ({
          providerMessageId: m.id,
          threadId: m.conversationId ?? null,
          from: addr(m.from),
          to: (m.toRecipients ?? []).map(addr).filter(Boolean),
          cc: (m.ccRecipients ?? []).map(addr).filter(Boolean),
          subject: m.subject || '(no subject)',
          snippet: m.bodyPreview ?? null,
          bodyText: m.body?.content ?? null,
          sentAt: new Date(m.receivedDateTime),
          outbound: addr(m.from) === account,
        }))
        .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    },
    async listEvents(token, from, to) {
      const q = new URLSearchParams({
        startDateTime: from.toISOString(),
        endDateTime: to.toISOString(),
        $top: '250',
        $select: 'id,subject,start,end,location,attendees,organizer,isCancelled,onlineMeeting',
      });
      const r = await http<{
        value?: { id: string; subject?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; location?: { displayName?: string }; attendees?: GraphAddress[]; organizer?: GraphAddress; isCancelled?: boolean; onlineMeeting?: { joinUrl?: string } | null }[];
      }>(`${graph}/me/calendarView?${q}`, { token, headers: { Prefer: 'outlook.timezone="UTC"' } });
      const utc = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
      return (r.value ?? []).flatMap((e) =>
        e.start?.dateTime && e.end?.dateTime
          ? [{
              providerEventId: e.id,
              title: e.subject || '(no title)',
              startsAt: utc(e.start.dateTime),
              endsAt: utc(e.end.dateTime),
              location: e.location?.displayName || null,
              attendees: (e.attendees ?? []).map(addr).filter(Boolean),
              organizer: addr(e.organizer) || null,
              canceled: !!e.isCancelled,
              joinUrl: e.onlineMeeting?.joinUrl ?? meetingLink(e.location?.displayName),
            }]
          : [],
      );
    },
    async sendMail(token, mail) {
      await http<null>(`${graph}/me/sendMail`, {
        method: 'POST',
        token,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message: {
            subject: mail.subject,
            body: mail.html ? { contentType: 'HTML', content: mail.html } : { contentType: 'Text', content: mail.body },
            toRecipients: [{ emailAddress: { address: mail.to } }],
            ...(graphHeaders(mail.headers).length ? { internetMessageHeaders: graphHeaders(mail.headers) } : {}),
          },
          saveToSentItems: true,
        }),
      });
      // Graph's sendMail returns 202 with no message id.
      return { providerMessageId: null, threadId: null };
    },
  };
}
