import { Inject, Injectable } from '@nestjs/common';
import type { SlackChannel } from '@dealflow/types';
import { API_ENV, type ApiEnv } from '../common/env';

/** Bot scopes DealFlow asks for: list channels, post to channels it is in or public ones, and join public ones. */
export const SLACK_SCOPES = ['chat:write', 'chat:write.public', 'channels:read', 'groups:read'];

export interface SlackInstall {
  accessToken: string;
  teamId: string;
  teamName: string;
  botUserId: string | null;
  scopes: string[];
}

/** Slack answered with ok:false. `code` is Slack's error string, e.g. invalid_auth, channel_not_found. */
export class SlackError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
  /** The token no longer works: the app was removed or the token revoked. Reconnecting is the only fix. */
  get revoked(): boolean {
    return ['invalid_auth', 'account_inactive', 'token_revoked', 'not_authed', 'team_access_not_granted'].includes(this.code);
  }
}

const MESSAGES: Record<string, string> = {
  channel_not_found: 'Slack could not find that channel. Choose another channel in Integrations.',
  not_in_channel: 'The DealFlow app is not in that private channel. Invite it in Slack with /invite @DealFlow.',
  is_archived: 'That Slack channel is archived.',
  invalid_auth: 'Slack no longer accepts the DealFlow connection. Reconnect Slack in Integrations.',
  token_revoked: 'The DealFlow app was removed from Slack. Reconnect Slack in Integrations.',
  account_inactive: 'The DealFlow app was removed from Slack. Reconnect Slack in Integrations.',
  ratelimited: 'Slack is limiting requests. The step will be retried.',
  msg_too_long: 'The message is too long for Slack.',
};

/**
 * Slack Web API over plain HTTPS (OAuth v2 install, auth.test, conversations.list, chat.postMessage, auth.revoke).
 * Tested against a local stand-in that follows Slack's published API; not yet against Slack itself.
 */
@Injectable()
export class SlackClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  missingConfig(): string[] {
    return [!this.env.SLACK_CLIENT_ID && 'SLACK_CLIENT_ID', !this.env.SLACK_CLIENT_SECRET && 'SLACK_CLIENT_SECRET'].filter((x): x is string => !!x);
  }

  authorizeUrl(state: string, redirectUri: string): string {
    const q = new URLSearchParams({ client_id: this.env.SLACK_CLIENT_ID!, scope: SLACK_SCOPES.join(','), redirect_uri: redirectUri, state });
    return `${this.env.SLACK_AUTH_BASE_URL.replace(/\/+$/, '')}/oauth/v2/authorize?${q}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<SlackInstall> {
    const body = new URLSearchParams({ code, redirect_uri: redirectUri });
    const basic = Buffer.from(`${this.env.SLACK_CLIENT_ID}:${this.env.SLACK_CLIENT_SECRET}`).toString('base64');
    const r = await this.call<{ access_token: string; scope?: string; bot_user_id?: string; team?: { id: string; name: string } }>('oauth.v2.access', body, `Basic ${basic}`);
    if (!r.access_token || !r.team?.id) throw new SlackError('bad_response', 'Slack did not return a bot token.');
    return { accessToken: r.access_token, teamId: r.team.id, teamName: r.team.name, botUserId: r.bot_user_id ?? null, scopes: (r.scope ?? '').split(',').filter(Boolean) };
  }

  /** Cheapest call that proves a token works. */
  async authTest(token: string): Promise<{ teamId: string; team: string; userId: string }> {
    const r = await this.call<{ team_id: string; team: string; user_id: string }>('auth.test', new URLSearchParams(), `Bearer ${token}`);
    return { teamId: r.team_id, team: r.team, userId: r.user_id };
  }

  async listChannels(token: string): Promise<SlackChannel[]> {
    const out: SlackChannel[] = [];
    let cursor = '';
    for (let page = 0; page < 10; page++) {
      const q = new URLSearchParams({ types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
      const r = await this.call<{ channels: { id: string; name: string; is_private?: boolean; is_member?: boolean }[]; response_metadata?: { next_cursor?: string } }>('conversations.list', q, `Bearer ${token}`);
      out.push(...r.channels.map((c) => ({ id: c.id, name: c.name, isPrivate: !!c.is_private, isMember: !!c.is_member })));
      cursor = r.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async postMessage(token: string, channel: string, text: string): Promise<{ ts: string; channel: string }> {
    const r = await this.callJson<{ ts: string; channel: string }>('chat.postMessage', { channel, text, unfurl_links: false, unfurl_media: false }, token);
    return { ts: r.ts, channel: r.channel };
  }

  /** Revokes the bot token on disconnect. Failure is ignored by callers: the token is deleted either way. */
  async revoke(token: string): Promise<void> {
    await this.call('auth.revoke', new URLSearchParams(), `Bearer ${token}`);
  }

  private base(): string {
    return this.env.SLACK_API_BASE_URL.replace(/\/+$/, '');
  }

  private async call<T>(method: string, form: URLSearchParams, authorization: string): Promise<T> {
    const res = await fetch(`${this.base()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', authorization },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    return this.read<T>(res);
  }

  private async callJson<T>(method: string, body: object, token: string): Promise<T> {
    const res = await fetch(`${this.base()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return this.read<T>(res);
  }

  private async read<T>(res: Response): Promise<T> {
    if (res.status === 429) throw new SlackError('ratelimited', MESSAGES.ratelimited!);
    if (!res.ok) throw new SlackError(`http_${res.status}`, `Slack answered ${res.status}.`);
    const data = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) {
      const code = data.error ?? 'unknown_error';
      throw new SlackError(code, MESSAGES[code] ?? `Slack refused the request (${code}).`);
    }
    return data;
  }
}

/** Slack's mrkdwn treats &, < and > as control characters; record values must not be able to inject links or mentions. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
