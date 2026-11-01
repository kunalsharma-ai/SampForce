import { z } from 'zod';

/** Workspace apps: one connection per app per workspace, made by an admin. */
export const APP_KEYS = ['slack', 'teams', 'zoom', 'docusign', 'payments', 'whatsapp'] as const;
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

// ───── DocuSign (contracts sent for e-signature) ─────

export type EnvelopeStatus = 'sent' | 'delivered' | 'completed' | 'declined' | 'voided';

export interface SignatureEnvelopeRow {
  id: string;
  contractId: string;
  envelopeId: string;
  status: EnvelopeStatus;
  signerName: string;
  signerEmail: string;
  sentBy: string | null;
  sentAt: string;
  completedAt: string | null;
  declinedReason: string | null;
  voidedReason: string | null;
  lastEventAt: string | null;
}

export const docusignSendSchema = z.object({
  contractId: z.string().uuid(),
  signerName: z.string().trim().min(1).max(100),
  signerEmail: z.string().trim().toLowerCase().email().max(254),
  emailSubject: z.string().trim().min(1).max(100).optional(),
  message: z.string().trim().max(2000).optional(),
  /** Sending emails the customer; the person confirms it explicitly. */
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that the contract should be emailed for signature' }) }),
});
export type DocusignSendInput = z.infer<typeof docusignSendSchema>;

export const docusignVoidSchema = z.object({ reason: z.string().trim().min(1, 'Give a reason').max(200) });
export const docusignListQuery = z.object({ contractId: z.string().uuid().optional() });

// ───── Card payments on quotes (the workspace's own Stripe or Razorpay account) ─────

export type CardPaymentProvider = 'stripe' | 'razorpay';
export type QuotePaymentStatus = 'pending' | 'paid' | 'expired' | 'failed';

/** Saved with the connection (keys are sealed separately and never returned). */
export interface PaymentsSettings {
  provider: CardPaymentProvider;
  mode: 'test' | 'live';
  /** Where the workspace must point its provider webhook. */
  webhookUrl: string;
  /** When the first signed webhook arrived; payments are confirmed only through webhooks. */
  lastWebhookAt: string | null;
}

export const paymentsConnectSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('stripe'),
    /** A restricted key (rk_) with Checkout Sessions write is recommended; a secret key (sk_) also works. */
    secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{10,200}$/, 'Paste a Stripe secret or restricted key (sk_… or rk_…)'),
    webhookSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9]{10,200}$/, 'Paste the webhook signing secret (whsec_…)'),
  }),
  z.object({
    provider: z.literal('razorpay'),
    keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/, 'Paste the Razorpay key id (rzp_test_… or rzp_live_…)'),
    keySecret: z.string().trim().min(10).max(200),
    webhookSecret: z.string().trim().min(8, 'Enter the webhook secret you set in Razorpay').max(200),
  }),
]);
export type PaymentsConnectInput = z.infer<typeof paymentsConnectSchema>;

export interface QuotePaymentRow {
  id: string;
  quoteId: string;
  provider: CardPaymentProvider;
  status: QuotePaymentStatus;
  amount: number;
  currency: string;
  payerEmail: string | null;
  providerPaymentId: string | null;
  paidAt: string | null;
  createdAt: string;
}

// ───── WhatsApp Business (the workspace's own WhatsApp Business Platform Cloud API number) ─────

/** Saved with the connection (the access token and app secret are sealed separately and never returned). */
export interface WhatsappSettings {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string | null;
  /** Callback URL and verify token to enter in the Meta app's WhatsApp webhook configuration. */
  webhookUrl: string;
  verifyToken: string;
  /** When the first signed webhook arrived; delivery status and replies arrive only through webhooks. */
  lastWebhookAt: string | null;
}

const graphId = z.string().trim().regex(/^\d{5,25}$/, 'Paste the numeric id from WhatsApp Manager');

export const whatsappConnectSchema = z.object({
  phoneNumberId: graphId,
  wabaId: graphId,
  /** A System User access token with whatsapp_business_messaging and whatsapp_business_management. */
  accessToken: z.string().trim().regex(/^EA[A-Za-z0-9]{20,1000}$/, 'Paste a Meta access token (it starts with EA)'),
  /** The Meta app's App Secret, used to check the X-Hub-Signature-256 header on webhooks. */
  appSecret: z.string().trim().regex(/^[a-f0-9]{32}$/, 'Paste the 32-character App Secret from the Meta app settings'),
});
export type WhatsappConnectInput = z.infer<typeof whatsappConnectSchema>;

export interface WhatsappTemplate {
  name: string;
  language: string;
  category: string;
  /** The body text with {{1}}, {{2}}… placeholders. */
  body: string;
  /** How many body placeholders the template has. */
  params: number;
}

export type WhatsappMessageStatus = 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

export interface WhatsappMessageRow {
  id: string;
  direction: 'in' | 'out';
  kind: 'template' | 'text' | 'other';
  body: string;
  templateName: string | null;
  status: WhatsappMessageStatus;
  error: string | null;
  sentBy: string | null;
  source: 'manual' | 'workflow' | 'webhook';
  createdAt: string;
  statusAt: string | null;
}

export interface WhatsappConsentRow {
  phone: string;
  source: string;
  recordedBy: string | null;
  recordedAt: string;
}

/** Everything the contact page needs for the WhatsApp panel. */
export interface WhatsappThread {
  /** The contact's number in international digits, or null with the reason it cannot be used. */
  phone: string | null;
  phoneProblem: string | null;
  consent: WhatsappConsentRow | null;
  /** Free-form replies are allowed until this time (24 hours after their last message); otherwise only templates. */
  windowOpenUntil: string | null;
  messages: WhatsappMessageRow[];
}

export const whatsappConsentSchema = z.object({
  contactId: z.string().uuid(),
  /** How the person agreed, for the record (for example "Ticked the WhatsApp box on the demo form, 3 Nov"). */
  source: z.string().trim().min(5, 'Say how they agreed').max(200),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that this person agreed to receive WhatsApp messages' }) }),
});

export const whatsappSendSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('template'),
    contactId: z.string().uuid(),
    templateName: z.string().trim().regex(/^[a-z0-9_]{1,512}$/),
    language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/),
    params: z.array(z.string().trim().min(1).max(1024)).max(20).default([]),
    /** Sending messages the customer; the person confirms it explicitly. */
    confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that the message should be sent' }) }),
  }),
  z.object({
    kind: z.literal('text'),
    contactId: z.string().uuid(),
    text: z.string().trim().min(1).max(4096),
    confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that the message should be sent' }) }),
  }),
]);
export type WhatsappSendInput = z.infer<typeof whatsappSendSchema>;
