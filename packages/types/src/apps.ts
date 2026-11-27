import { z } from 'zod';

/** Workspace apps: one connection per app per workspace, made by an admin. */
export const APP_KEYS = ['docusign', 'payments', 'whatsapp', 'twilio', 'sampbidx'] as const;
export type AppKey = (typeof APP_KEYS)[number];

/**
 * - pending_configuration: this SampForce installation has no app credentials for it yet (an operator adds them).
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
  /** Parts of the app that are Pending Configuration even when it can connect (e.g. DocuSign status updates without the Connect key). */
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

// ───── SMS through the workspace's own Twilio account and number ─────

/** Saved with the connection (the Auth Token is sealed separately and never returned). */
export interface TwilioSettings {
  accountSid: string;
  /** The Twilio number messages are sent from, in E.164. */
  fromNumber: string;
  friendlyName: string;
  /** Trial accounts can text only verified numbers and add a "Sent from your Twilio trial account" prefix. */
  trial: boolean;
  /** URL to set as the number's "A message comes in" webhook in the Twilio console. */
  inboundUrl: string;
  /** When the first signed request from Twilio arrived (inbound SMS or status callback). */
  lastWebhookAt: string | null;
}

export const twilioConnectSchema = z.object({
  accountSid: z.string().trim().regex(/^AC[a-f0-9]{32}$/, 'Paste the Account SID from the Twilio console (it starts with AC)'),
  /** The account's Auth Token: needed to send and to check the X-Twilio-Signature on Twilio's requests. */
  authToken: z.string().trim().regex(/^[a-f0-9]{32}$/, 'Paste the 32-character Auth Token from the Twilio console'),
  fromNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Enter the Twilio number in international format, for example +447700900123'),
});
export type TwilioConnectInput = z.infer<typeof twilioConnectSchema>;

export type SmsMessageStatus = 'accepted' | 'sent' | 'delivered' | 'undelivered' | 'failed' | 'received';

export interface SmsMessageRow {
  id: string;
  direction: 'in' | 'out';
  body: string;
  segments: number;
  status: SmsMessageStatus;
  error: string | null;
  sentBy: string | null;
  source: 'manual' | 'workflow' | 'webhook';
  createdAt: string;
  statusAt: string | null;
}

export interface SmsConsentRow {
  phone: string;
  source: string;
  recordedBy: string | null;
  recordedAt: string;
}

/** Everything the contact page needs for the SMS panel. */
export interface SmsThread {
  /** The contact's number in E.164, or null with the reason it cannot be used. */
  phone: string | null;
  phoneProblem: string | null;
  consent: SmsConsentRow | null;
  /** Set when the person opted out by replying STOP; Twilio also blocks sends until they reply START. */
  optedOutAt: string | null;
  messages: SmsMessageRow[];
}

export const smsConsentSchema = z.object({
  contactId: z.string().uuid(),
  /** How the person agreed, for the record (for example "Opted in to texts on the webinar form, 3 Nov"). */
  source: z.string().trim().min(5, 'Say how they agreed').max(200),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that this person agreed to receive text messages' }) }),
});

/** 1,600 characters is Twilio's limit for one message (sent as up to 10 segments). */
export const SMS_MAX_LENGTH = 1600;

export const smsSendSchema = z.object({
  contactId: z.string().uuid(),
  text: z.string().trim().min(1).max(SMS_MAX_LENGTH),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm that the message should be sent' }) }),
});
export type SmsSendInput = z.infer<typeof smsSendSchema>;

const GSM7 = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = '^{}\\[~]|€';

/**
 * How many SMS segments a text takes, as carriers count them: GSM-7 text fits 160 characters in one segment and 153
 * per segment when split (extension characters such as € count twice); anything else (emoji, most non-Latin
 * scripts) is UCS-2 at 70, or 67 per segment. An estimate for the sender; Twilio reports the billed count.
 */
export function smsSegments(text: string): { encoding: 'GSM-7' | 'UCS-2'; units: number; segments: number } {
  let units = 0;
  let gsm = true;
  for (const ch of text) {
    if (GSM7.includes(ch)) units += 1;
    else if (GSM7_EXT.includes(ch)) units += 2;
    else {
      gsm = false;
      break;
    }
  }
  if (!gsm) {
    const n = [...text].reduce((a, ch) => a + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    return { encoding: 'UCS-2', units: n, segments: n <= 70 ? 1 : Math.ceil(n / 67) };
  }
  return { encoding: 'GSM-7', units, segments: units <= 160 ? 1 : Math.ceil(units / 153) };
}
