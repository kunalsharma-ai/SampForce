import { Inject, Injectable } from '@nestjs/common';
import { assertPublicUrl, publicFetch, UnsafeTargetError } from '../common/net-guard';
import { API_ENV, type ApiEnv } from '../common/env';

/**
 * Microsoft Teams through the Teams "Workflows" app: in a channel, "Send webhook alerts to a channel" (or the Power
 * Automate trigger "When a Teams webhook request is received") gives a URL that posts an Adaptive Card to that
 * channel. Microsoft is retiring Office 365 connector webhooks in favour of Workflows, so only Workflows URLs are accepted. No DealFlow-wide
 * secret is needed; each URL is a secret of the workspace and is stored sealed.
 * Tested against a local stand-in that follows Microsoft's published request shape; not yet against Teams itself.
 */
export const TEAMS_WEBHOOK_HOSTS = ['.logic.azure.com', '.powerplatform.com'];

export class TeamsError extends Error {
  constructor(
    readonly code: 'invalid_url' | 'gone' | 'rejected' | 'ratelimited' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
  /** The workflow was deleted, turned off or its URL regenerated. Only adding a new URL fixes it. */
  get revoked(): boolean {
    return this.code === 'gone';
  }
}

export interface TeamsMessage {
  text: string;
  link: { title: string; url: string } | null;
}

@Injectable()
export class TeamsClient {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Refuses anything that is not an https Workflows URL on a public address. */
  async checkUrl(raw: string): Promise<URL> {
    const allowPrivate = this.env.ALLOW_PRIVATE_NETWORK_TARGETS;
    if (!allowPrivate) {
      let host = '';
      let https = false;
      try {
        const u = new URL(raw.trim());
        host = u.hostname.toLowerCase();
        https = u.protocol === 'https:';
      } catch {
        throw new TeamsError('invalid_url', 'Not a valid URL');
      }
      if (!https || !TEAMS_WEBHOOK_HOSTS.some((h) => host.endsWith(h))) {
        throw new TeamsError('invalid_url', 'Paste the URL from the Teams Workflows app ("Send webhook alerts to a channel"). Office 365 connector URLs are being retired by Microsoft and are not accepted.');
      }
    }
    try {
      return await assertPublicUrl(raw.trim(), allowPrivate);
    } catch (e) {
      throw new TeamsError('invalid_url', e instanceof UnsafeTargetError ? e.message : 'Not a valid URL');
    }
  }

  async post(rawUrl: string, message: TeamsMessage): Promise<void> {
    const url = await this.checkUrl(rawUrl);
    const card = {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [{ type: 'TextBlock', text: message.text, wrap: true }],
            ...(message.link ? { actions: [{ type: 'Action.OpenUrl', title: message.link.title, url: message.link.url }] } : {}),
          },
        },
      ],
    };
    let res: Response;
    try {
      res = await publicFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card), redirect: 'error', signal: AbortSignal.timeout(10_000) }, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
    } catch (e) {
      if (e instanceof UnsafeTargetError) throw new TeamsError('invalid_url', e.message);
      throw new TeamsError('unavailable', e instanceof Error && e.name === 'TimeoutError' ? 'Teams did not answer in time.' : 'Teams could not be reached.');
    }
    await res.body?.cancel().catch(() => undefined);
    if (res.ok) return;
    if ([401, 403, 404, 410].includes(res.status)) throw new TeamsError('gone', 'The Teams workflow for this channel no longer accepts messages (it was deleted, turned off or its URL changed). Add the channel again with a new URL.');
    if (res.status === 429) throw new TeamsError('ratelimited', 'Teams is limiting requests. The step will be retried.');
    if (res.status === 400 || res.status === 413) throw new TeamsError('rejected', `Teams rejected the message (HTTP ${res.status}).`);
    throw new TeamsError('unavailable', `Teams answered with HTTP ${res.status}.`);
  }
}

/** Record values go into Adaptive Card markdown; break link syntax so they cannot add their own links. */
export function teamsEscape(s: string): string {
  return s.replace(/\]\s*\(/g, '] (');
}
