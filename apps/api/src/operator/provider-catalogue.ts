import type { ProviderKey } from '@dealflow/types';
import type { ManagedKeyName } from '../common/provider-keys';

export interface CatalogueField {
  name: ManagedKeyName;
  label: string;
  required: boolean;
  help?: string;
}

export interface CatalogueProvider {
  key: ProviderKey;
  name: string;
  usedFor: string;
  fields: CatalogueField[];
  /** The fields the connection test sends. Their fingerprint is stored with the result, so new keys need a new test. */
  tested: ManagedKeyName[];
  checkNote: string;
  app: { off: string; on: string; verified?: string };
}

/**
 * Every deployment-wide provider DealFlow reads keys for, in the order the operator console lists them.
 * Per-workspace providers (Twilio, WhatsApp, a workspace's own Stripe or Razorpay for quote payments, Teams webhooks)
 * are entered by each workspace admin under Settings > Apps and are not here.
 */
export const PROVIDER_CATALOGUE: CatalogueProvider[] = [
  {
    key: 'apollo', name: 'Apollo.io', usedFor: 'Prospect search and email reveal (Prospect Lists, browser extension)',
    fields: [{ name: 'APOLLO_API_KEY', label: 'API key', required: true, help: 'Apollo > Settings > Integrations > API. A master key is needed for people search.' }],
    tested: ['APOLLO_API_KEY'],
    checkNote: 'Runs one people search for a single result (Apollo returns no email addresses from search, and nothing is revealed).',
    app: { off: 'Mock Mode: labelled sample people', on: 'Pending Configuration until a call succeeds', verified: 'Connected in every workspace' },
  },
  {
    key: 'hunter', name: 'Hunter.io', usedFor: 'Email verification on prospects; data provider for the Email Finder',
    fields: [{ name: 'HUNTER_API_KEY', label: 'API key', required: true, help: 'Hunter > API.' }],
    tested: ['HUNTER_API_KEY'],
    checkNote: "Calls Hunter's account endpoint, which Hunter does not count as a search or verification.",
    app: { off: 'Pending Configuration', on: 'Key set: each workspace shows Connected after its first verification' },
  },
  {
    key: 'deepgram', name: 'Deepgram', usedFor: 'Transcription of meeting recordings and voice notes',
    fields: [{ name: 'DEEPGRAM_API_KEY', label: 'API key', required: true, help: 'Deepgram console > API Keys (Member role is enough).' }],
    tested: ['DEEPGRAM_API_KEY'],
    checkNote: "Lists the key's Deepgram projects. Nothing is transcribed, so nothing is billed.",
    app: { off: 'Pending Configuration', on: 'Configured, not yet verified until a workspace transcribes a recording' },
  },
  {
    key: 'google', name: 'Google (Gmail, Calendar)', usedFor: 'Mailbox sending and sync, calendar, meeting links',
    fields: [
      { name: 'GOOGLE_CLIENT_ID', label: 'OAuth client ID', required: true, help: 'Google Cloud console > APIs & Services > Credentials (Web application).' },
      { name: 'GOOGLE_CLIENT_SECRET', label: 'OAuth client secret', required: true },
    ],
    tested: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    checkNote: "Exchanges a made-up sign-in code at Google's token endpoint. Google checks the client ID and secret before the code, so the answer shows whether they are right. Nothing is connected.",
    app: { off: 'No Connect button for Google', on: 'Each person connects their own Google account' },
  },
  {
    key: 'microsoft', name: 'Microsoft 365 (Outlook, Graph)', usedFor: 'Mailbox sending and sync, calendar, meeting links',
    fields: [
      { name: 'MICROSOFT_CLIENT_ID', label: 'Application (client) ID', required: true, help: 'Microsoft Entra admin center > App registrations.' },
      { name: 'MICROSOFT_CLIENT_SECRET', label: 'Client secret value', required: true },
      { name: 'MICROSOFT_TENANT', label: 'Tenant', required: false, help: '"common" (the default) lets people from any organisation connect.' },
    ],
    tested: ['MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'MICROSOFT_TENANT'],
    checkNote: "Exchanges a made-up sign-in code at Microsoft's token endpoint, which checks the client ID and secret first. Nothing is connected.",
    app: { off: 'No Connect button for Microsoft', on: 'Each person connects their own Microsoft account' },
  },
  {
    key: 'slack', name: 'Slack', usedFor: 'Workspace app: "Post to Slack" workflow steps',
    fields: [
      { name: 'SLACK_CLIENT_ID', label: 'Client ID', required: true, help: 'api.slack.com/apps > your app > Basic Information > App Credentials.' },
      { name: 'SLACK_CLIENT_SECRET', label: 'Client secret', required: true },
    ],
    tested: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
    checkNote: 'Calls oauth.v2.access with a made-up code. Slack answers "invalid_code" only when the client ID and secret are right. Nothing is installed.',
    app: { off: 'Pending Configuration: no Connect button', on: 'Each workspace admin connects their Slack; the connection is verified with auth.test' },
  },
  {
    key: 'zoom', name: 'Zoom', usedFor: 'Workspace app: schedule Zoom meetings from records; transcripts of recorded meetings',
    fields: [
      { name: 'ZOOM_CLIENT_ID', label: 'Client ID', required: true, help: 'Zoom App Marketplace > your General app > App Credentials.' },
      { name: 'ZOOM_CLIENT_SECRET', label: 'Client secret', required: true },
      { name: 'ZOOM_WEBHOOK_SECRET_TOKEN', label: 'Webhook secret token', required: false, help: 'Features > Access > Secret Token. Needed for transcript import; proven when Zoom sends its first signed event.' },
    ],
    tested: ['ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'],
    checkNote: "Exchanges a made-up code at Zoom's token endpoint, which checks the client ID and secret first. The webhook token is not part of the test.",
    app: { off: 'Pending Configuration: no Connect button', on: 'Each workspace admin connects their Zoom account; transcript import also needs the webhook secret token' },
  },
  {
    key: 'docusign', name: 'DocuSign', usedFor: 'Workspace app: send contracts for e-signature; signed envelopes mark contracts signed',
    fields: [
      { name: 'DOCUSIGN_INTEGRATION_KEY', label: 'Integration key', required: true, help: 'DocuSign Admin > Apps and Keys.' },
      { name: 'DOCUSIGN_SECRET_KEY', label: 'Secret key', required: true },
      { name: 'DOCUSIGN_CONNECT_HMAC_KEY', label: 'Connect HMAC key', required: false, help: 'Needed for signing status updates; proven when DocuSign sends its first signed event.' },
      { name: 'DOCUSIGN_AUTH_BASE_URL', label: 'Account server', required: false, help: 'https://account.docusign.com (default), or https://account-d.docusign.com for the developer environment.' },
    ],
    tested: ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_SECRET_KEY', 'DOCUSIGN_AUTH_BASE_URL'],
    checkNote: "Exchanges a made-up code at DocuSign's token endpoint, which checks the integration key and secret first. The HMAC key is not part of the test.",
    app: { off: 'Pending Configuration: no Connect button', on: 'Each workspace admin connects their DocuSign account; status updates also need the Connect HMAC key' },
  },
  {
    key: 'anthropic', name: 'Anthropic (Claude)', usedFor: 'AI agents, email assistant, proposals, meeting and voice readings',
    fields: [{ name: 'ANTHROPIC_API_KEY', label: 'API key', required: true, help: 'Claude Console > API keys.' }],
    tested: ['ANTHROPIC_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: { off: 'AI features show as not configured', on: 'AI features available' },
  },
  {
    key: 'smtp', name: 'Email (SMTP)', usedFor: 'Password resets, invitations, client portal email',
    fields: [
      { name: 'SMTP_URL', label: 'SMTP URL', required: true, help: 'smtps://user:password@smtp.example.com:465, or smtp://… :587 for STARTTLS.' },
      { name: 'MAIL_FROM', label: 'Sender', required: true, help: 'For example: DealFlow <no-reply@example.com>' },
    ],
    tested: ['SMTP_URL'],
    checkNote: 'Connects to the email service and signs in, then disconnects. No email is sent.',
    app: { off: 'System email is not sent', on: 'System email is sent' },
  },
  {
    key: 'zapier', name: 'Zapier', usedFor: 'The DealFlow app in Zapier: the invite link shown under Settings > Apps',
    fields: [{ name: 'ZAPIER_INVITE_URL', label: 'Invite link', required: true, help: "Zapier developer platform > your DealFlow integration > Sharing. Workspaces sign in with their own DealFlow API keys." }],
    tested: ['ZAPIER_INVITE_URL'],
    checkNote: 'Opens the invite link and checks that Zapier answers.',
    app: { off: 'Pending Configuration: no invite link', on: 'Workspace admins see the invite link' },
  },
  {
    key: 'stripe', name: 'Stripe (subscription billing)', usedFor: 'Online checkout for DealFlow plans. Off while ONLINE_PAYMENTS_ENABLED is false (offline invoices)',
    fields: [
      { name: 'STRIPE_SECRET_KEY', label: 'Secret key', required: true, help: 'Stripe Dashboard > Developers > API keys (a restricted key works).' },
      { name: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook signing secret', required: true, help: 'Developers > Webhooks > your endpoint. Proven when Stripe sends its first signed event.' },
    ],
    tested: ['STRIPE_SECRET_KEY'],
    checkNote: 'Reads the account balance. Nothing is charged or created.',
    app: { off: 'Checkout says it is not configured', on: 'Checkout available when online payments are on' },
  },
  {
    key: 'razorpay', name: 'Razorpay (subscription billing)', usedFor: 'Online checkout for DealFlow plans in India. Off while ONLINE_PAYMENTS_ENABLED is false',
    fields: [
      { name: 'RAZORPAY_KEY_ID', label: 'Key ID', required: true, help: 'Razorpay Dashboard > Account & Settings > API keys.' },
      { name: 'RAZORPAY_KEY_SECRET', label: 'Key secret', required: true },
      { name: 'RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret', required: true, help: 'Proven when Razorpay sends its first signed event.' },
    ],
    tested: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    checkNote: 'Lists one subscription plan. Nothing is charged or created.',
    app: { off: 'Checkout says it is not configured', on: 'Checkout available when online payments are on' },
  },
];
