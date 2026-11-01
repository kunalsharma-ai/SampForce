import { z } from 'zod';

/** Workspace apps: one connection per app per workspace, made by an admin. */
export const APP_KEYS = ['slack', 'teams', 'zoom'] as const;
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
  /** Parts of the app that are Pending Configuration even when it can connect (e.g. Zoom transcripts without the event secret). */
  warnings: string[];
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

// ───── Microsoft Teams (Workflows webhooks, one URL per channel) ─────

/** DealFlow's own id for a Teams channel added in Integrations. */
const teamsChannelId = z.string().regex(/^tc_[a-f0-9]{12}$/, 'Choose a Teams channel');
export { teamsChannelId };

export interface TeamsChannel {
  id: string;
  name: string;
  addedAt: string;
  /** Set when Teams stopped accepting this channel's URL; cleared by the next successful post. */
  lastError: string | null;
}

/** Stored in the connection's settings (the URLs themselves are sealed with the credentials). */
export interface TeamsSettings {
  channels: TeamsChannel[];
  defaultChannelId: string | null;
}

export const teamsAddChannelSchema = z.object({
  name: z.string().trim().min(1).max(80),
  webhookUrl: z.string().trim().url('Paste the full workflow URL').max(2000),
});
export type TeamsAddChannelInput = z.infer<typeof teamsAddChannelSchema>;

export const teamsSettingsSchema = z.object({ defaultChannelId: teamsChannelId.nullable() });
export const teamsTestSchema = z.object({ channelId: teamsChannelId.optional() });

/** Channel ids a "Post to chat" step may name: a Slack channel id, or a Teams channel added in Integrations. */
export const chatChannelId = z.string().regex(/^([CG][A-Z0-9]{2,20}|tc_[a-f0-9]{12})$/);

// ───── Zoom (meetings scheduled from DealFlow, and their transcripts) ─────

export type ZoomTranscriptStatus = 'none' | 'waiting' | 'ready' | 'imported' | 'failed';

export interface ZoomMeetingRow {
  id: string;
  zoomMeetingId: string;
  topic: string;
  startsAt: string;
  durationMinutes: number;
  joinUrl: string;
  hostEmail: string;
  recordToCloud: boolean;
  leadId: string | null;
  contactId: string | null;
  dealId: string | null;
  createdBy: string | null;
  transcriptStatus: ZoomTranscriptStatus;
  transcriptError: string | null;
  /** The meeting notes record holding the imported transcript. */
  meetingRecordId: string | null;
  createdAt: string;
}

export const zoomMeetingCreateSchema = z
  .object({
    topic: z.string().trim().min(1).max(200),
    startsAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(480),
    /** IANA time zone shown to invitees in Zoom; the start time itself is absolute. */
    timezone: z.string().trim().max(64).optional(),
    leadId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    dealId: z.string().uuid().optional(),
    /**
     * Turns on Zoom cloud recording so the transcript can be imported into meeting notes. Zoom tells participants the
     * meeting is recorded; the organiser confirms they have the participants' consent.
     */
    recordToCloud: z.boolean().default(false),
    recordingConsent: z.boolean().default(false),
  })
  .refine((v) => [v.leadId, v.contactId, v.dealId].filter(Boolean).length === 1, { message: 'Link the meeting to one lead, contact or deal', path: ['leadId'] })
  .refine((v) => !v.recordToCloud || v.recordingConsent, { message: 'Confirm that participants agree to the recording', path: ['recordingConsent'] });
export type ZoomMeetingCreate = z.infer<typeof zoomMeetingCreateSchema>;

export const zoomMeetingListQuery = z.object({
  leadId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dealId: z.string().uuid().optional(),
});
