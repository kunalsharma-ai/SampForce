import { smtpUrlError } from '../common/smtp-url';
import type { ProviderKey } from '@dealflow/types';
import { parseProviderOrder } from '../ai/ai-providers';
import { parsePriceMap } from '../billing/providers';
import { parseTrustedHosts } from '../common/trusted-targets';
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
  /** Rewrites a valid value into one spelling before it is stored. */
  normalize?: (value: string) => string;
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
  /** AI providers are listed together, and none of them is required on its own (ADR 0067). */
  group?: 'ai';
  usedFor: string;
  fields: CatalogueField[];
  /** The fields the connection test sends (empty: there is nothing to call). Their fingerprint is stored with the result. */
  tested: ManagedKeyName[];
  checkNote: string;
  app: { off: string; on: string; verified?: string };
  /** Step-by-step setup in the provider's own console (ADR 0053). */
  setup: { consoleUrl?: string; consoleLabel?: string; steps: string[]; urls?: CatalogueUrl[] };
  /** When "required" alone cannot say it: whether the provider has what it needs (for example SMTP server or URL). */
  configured?: (env: Record<string, unknown>) => boolean;
  /** Set for providers that send signed webhooks: the console shows whether a signed event has arrived. */
  webhook?: ReceiptProvider;
}

const trustedHostsError = (v: string) => {
  try {
    parseTrustedHosts(v);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Not a valid list.';
  }
};

const providerOrderError = (v: string) => {
  try {
    parseProviderOrder(v);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Not a valid order.';
  }
};

/** What workspaces see for one AI provider; the routing card works out the real line from the order (ADR 0067). */
const AI_APP = { off: 'Not used: no key', on: 'Used for AI features in the order set under "AI providers and fallback order"' };

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
    key: 'ai_routing', name: 'AI providers and fallback order', group: 'ai',
    usedFor: 'Which AI providers SampForce uses, and the order it tries them in. When one is rate limited, out of free quota or failing, the next one answers straight away',
    fields: [
      { name: 'AI_PROVIDER_ORDER', label: 'Order', required: false, validate: providerOrderError, normalize: (v) => parseProviderOrder(v).join(','), help: 'Provider keys separated by commas, first tried first, for example groq,gemini,anthropic. A provider left out is switched off. Empty: every provider with keys, in the order listed on this page.' },
    ],
    tested: [],
    checkNote: 'This is a setting, not a key, so there is nothing to test. Each provider below has its own test.',
    app: { off: '', on: '' },
    setup: {
      steps: [
        'Add keys for one or more AI providers below. Free keys work: Google Gemini, Groq, Mistral and OpenRouter all offer free tiers, and a self-hosted Ollama server costs nothing per call.',
        'Put the provider you want answering most of the time first. Free tiers have low limits per minute and per day, so add two or three providers: when the first one is busy SampForce moves on to the next and rests the busy one for a minute.',
        'Copilot looks up CRM records with tools, so every model in the list must support tool calling (function calling). The suggested models do.',
      ],
    },
  },
  {
    key: 'anthropic', name: 'Anthropic (Claude)', group: 'ai', usedFor: 'AI agents, email assistant, proposals, meeting and voice readings',
    fields: [
      { name: 'ANTHROPIC_API_KEY', label: 'API key', required: true, help: 'Claude Console > API keys.' },
      { name: 'AI_MODEL', label: 'Model', required: false, help: 'The Claude model every AI feature uses. Leave it at the default unless Anthropic retires it; the connection test checks the key can use it.' },
    ],
    tested: ['ANTHROPIC_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: AI_APP,
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
    key: 'openai', name: 'OpenAI', group: 'ai', usedFor: 'AI features, as the main AI provider or a fallback',
    fields: [
      { name: 'OPENAI_API_KEY', label: 'API key', required: true, help: 'platform.openai.com > API keys.' },
      { name: 'OPENAI_MODEL', label: 'Model', required: false, help: 'Default gpt-5-mini. Any chat model that supports function calling works.' },
    ],
    tested: ['OPENAI_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: AI_APP,
    setup: {
      consoleUrl: 'https://platform.openai.com/api-keys', consoleLabel: 'OpenAI API keys',
      steps: [
        'Sign in to the OpenAI platform and add credit under Billing (the OpenAI API has no free tier).',
        'API keys > Create new secret key, name it "SampForce", and copy it.',
        'Paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'gemini', name: 'Google Gemini', group: 'ai', usedFor: 'AI features, as the main AI provider or a fallback. Has a free tier',
    fields: [
      { name: 'GEMINI_API_KEY', label: 'API key', required: true, help: 'Google AI Studio > Get API key.' },
      { name: 'GEMINI_MODEL', label: 'Model', required: false, help: 'Default gemini-2.5-flash, which the free tier includes.' },
    ],
    tested: ['GEMINI_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: AI_APP,
    setup: {
      consoleUrl: 'https://aistudio.google.com/apikey', consoleLabel: 'Google AI Studio API keys',
      steps: [
        'Sign in to Google AI Studio with a Google account and choose "Create API key".',
        'The free tier needs no billing account. It allows a limited number of requests per minute and per day; add billing in Google Cloud for higher limits.',
        'Copy the key, paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'groq', name: 'Groq', group: 'ai', usedFor: 'AI features, as the main AI provider or a fallback. Has a free tier',
    fields: [
      { name: 'GROQ_API_KEY', label: 'API key', required: true, help: 'console.groq.com > API Keys.' },
      { name: 'GROQ_MODEL', label: 'Model', required: false, help: 'Default llama-3.3-70b-versatile. Pick a model that supports tool use.' },
    ],
    tested: ['GROQ_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: AI_APP,
    setup: {
      consoleUrl: 'https://console.groq.com/keys', consoleLabel: 'GroqCloud API keys',
      steps: [
        'Sign up at console.groq.com. The free plan needs no card; its limits per minute and per day are shown under Settings > Limits.',
        'API Keys > Create API Key, name it "SampForce", and copy it.',
        'Paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'openrouter', name: 'OpenRouter', group: 'ai', usedFor: 'AI features through one key for hundreds of models, including free ones',
    fields: [
      { name: 'OPENROUTER_API_KEY', label: 'API key', required: true, help: 'openrouter.ai > Settings > API Keys.' },
      { name: 'OPENROUTER_MODEL', label: 'Model', required: false, help: 'Default meta-llama/llama-3.3-70b-instruct:free. Models ending in :free cost nothing; choose one that supports tools.' },
    ],
    tested: ['OPENROUTER_API_KEY'],
    checkNote: "Reads the key's own details (credit and free-tier status). No message is sent, so no tokens are used.",
    app: AI_APP,
    setup: {
      consoleUrl: 'https://openrouter.ai/settings/keys', consoleLabel: 'OpenRouter API keys',
      steps: [
        'Sign up at openrouter.ai and open Settings > API Keys > Create Key, named "SampForce".',
        'Free models (their names end in :free) have a daily request limit, which is higher once the account has bought some credit.',
        'Copy the key, paste it below, choose a model on openrouter.ai/models if you want another one, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'mistral', name: 'Mistral', group: 'ai', usedFor: 'AI features, as the main AI provider or a fallback. Has a free plan',
    fields: [
      { name: 'MISTRAL_API_KEY', label: 'API key', required: true, help: 'console.mistral.ai > API Keys.' },
      { name: 'MISTRAL_MODEL', label: 'Model', required: false, help: 'Default mistral-small-latest.' },
    ],
    tested: ['MISTRAL_API_KEY'],
    checkNote: 'Lists the models the key may use. No message is sent, so no tokens are used.',
    app: AI_APP,
    setup: {
      consoleUrl: 'https://console.mistral.ai/api-keys', consoleLabel: 'Mistral API keys',
      steps: [
        'Sign in to the Mistral console and choose the free "Experiment" plan (or a paid plan) under Billing.',
        'API Keys > Create new key, name it "SampForce", and copy it.',
        'Paste it below, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'custom_ai', name: 'Self-hosted or other AI (OpenAI-compatible)', group: 'ai', usedFor: 'AI features from your own server (Ollama, LM Studio, vLLM, LiteLLM) or any provider with an OpenAI-compatible API (DeepSeek, Together, Fireworks…)',
    fields: [
      { name: 'CUSTOM_AI_BASE_URL', label: 'API address', required: true, help: 'The address that ends before /chat/completions: http://host.docker.internal:11434/v1 for Ollama on this server, http://ollama:11434/v1 for an Ollama container next to SampForce, an IPv4 address or host name for another machine, or https://api.deepseek.com/v1. IPv6 addresses need IPv6 turned on for the containers (docker-compose.ipv6.yml).' },
      { name: 'CUSTOM_AI_MODEL', label: 'Model', required: true, help: 'The model name the server knows, for example llama3.1 or qwen2.5 for Ollama. It must support tool calling for Copilot.' },
      { name: 'CUSTOM_AI_API_KEY', label: 'API key', required: false, help: 'Leave empty for a local server that needs no key.' },
    ],
    tested: ['CUSTOM_AI_BASE_URL', 'CUSTOM_AI_API_KEY'],
    checkNote: 'Lists the models the server offers and checks the model is one of them. No message is sent.',
    app: AI_APP,
    setup: {
      consoleUrl: 'https://ollama.com/download', consoleLabel: 'Ollama downloads',
      steps: [
        'For Ollama: install it on a machine the SampForce server can reach, then run "ollama pull llama3.1" (or another model with tool support).',
        'Make Ollama listen beyond localhost (OLLAMA_HOST=0.0.0.0) if it runs outside the SampForce containers, and keep that port closed to the internet.',
        'Enter the address with /v1 at the end and the model name. On the SampForce server itself use http://host.docker.internal:11434/v1, never localhost (inside a container that is the container). For another machine use its IPv4 address or a host name; an IPv6-only address needs IPv6 turned on for the containers (see SERVER_SETUP.md, Troubleshooting). A local server needs no API key.',
        'For a hosted OpenAI-compatible provider, enter its API address, model name and key instead. Save, then press Test connection.',
      ],
    },
  },
  {
    key: 'smtp', name: 'Email (SMTP)', usedFor: 'Password resets, invitations, client portal email',
    fields: [
      { name: 'SMTP_HOST', label: 'SMTP server', required: false, help: 'For example smtppro.zoho.in, smtp.gmail.com or email-smtp.eu-west-1.amazonaws.com.' },
      { name: 'SMTP_PORT', label: 'Port', required: false, validate: (v) => (/^\d{1,5}$/.test(v) && +v >= 1 && +v <= 65535 ? null : 'Enter a port number such as 465 or 587.'), help: '465 for SSL/TLS, 587 (or 2525) for STARTTLS. Empty: 465.' },
      { name: 'SMTP_SECURE', label: 'SSL/TLS (port 465)', required: false, switch: true, help: 'On for port 465 (secure: true). Off for 587 or 2525, where the connection is upgraded with STARTTLS. Unset: on only for port 465.' },
      { name: 'SMTP_USER', label: 'User name', required: false, help: 'Usually the full email address, for example sales@yourcompany.com.' },
      { name: 'SMTP_PASSWORD', label: 'Password', required: false, help: 'For Zoho, Gmail or Microsoft 365 with two-step sign-in, an app-specific password.' },
      { name: 'MAIL_FROM', label: 'Sender', required: true, help: 'For example: SampForce <no-reply@example.com>. Zoho and most services only accept the signed-in address (or its aliases) here.' },
      { name: 'SMTP_URL', label: 'SMTP URL (older setups)', required: false, validate: smtpUrlError, normalize: (v) => v.trim(), help: 'Only used when SMTP server is empty: smtps://user:password@smtp.example.com:465, or smtp://… :587 for STARTTLS.' },
    ],
    configured: (env) => !!(env.SMTP_HOST || env.SMTP_URL) && !!env.MAIL_FROM,
    tested: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_URL'],
    checkNote: 'Connects to the email service and signs in, then disconnects. No email is sent.',
    app: { off: 'System email is not sent', on: 'System email is sent' },
    setup: {
      steps: [
        'Use any email service that offers SMTP (Zoho Mail, Google Workspace, Microsoft 365, Amazon SES, Postmark, SendGrid, Mailgun).',
        'Create SMTP credentials there (an app-specific password if the account has two-step sign-in) and verify the sender domain (SPF and DKIM), so mail is not marked as spam.',
        'Enter the SMTP server, the port (465 with SSL/TLS on, or 587 with it off), the user name and the password. These are the same settings as Nodemailer\'s host, port, secure and auth.',
        'Enter the sender, for example SampForce <no-reply@yourdomain.com>, save, then press Test connection.',
      ],
    },
  },
  {
    key: 'workspace_servers', name: 'Workspace servers', usedFor: "Private or internal servers that workspaces may use as their own AI server, email server or SampBidx. Public servers need no approval",
    fields: [
      { name: 'TRUSTED_PRIVATE_HOSTS', label: 'Approved private hosts', required: false, validate: trustedHostsError, help: 'Host names, addresses or ranges, separated by commas, for example ollama.lan, 10.0.0.0/8, 2406:b400::/32. Empty: workspaces can only use public servers.' },
    ],
    tested: [],
    checkNote: 'This is a setting, not a key, so there is nothing to test. Workspace admins test their own servers under Integrations.',
    app: { off: 'Workspaces can connect their own AI and email servers and SampBidx on public addresses only', on: 'Workspaces can also use the approved private hosts' },
    setup: {
      steps: [
        'Workspace admins can add their own AI keys, their own AI server and their own email server under Integrations > Your own servers. Public servers work straight away.',
        'A private or internal address (10.x, 172.16-31.x, 192.168.x, a private IPv6 range, localhost) is refused unless you list it here, because otherwise any workspace admin could make SampForce reach into this server\'s own network.',
        'Approve only servers you run or trust, for example your own Ollama machine. Do not approve 169.254.169.254 (the cloud metadata service) or the database\'s address.',
      ],
    },
  },
  {
    key: 'company_autofill', name: 'Company auto-fill', usedFor: "Filling in missing company details from the company's own website and from Wikidata",
    fields: [
      { name: 'COMPANY_AUTOFILL_WIKIDATA', label: 'Also read Wikidata', required: false, switch: true, help: 'On (or unset): founded year, head count, industry, head office, founders and CEO of larger companies come from Wikidata too. Off: only the companies\' own websites are read.' },
    ],
    tested: [],
    checkNote: 'This is a setting, not a key, so there is nothing to test. Auto-fill needs no key: it reads public pages only.',
    app: { off: 'Reads company websites only', on: 'Reads company websites and Wikidata' },
    setup: {
      steps: [
        'Auto-fill runs when a company is created or imported, and when someone presses Enrich on a company. It only fills empty fields and keeps the source of every value; people can undo any of it.',
        'It reads the company\'s own website (home, About and Contact pages) and, with this switch on, Wikidata. It never reads LinkedIn or other sites that forbid it.',
        'The server needs outbound https to the company websites, and to www.wikidata.org while this switch is on.',
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
    key: 'expo_push', name: 'Phone notifications (Expo)', usedFor: 'Push notifications to the SampForce iPhone and Android app (ADR 0072)',
    fields: [{ name: 'EXPO_ACCESS_TOKEN', label: 'Expo access token', required: false, help: 'Only needed when "Enhanced push security" is on in the Expo project. Without it, notifications are still sent.' }],
    tested: [],
    checkNote: 'Notifications go through Expo to Apple and Google with the credentials kept in the Expo project, so there is nothing to test here. Send yourself an announcement to check.',
    app: { off: 'Phone notifications are sent', on: 'Phone notifications are sent with the access token' },
    setup: {
      consoleUrl: 'https://expo.dev/', consoleLabel: 'Expo',
      steps: [
        'In the Expo project of the SampForce app, upload the Apple push key (APNs .p8) and the Firebase (FCM v1) service account under Credentials.',
        'Optional: turn on Enhanced push security, create an access token under Account settings > Access tokens, and paste it below.',
        'Phones turn notifications on from Profile in the app; the Mobile Configuration chooses which ones each level gets.',
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
