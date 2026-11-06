import type { ProviderKey } from '@dealflow/types';
import { parsePriceMap } from '../billing/providers';
import type { ManagedKeyName } from '../common/provider-keys';
import type { ReceiptProvider } from '../common/webhook-receipts';

export interface CatalogueField {
  name: ManagedKeyName;
  label: string;
  required: boolean;
  help?: string;
  /** An on/off setting: the console shows a switch and saves "true" or "false". */
  switch?: true;
  /** A check beyond the environment variable's own rule; returns an error message, or null when the value is fine. */
  validate?: (value: string) => string | null;
}

/** A URL to paste into the provider's console: a path on this deployment's public address. */
export interface CatalogueUrl {
  label: string;
  path: string;
  where: string;
}

export interface CatalogueProvider {
  key: ProviderKey;
  name: string;
  usedFor: string;
  fields: CatalogueField[];
  /** The fields the connection test sends (empty: there is nothing to call). Their fingerprint is stored with the result. */
  tested: ManagedKeyName[];
  checkNote: string;
  app: { off: string; on: string; verified?: string };
  /** Step-by-step setup in the provider's own console (ADR 0053). */
  setup: { consoleUrl?: string; consoleLabel?: string; steps: string[]; urls?: CatalogueUrl[] };
  /** Set for providers that send signed webhooks: the console shows whether a signed event has arrived. */
  webhook?: ReceiptProvider;
}

const priceMap = (v: string) => {
  try {
    parsePriceMap(v);
    return null;
  } catch (e) {
    return `${e instanceof Error ? e.message : 'Invalid mapping'}. Use plan:MONTH=id or plan:YEAR=id, separated by commas.`;
  }
};

/**
 * Every deployment-wide provider SampForce reads keys for, in the order the operator console lists them.
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
    setup: {
      consoleUrl: 'https://app.apollo.io/#/settings/integrations/api', consoleLabel: 'Apollo API keys',
      steps: [
        'Sign in to Apollo with the account whose credits SampForce should use.',
        'Open Settings > Integrations > API and choose "Create new key".',
        'Name it "SampForce", turn on "Set as master key" (people search needs it), and create it.',
        'Copy the key, paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'hunter', name: 'Hunter.io', usedFor: 'Email verification on prospects; data provider for the Email Finder',
    fields: [{ name: 'HUNTER_API_KEY', label: 'API key', required: true, help: 'Hunter > API.' }],
    tested: ['HUNTER_API_KEY'],
    checkNote: "Calls Hunter's account endpoint, which Hunter does not count as a search or verification.",
    app: { off: 'Pending Configuration', on: 'Key set: each workspace shows Connected after its first verification' },
    setup: {
      consoleUrl: 'https://hunter.io/api-keys', consoleLabel: 'Hunter API keys',
      steps: ['Sign in to Hunter and open API keys.', 'Copy the secret key (or create a new one named "SampForce").', 'Paste it below, save, then press Test connection.'],
    },
  },
  {
    key: 'deepgram', name: 'Deepgram', usedFor: 'Transcription of meeting recordings and voice notes',
    fields: [{ name: 'DEEPGRAM_API_KEY', label: 'API key', required: true, help: 'Deepgram console > API Keys (Member role is enough).' }],
    tested: ['DEEPGRAM_API_KEY'],
    checkNote: "Lists the key's Deepgram projects. Nothing is transcribed, so nothing is billed.",
    app: { off: 'Pending Configuration', on: 'Configured, not yet verified until a workspace transcribes a recording' },
    setup: {
      consoleUrl: 'https://console.deepgram.com/', consoleLabel: 'Deepgram console',
      steps: [
        'Sign in to the Deepgram console and pick the project to bill.',
        'Open API Keys > Create a New API Key. The Member role is enough; leave it without an expiry date.',
        'Copy the key (Deepgram shows it once), paste it below, save, then press Test connection.',
      ],
    },
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
    setup: {
      consoleUrl: 'https://console.cloud.google.com/apis/credentials', consoleLabel: 'Google Cloud credentials',
      steps: [
        'In Google Cloud console, create (or pick) a project for SampForce.',
        'APIs & Services > Library: enable the Gmail API and the Google Calendar API.',
        'APIs & Services > OAuth consent screen: choose External, add your app name, support email and domain, and add the scopes gmail.readonly, gmail.send and calendar.readonly.',
        'Credentials > Create credentials > OAuth client ID > Web application. Under "Authorised redirect URIs" add the redirect URL below.',
        'Copy the client ID and client secret, paste them below, save, then press Test connection.',
        'Before going live, submit the consent screen for Google verification: Gmail scopes are restricted, and until verified only test users you list can connect.',
      ],
      urls: [{ label: 'Authorised redirect URI', path: '/api/v1/integrations/google/callback', where: 'Credentials > your OAuth client > Authorised redirect URIs' }],
    },
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
    setup: {
      consoleUrl: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade', consoleLabel: 'Entra app registrations',
      steps: [
        'In the Microsoft Entra admin center, open App registrations > New registration.',
        'Name it "SampForce". For "Supported account types" choose accounts in any organisational directory (and personal accounts if you want them), to match the tenant "common".',
        'Under Redirect URI choose the Web platform and paste the redirect URL below, then register.',
        'API permissions > Add a permission > Microsoft Graph > Delegated: offline_access, openid, email, User.Read, Mail.Read, Mail.Send, Calendars.Read.',
        'Certificates & secrets > New client secret. Copy its Value (not the Secret ID) straight away.',
        'Copy the Application (client) ID from Overview, paste both below, save, then press Test connection.',
      ],
      urls: [{ label: 'Redirect URI (Web)', path: '/api/v1/integrations/microsoft/callback', where: 'App registration > Authentication > Web > Redirect URIs' }],
    },
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
    setup: {
      consoleUrl: 'https://api.slack.com/apps', consoleLabel: 'Slack apps',
      steps: [
        'At api.slack.com/apps choose Create New App > From scratch, name it "SampForce" and pick your own Slack workspace to develop in.',
        'OAuth & Permissions > Redirect URLs: add the redirect URL below and save.',
        'OAuth & Permissions > Bot Token Scopes: add chat:write, chat:write.public, channels:read and groups:read.',
        'Manage Distribution: turn on public distribution so other Slack workspaces can install it.',
        'Basic Information > App Credentials: copy the Client ID and Client Secret, paste them below, save, then press Test connection.',
      ],
      urls: [{ label: 'Redirect URL', path: '/api/v1/apps/slack/callback', where: 'OAuth & Permissions > Redirect URLs' }],
    },
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
    setup: {
      consoleUrl: 'https://marketplace.zoom.us/develop/create', consoleLabel: 'Zoom App Marketplace',
      steps: [
        'In the Zoom App Marketplace choose Develop > Build App > General App, and pick "User-managed".',
        'Basic Information > OAuth Information: paste the redirect URL below into "OAuth Redirect URL" and add it to the OAuth allow list too.',
        'Scopes: add the ones to read the connecting user (user:read:user), create meetings (meeting:write:meeting) and read cloud recordings for transcripts (cloud_recording:read:list_recording_files).',
        'App Credentials: copy the Client ID and Client Secret, paste them below, save, then press Test connection.',
        'For transcript import: Features > Access > copy the Secret Token and paste it below as the webhook secret token, and save. Then turn on Event Subscription, paste the event notification URL below, and add the event "Recording > Recording transcript files completed". Zoom checks the URL when you save it; the webhook status here turns green when it does.',
      ],
      urls: [
        { label: 'OAuth redirect URL', path: '/api/v1/apps/zoom/callback', where: 'Basic Information > OAuth Redirect URL, and the OAuth allow list' },
        { label: 'Event notification endpoint URL', path: '/api/v1/apps/zoom/events', where: 'Features > Access > Event Subscription' },
      ],
    },
    webhook: 'zoom',
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
    setup: {
      consoleUrl: 'https://admin.docusign.com/apps-and-keys', consoleLabel: 'DocuSign Apps and Keys',
      steps: [
        'In DocuSign eSignature Admin open Apps and Keys > Add App and Integration Key, name it "SampForce". Use a developer account (account-d) first; production needs DocuSign\'s go-live review.',
        'Choose "Authorization Code Grant" and Add Secret Key. Copy the secret straight away.',
        'Under Additional settings > Redirect URIs, add the redirect URL below and save.',
        'For signing status updates: Settings > Connect > Connect Keys > Add Secret Key, and copy it as the Connect HMAC key. SampForce tells DocuSign where to send updates with each envelope, so no Connect configuration is needed.',
        'Paste the integration key, secret key and HMAC key below. If you use the developer environment, set the account server to https://account-d.docusign.com. Save, then press Test connection.',
      ],
      urls: [
        { label: 'Redirect URI', path: '/api/v1/apps/docusign/callback', where: 'Apps and Keys > your app > Redirect URIs' },
        { label: 'Status updates (sent with each envelope)', path: '/api/v1/apps/docusign/events', where: 'Nothing to paste: shown so your firewall can allow it' },
      ],
    },
    webhook: 'docusign',
  },
  {
    key: 'anthropic', name: 'Anthropic (Claude)', usedFor: 'AI agents, email assistant, proposals, meeting and voice readings',
    fields: [
      { name: 'ANTHROPIC_API_KEY', label: 'API key', required: true, help: 'Claude Console > API keys.' },
      { name: 'AI_MODEL', label: 'Model', required: false, help: 'The Claude model every AI feature uses. Leave it at the default unless Anthropic retires it; the connection test checks the key can use it.' },
    ],
    tested: ['ANTHROPIC_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: { off: 'AI features show as not configured', on: 'AI features available' },
    setup: {
      consoleUrl: 'https://console.anthropic.com/settings/keys', consoleLabel: 'Claude Console API keys',
      steps: [
        'Sign in to the Claude Console with the organisation that should be billed, and add a payment method under Billing.',
        'Settings > API keys > Create key, name it "SampForce".',
        'Copy the key (it is shown once), paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'smtp', name: 'Email (SMTP)', usedFor: 'Password resets, invitations, client portal email',
    fields: [
      { name: 'SMTP_URL', label: 'SMTP URL', required: true, help: 'smtps://user:password@smtp.example.com:465, or smtp://… :587 for STARTTLS.' },
      { name: 'MAIL_FROM', label: 'Sender', required: true, help: 'For example: SampForce <no-reply@example.com>' },
    ],
    tested: ['SMTP_URL'],
    checkNote: 'Connects to the email service and signs in, then disconnects. No email is sent.',
    app: { off: 'System email is not sent', on: 'System email is sent' },
    setup: {
      steps: [
        'Use any email service that offers SMTP (Amazon SES, Postmark, SendGrid, Mailgun, Google Workspace, Microsoft 365).',
        'Create SMTP credentials there and verify the sender domain (SPF and DKIM), so mail is not marked as spam.',
        'Write the SMTP URL as smtps://USER:PASSWORD@HOST:465, or smtp://USER:PASSWORD@HOST:587 for STARTTLS. If the user name or password has @, : or / in it, replace those with %40, %3A and %2F.',
        'Enter the sender, for example SampForce <no-reply@yourdomain.com>, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'zapier', name: 'Zapier', usedFor: 'The SampForce app in Zapier: the invite link shown under Settings > Apps',
    fields: [{ name: 'ZAPIER_INVITE_URL', label: 'Invite link', required: true, help: "Zapier developer platform > your SampForce integration > Sharing. Workspaces sign in with their own SampForce API keys." }],
    tested: ['ZAPIER_INVITE_URL'],
    checkNote: 'Opens the invite link and checks that Zapier answers.',
    app: { off: 'Pending Configuration: no invite link', on: 'Workspace admins see the invite link' },
    setup: {
      consoleUrl: 'https://developer.zapier.com/', consoleLabel: 'Zapier developer platform',
      steps: [
        'Publish the SampForce integration from the integrations/zapier folder to the Zapier developer platform (zapier push).',
        'Open the integration > Manage > Sharing and copy the invite link.',
        'Paste it below, save, then press Test connection. Workspace admins then see the link under Settings > Apps.',
      ],
    },
  },
  {
    key: 'checkout', name: 'Plans and online checkout', usedFor: 'Whether workspaces can pay online, which Stripe or Razorpay price each plan uses, and what the public pricing page shows',
    fields: [
      { name: 'ONLINE_PAYMENTS_ENABLED', label: 'Online payments', required: false, switch: true, help: 'Off: workspaces pay offline against an invoice you mark paid. On: workspaces can check out with Stripe or Razorpay once their keys and prices are set.' },
      { name: 'STRIPE_PRICES', label: 'Stripe price ids', required: false, validate: priceMap, help: 'One per plan and interval, for example launch:MONTH=price_123,launch:YEAR=price_456. Plans without a price cannot be bought with Stripe.' },
      { name: 'STRIPE_AUTOMATIC_TAX', label: 'Stripe automatic tax', required: false, switch: true, help: 'Ask Stripe Tax to add tax at checkout. Turn on only once Stripe Tax is set up on the account.' },
      { name: 'RAZORPAY_PLANS', label: 'Razorpay plan ids', required: false, validate: priceMap, help: 'Same format, for example launch:MONTH=plan_123.' },
      { name: 'PRICING_PUBLISHED', label: 'Pricing published', required: false, switch: true, help: 'Off: the pricing page labels prices a preview. Turn on once the rate card is final.' },
      { name: 'SALES_CONTACT_EMAIL', label: 'Sales contact email', required: false, help: 'Shown for Enterprise Plus and custom quotes. Empty: no contact address is shown.' },
    ],
    tested: [],
    checkNote: 'These are settings, not keys, so there is nothing to test. Changes apply within seconds.',
    app: { off: 'Offline invoices only', on: 'Offline invoices only' },
    setup: {
      steps: [
        'Leave online payments off to keep paying by invoice (the bank details are under Settings).',
        'To sell online: set up Stripe or Razorpay below, enter the price or plan id for each paid plan here, then turn online payments on.',
        'Turn "Pricing published" on when the rate card is final, so the pricing page stops calling prices a preview.',
      ],
    },
  },
  {
    key: 'stripe', name: 'Stripe (subscription billing)', usedFor: 'Online checkout for SampForce plans. Off while ONLINE_PAYMENTS_ENABLED is false (offline invoices)',
    fields: [
      { name: 'STRIPE_SECRET_KEY', label: 'Secret key', required: true, help: 'Stripe Dashboard > Developers > API keys (a restricted key works).' },
      { name: 'STRIPE_WEBHOOK_SECRET', label: 'Webhook signing secret', required: true, help: 'Developers > Webhooks > your endpoint. Proven when Stripe sends its first signed event.' },
    ],
    tested: ['STRIPE_SECRET_KEY'],
    checkNote: 'Reads the account balance. Nothing is charged or created.',
    app: { off: 'Checkout says it is not configured', on: 'Checkout available when online payments are on' },
    setup: {
      consoleUrl: 'https://dashboard.stripe.com/apikeys', consoleLabel: 'Stripe API keys',
      steps: [
        'In the Stripe Dashboard (start in test mode), create a Product for each paid plan with a monthly and a yearly Price. Enter the price ids under "Plans and online checkout".',
        'Developers > API keys: create a restricted key with write access to Checkout Sessions, Customers, Subscriptions and the Customer portal, and read access to Balance and Invoices (or use the secret key).',
        'Developers > Webhooks > Add endpoint: paste the webhook URL below and select checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid and invoice.payment_failed.',
        'Copy the endpoint\'s signing secret (whsec_…), paste both keys below, save, then press Test connection.',
        'Send a test event from Stripe: the webhook status here shows it arrived.',
      ],
      urls: [{ label: 'Webhook endpoint URL', path: '/api/v1/billing/webhooks/stripe', where: 'Developers > Webhooks > Add endpoint' }],
    },
    webhook: 'stripe',
  },
  {
    key: 'razorpay', name: 'Razorpay (subscription billing)', usedFor: 'Online checkout for SampForce plans in India. Off while ONLINE_PAYMENTS_ENABLED is false',
    fields: [
      { name: 'RAZORPAY_KEY_ID', label: 'Key ID', required: true, help: 'Razorpay Dashboard > Account & Settings > API keys.' },
      { name: 'RAZORPAY_KEY_SECRET', label: 'Key secret', required: true },
      { name: 'RAZORPAY_WEBHOOK_SECRET', label: 'Webhook secret', required: true, help: 'Proven when Razorpay sends its first signed event.' },
    ],
    tested: ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'],
    checkNote: 'Lists one subscription plan. Nothing is charged or created.',
    app: { off: 'Checkout says it is not configured', on: 'Checkout available when online payments are on' },
    setup: {
      consoleUrl: 'https://dashboard.razorpay.com/app/keys', consoleLabel: 'Razorpay API keys',
      steps: [
        'In the Razorpay Dashboard (start in test mode), create a Subscription Plan for each paid plan and interval. Enter the plan ids under "Plans and online checkout".',
        'Account & Settings > API keys: generate a key and copy the Key ID and Key Secret.',
        'Account & Settings > Webhooks > Add new webhook: paste the webhook URL below, set a secret of your own, and select subscription.activated, subscription.charged, subscription.pending, subscription.halted, subscription.cancelled and subscription.completed.',
        'Paste the key ID, key secret and the webhook secret below, save, then press Test connection.',
      ],
      urls: [{ label: 'Webhook URL', path: '/api/v1/billing/webhooks/razorpay', where: 'Account & Settings > Webhooks' }],
    },
    webhook: 'razorpay',
  },
];
