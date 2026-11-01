import { z } from 'zod';

/** Workspace apps: one connection per app per workspace, made by an admin. */
export const APP_KEYS = ['slack'] as const;
export type AppKey = (typeof APP_KEYS)[number];

/**
 * - pending_configuration: this DealFlow installation has no app credentials for it yet (an operator adds them).
 * - not_connected: ready; a workspace admin has not connected an account.
 * - connected: connected, and the last call to the provider succeeded.
 * - error: connected, but the provider refused the last call (for example the app was removed); reconnect.
 */
export type AppState = 'pending_configuration' | 'not_connected' | 'connected' | 'error';

export interface AppStatus {
  key: AppKey;
  name: string;
  description: string;
  state: AppState;
  /** Deployment secrets still missing, by name (pending_configuration only). */
  missingConfig: string[];
  connection: {
    accountName: string;
    externalAccountId: string;
    connectedAt: string;
    connectedBy: string | null;
    lastUsedAt: string | null;
    lastError: string | null;
    settings: Record<string, unknown>;
  } | null;
}

export interface AppEventRow {
  id: string;
  kind: string;
  ok: boolean;
  summary: string;
  externalId: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
}

export interface SlackChannel {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

const slackChannelId = z.string().regex(/^[CG][A-Z0-9]{2,20}$/, 'Choose a Slack channel');

export const slackSettingsSchema = z.object({
  /** Where "Post to Slack" steps go when they do not name a channel. */
  defaultChannelId: slackChannelId.nullable(),
  defaultChannelName: z.string().trim().max(80).nullable(),
});
export type SlackSettings = z.infer<typeof slackSettingsSchema>;

export const slackTestSchema = z.object({ channelId: slackChannelId.optional() });
export { slackChannelId };
