import { z } from 'zod';
import type { CompanyLogoRef, PersonRef } from './crm';

/*
 * Calls (ADR 0088) and the universal dialer (ADR 0101).
 *
 * A salesperson dials any company or employee through a dialer of their own. Every dialer goes through one SampForce
 * calling interface (an adapter per kind on the server), so changing phone provider never changes the Calls section:
 * - LINK opens a link on this device: tel:, callto:, sip:, an app's own scheme or a web dialer, with the call's details.
 * - API asks a cloud phone system (Exotel, Knowlarity, Aircall, RingCentral or any other with a click-to-call API) to
 *   place the call, with an HTTP request built from the dialer's settings. The provider sends status, talk time and
 *   recordings back to the dialer's events address.
 * - TWILIO calls through the workspace's Twilio number, ringing the caller's own phone first.
 * - SIP registers this browser with a SIP server over WebRTC, so the call runs in the browser with mute, hold,
 *   keypad tones and transfer (part 2).
 * - SIM asks the SampForce phone app on the caller's linked phone to dial on its SIM (part 2).
 * Each kind says what it can do; the page shows what is and is not available rather than pretending.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().or(z.literal('').transform(() => null));
const uuidRef = z.string().uuid().nullable().optional();
const isoDateTime = z.string().datetime({ offset: true });
const optionalDateTime = isoDateTime.nullable().optional().or(z.literal('').transform(() => null));

// ───────────── Dialers ─────────────

export const DIALER_KINDS = ['LINK', 'API', 'TWILIO', 'SIP', 'SIM'] as const;
export type DialerKind = (typeof DIALER_KINDS)[number];

/** The details a dialer receives, as {placeholders} in its link or request and as fields in its webhook. */
export const DIALER_PLACEHOLDERS = {
  phone: 'The number being called, as written',
  phoneE164: 'The number in international form (+447700900123)',
  phoneDigits: 'Only the digits of the number',
  phoneNational: 'The number without its country code',
  companyName: 'Company name',
  companyPhone: 'Company phone',
  employeeName: 'Employee name',
  designation: 'Employee designation',
  email: 'Employee email',
  employeePhone: 'Employee phone',
  callId: 'SampForce call id',
  companyUrl: 'Link to the company in SampForce',
  agentPhone: 'Your own phone or extension',
  extension: 'Your extension',
  callerId: 'The caller id chosen for the call',
  account: 'Your account id with the provider',
  callerName: 'Your name',
  callerEmail: 'Your email',
  eventsUrl: 'Where the provider sends the call status and recording back',
  providerCallId: 'The provider’s id for the call (for ending it)',
} as const;
export type DialerPlaceholder = keyof typeof DIALER_PLACEHOLDERS;

export const DIALER_CATEGORIES = ['DEVICE', 'SOFTPHONE', 'BROWSER', 'CLOUD', 'SIM', 'CUSTOM'] as const;
export type DialerCategory = (typeof DIALER_CATEGORIES)[number];
export const DIALER_CATEGORY_LABELS: Record<DialerCategory, string> = {
  DEVICE: 'This device',
  SOFTPHONE: 'Softphones and desktop apps',
  BROWSER: 'Calls in the browser',
  CLOUD: 'Cloud phone systems',
  SIM: 'My mobile SIM',
  CUSTOM: 'Any other dialer',
};

/** What a dialer can do. The page shows each one as available or not, per dialer. */
export const DIALER_CAPABILITIES = {
  placeCalls: 'Places calls',
  opensApp: 'Opens an app on this device',
  sendsDetails: 'Receives the company and employee details',
  endCalls: 'Ends the call from SampForce',
  statusBack: 'Ringing, answered and talk time come back',
  recordings: 'Recordings come back',
  incoming: 'Incoming calls',
  mute: 'Mute',
  hold: 'Hold',
  dtmf: 'Keypad tones during the call',
  transfer: 'Transfer',
  conference: 'Conference calls',
  callerIdChoice: 'Choose the caller id',
  historySync: 'Call history sync',
  sim: 'Calls from my own mobile number',
} as const;
export type DialerCapability = keyof typeof DIALER_CAPABILITIES;
export type DialerCapabilities = Record<DialerCapability, boolean>;

const NONE: DialerCapabilities = { placeCalls: true, opensApp: false, sendsDetails: false, endCalls: false, statusBack: false, recordings: false, incoming: false, mute: false, hold: false, dtmf: false, transfer: false, conference: false, callerIdChoice: false, historySync: false, sim: false };
const caps = (on: Partial<DialerCapabilities>): DialerCapabilities => ({ ...NONE, ...on });

export const DIALER_AUTHS = ['NONE', 'BASIC', 'BEARER', 'HEADER', 'OAUTH2'] as const;
export type DialerAuth = (typeof DIALER_AUTHS)[number];
export const DIALER_AUTH_LABELS: Record<DialerAuth, string> = {
  NONE: 'No sign-in',
  BASIC: 'User name and password (Basic)',
  BEARER: 'Access token (Bearer)',
  HEADER: 'API key in a header',
  OAUTH2: 'Client id and secret (OAuth 2)',
};

/** The secret settings: sealed on the server, never sent back, only "saved" or not. */
export const DIALER_SECRETS = ['apiSecret', 'clientSecret', 'accessToken', 'refreshToken', 'sipPassword'] as const;
export type DialerSecret = (typeof DIALER_SECRETS)[number];

/** Every setting a dialer may have. A provider shows only the ones it uses. */
export type DialerFieldKey =
  | 'website'
  | 'urlTemplate'
  | 'apiBaseUrl'
  | 'callPath'
  | 'hangupPath'
  | 'testPath'
  | 'apiMethod'
  | 'apiContentType'
  | 'apiBody'
  | 'responseCallIdPath'
  | 'apiAuth'
  | 'apiUser'
  | 'apiSecret'
  | 'apiHeaderName'
  | 'clientId'
  | 'clientSecret'
  | 'tokenUrl'
  | 'accessToken'
  | 'refreshToken'
  | 'account'
  | 'sipServer'
  | 'sipDomain'
  | 'sipPort'
  | 'sipUsername'
  | 'sipPassword'
  | 'extension'
  | 'agentPhone'
  | 'callerIds'
  | 'registeredNumber'
  | 'defaultCountryCode'
  | 'regions'
  | 'allowOutgoing'
  | 'allowIncoming'
  | 'recording'
  | 'historySync'
  | 'customParams'
  | 'webhookUrl'
  | 'deviceId';

export interface DialerProvider {
  key: string;
  name: string;
  category: DialerCategory;
  kind: DialerKind;
  description: string;
  website: string | null;
  /** Two letters and a colour for its badge. */
  mark: string;
  color: string;
  capabilities: DialerCapabilities;
  /** The settings shown, in order. */
  fields: DialerFieldKey[];
  /** Labels that differ for this provider (for example what "account" means). */
  labels?: Partial<Record<DialerFieldKey, string>>;
  /** Values filled in when it is picked. */
  preset: Partial<DialerConfig>;
  /** Where to find the keys, in the provider's own words. */
  setupHelp?: string;
}

const API_COMMON: DialerFieldKey[] = ['apiBaseUrl', 'callPath', 'hangupPath', 'testPath', 'apiMethod', 'apiContentType', 'apiBody', 'responseCallIdPath'];
const CLOUD_TAIL: DialerFieldKey[] = ['callerIds', 'defaultCountryCode', 'regions', 'allowOutgoing', 'allowIncoming', 'recording', 'historySync', 'customParams'];
const linkFields: DialerFieldKey[] = ['urlTemplate', 'defaultCountryCode', 'webhookUrl'];
const linkCaps = caps({ opensApp: true });

/**
 * Every dialer SampForce works with. "Any cloud dialer (API)", "Browser SIP phone" and "My own link" take any provider
 * that has a click-to-call API, a SIP server or a link, so a new provider needs settings, not code.
 */
export const DIALER_PROVIDERS: readonly DialerProvider[] = [
  { key: 'phone', name: 'Phone app', category: 'DEVICE', kind: 'LINK', website: null, mark: 'Ph', color: '#059669', description: 'The phone app on this device, or the app it has for phone links (Phone Link, FaceTime, your softphone).', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'tel:{phoneE164}' } },
  { key: 'facetime', name: 'FaceTime audio', category: 'DEVICE', kind: 'LINK', website: 'https://support.apple.com/facetime', mark: 'Ft', color: '#16a34a', description: 'Calls from a Mac or iPad through FaceTime and your iPhone’s line.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'facetime-audio:{phoneE164}' } },
  { key: 'callto', name: 'Skype or callto: softphone', category: 'SOFTPHONE', kind: 'LINK', website: null, mark: 'Sk', color: '#0284c7', description: 'Softphones that answer callto: links, such as Skype, Zoiper or MicroSIP.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'callto:{phoneE164}' } },
  { key: 'teams', name: 'Microsoft Teams Phone', category: 'SOFTPHONE', kind: 'LINK', website: 'https://www.microsoft.com/microsoft-teams/microsoft-teams-phone', mark: 'Te', color: '#4f46e5', description: 'Opens Teams and calls the number, when your Teams account has a phone plan.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'https://teams.microsoft.com/l/call/0/0?users=4:{phoneE164}' } },
  { key: 'zoom', name: 'Zoom Phone', category: 'SOFTPHONE', kind: 'LINK', website: 'https://www.zoom.com/en/products/voip-phone/', mark: 'Zo', color: '#2563eb', description: 'Opens the Zoom app and calls with your Zoom Phone number.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'zoomphonecall://{phoneE164}' } },
  { key: 'dialpad', name: 'Dialpad', category: 'SOFTPHONE', kind: 'LINK', website: 'https://www.dialpad.com', mark: 'Dp', color: '#7c3aed', description: 'Opens the Dialpad app and calls the number.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'dialpad://{phoneE164}' } },
  { key: 'sip-link', name: 'SIP softphone or desk phone', category: 'SOFTPHONE', kind: 'LINK', website: null, mark: 'Si', color: '#0e7490', description: 'Zoiper, MicroSIP, Linphone, Bria or a desk phone app that answers sip: links. Add your PBX after @ if it needs one.', capabilities: linkCaps, fields: linkFields, preset: { urlTemplate: 'sip:{phoneE164}' } },
  {
    key: 'sip-browser', name: 'Browser SIP phone (WebRTC)', category: 'BROWSER', kind: 'SIP', website: null, mark: 'Wr', color: '#0891b2',
    description: 'This browser signs in to your SIP server (Asterisk, FreePBX, 3CX, FreeSWITCH, Kamailio or a SIP trunk with WebSocket) and the call runs here, with mute, hold, keypad tones and transfer.',
    capabilities: caps({ sendsDetails: false, endCalls: true, statusBack: true, incoming: true, mute: true, hold: true, dtmf: true, transfer: true, callerIdChoice: false }),
    fields: ['sipServer', 'sipDomain', 'sipPort', 'sipUsername', 'sipPassword', 'extension', 'callerIds', 'defaultCountryCode', 'allowOutgoing', 'allowIncoming', 'recording'],
    labels: { sipServer: 'WebSocket address (wss://)' },
    setupHelp: 'Your PBX needs WebRTC turned on (a wss:// address and a user with DTLS-SRTP). Ask whoever runs your phone system for the address, extension and password.',
    preset: { sipPort: 8089 },
  },
  {
    key: 'twilio', name: 'Twilio', category: 'CLOUD', kind: 'TWILIO', website: 'https://www.twilio.com/voice', mark: 'Tw', color: '#dc2626',
    description: 'Twilio rings your phone first, then connects the call from the workspace’s Twilio number. Status, talk time and recordings come back by themselves.',
    capabilities: caps({ sendsDetails: true, endCalls: true, statusBack: true, recordings: true }),
    fields: ['agentPhone', 'defaultCountryCode', 'recording'], preset: {},
  },
  {
    key: 'exotel', name: 'Exotel', category: 'CLOUD', kind: 'API', website: 'https://exotel.com', mark: 'Ex', color: '#ea580c', description: 'Exotel rings your phone, then connects the customer from your ExoPhone. Status and recordings come back to SampForce.',
    capabilities: caps({ sendsDetails: true, statusBack: true, recordings: true, callerIdChoice: true, historySync: true }),
    fields: ['account', 'apiUser', 'apiSecret', 'agentPhone', ...API_COMMON, ...CLOUD_TAIL],
    labels: { account: 'Account SID', apiUser: 'API key', apiSecret: 'API token', callerIds: 'ExoPhones (caller ids)', agentPhone: 'Your phone' },
    setupHelp: 'Exotel dashboard › Settings › API: copy the Account SID, API key and API token. India accounts use api.in.exotel.com, Singapore accounts api.exotel.com.',
    preset: { apiBaseUrl: 'https://api.in.exotel.com', callPath: '/v1/Accounts/{account}/Calls/connect.json', testPath: '/v1/Accounts/{account}.json', apiMethod: 'POST', apiContentType: 'FORM', apiAuth: 'BASIC', apiBody: 'From={agentPhone}&To={phoneE164}&CallerId={callerId}&CustomField={callId}&StatusCallback={eventsUrl}&Record={recordFlag}', responseCallIdPath: 'Call.Sid', defaultCountryCode: '+91', regions: ['IN'] },
  },
  {
    key: 'knowlarity', name: 'Knowlarity', category: 'CLOUD', kind: 'API', website: 'https://www.knowlarity.com', mark: 'Kn', color: '#0f766e', description: 'Knowlarity calls your agent number, then the customer, from your Knowlarity number.',
    capabilities: caps({ sendsDetails: true, statusBack: true, recordings: true, callerIdChoice: true }),
    fields: ['apiSecret', 'apiHeaderName', 'apiUser', 'agentPhone', ...API_COMMON, ...CLOUD_TAIL],
    labels: { apiSecret: 'API key (x-api-key)', apiUser: 'Authorization key', callerIds: 'Your Knowlarity numbers (k_number)', agentPhone: 'Your agent number' },
    setupHelp: 'Knowlarity portal › Settings › API: copy the API key and the authorization key. Set the call status webhook in the portal to the events address shown here.',
    preset: { apiBaseUrl: 'https://kpi.knowlarity.com', callPath: '/Basic/v1/account/call/makecall', apiMethod: 'POST', apiContentType: 'JSON', apiAuth: 'HEADER', apiHeaderName: 'x-api-key', apiBody: '{"k_number":"{callerId}","agent_number":"{agentPhone}","customer_number":"{phoneE164}","caller_id":"{callerId}","additional_params":{"callId":"{callId}"}}', responseCallIdPath: 'success.call_id', defaultCountryCode: '+91', regions: ['IN'] },
  },
  {
    key: 'aircall', name: 'Aircall', category: 'CLOUD', kind: 'API', website: 'https://aircall.io', mark: 'Ai', color: '#059669', description: 'Starts the call in your Aircall app, so it rings out from your Aircall number. Add the events address as an Aircall webhook for status and recordings.',
    capabilities: caps({ sendsDetails: false, statusBack: true, recordings: true, incoming: true, historySync: true }),
    fields: ['apiUser', 'apiSecret', 'account', ...API_COMMON, ...CLOUD_TAIL],
    labels: { apiUser: 'API ID', apiSecret: 'API token', account: 'Your Aircall user id' },
    setupHelp: 'Aircall dashboard › Integrations & API › API keys: create a key. Your user id is in the address of your user page.',
    preset: { apiBaseUrl: 'https://api.aircall.io', callPath: '/v1/users/{account}/dial', testPath: '/v1/ping', apiMethod: 'POST', apiContentType: 'JSON', apiAuth: 'BASIC', apiBody: '{"to":"{phoneE164}"}' },
  },
  {
    key: 'ringcentral', name: 'RingCentral RingOut', category: 'CLOUD', kind: 'API', website: 'https://www.ringcentral.com', mark: 'Rc', color: '#d97706', description: 'RingCentral rings your phone, then connects the call from your RingCentral number.',
    capabilities: caps({ sendsDetails: false, endCalls: true, statusBack: false, callerIdChoice: true }),
    fields: ['apiAuth', 'accessToken', 'clientId', 'clientSecret', 'tokenUrl', 'agentPhone', ...API_COMMON, ...CLOUD_TAIL],
    labels: { accessToken: 'Personal access token', callerIds: 'Caller ids (your RingCentral numbers)', agentPhone: 'Your phone' },
    setupHelp: 'RingCentral developer console: create an app with the RingOut permission, then either paste a personal access token, or the app’s client id and secret.',
    preset: { apiBaseUrl: 'https://platform.ringcentral.com', callPath: '/restapi/v1.0/account/~/extension/~/ring-out', hangupPath: '/restapi/v1.0/account/~/extension/~/ring-out/{providerCallId}', testPath: '/restapi/v1.0/account/~/extension/~', apiMethod: 'POST', apiContentType: 'JSON', apiAuth: 'BEARER', apiBody: '{"from":{"phoneNumber":"{agentPhone}"},"to":{"phoneNumber":"{phoneE164}"},"callerId":{"phoneNumber":"{callerId}"},"playPrompt":false}', responseCallIdPath: 'id', tokenUrl: 'https://platform.ringcentral.com/restapi/oauth/token' },
  },
  {
    key: 'api', name: 'Any cloud dialer (API)', category: 'CUSTOM', kind: 'API', website: null, mark: 'Ap', color: '#7c3aed', description: 'Any phone system with a click-to-call API: set the address, keys and the request it expects, with the call details as {placeholders}.',
    capabilities: caps({ sendsDetails: true, endCalls: true, statusBack: true, recordings: true, incoming: true, callerIdChoice: true, historySync: true }),
    fields: ['website', 'apiAuth', 'apiUser', 'apiSecret', 'apiHeaderName', 'clientId', 'clientSecret', 'tokenUrl', 'accessToken', 'refreshToken', 'account', 'agentPhone', 'extension', ...API_COMMON, ...CLOUD_TAIL],
    preset: { apiBaseUrl: 'https://', callPath: '/calls', apiMethod: 'POST', apiContentType: 'JSON', apiAuth: 'BEARER', apiBody: '{"from":"{agentPhone}","to":"{phoneE164}","callerId":"{callerId}","reference":"{callId}","statusCallback":"{eventsUrl}"}', responseCallIdPath: 'id' },
  },
  { key: 'custom', name: 'My own link', category: 'CUSTOM', kind: 'LINK', website: null, mark: 'Li', color: '#db2777', description: 'Any dialer that opens from a link: put the call details into the address with {placeholders}. A webhook can receive them too.', capabilities: caps({ opensApp: true, sendsDetails: true }), fields: ['website', 'urlTemplate', 'defaultCountryCode', 'webhookUrl'], preset: { urlTemplate: 'https://dialer.example.com/call?number={phoneE164}&name={employeeName}&company={companyName}' } },
  {
    key: 'sim', name: 'My mobile SIM', category: 'SIM', kind: 'SIM', website: null, mark: 'Sm', color: '#0d9488',
    description: 'The SampForce app on your phone dials on its SIM, from your own number. Android phones send the talk time back from the call log.',
    capabilities: caps({ sendsDetails: true, statusBack: true, historySync: true, sim: true, incoming: true }),
    fields: ['deviceId', 'registeredNumber', 'defaultCountryCode', 'allowIncoming', 'historySync'], preset: { historySync: true },
  },
];

export function dialerProvider(key: string | null | undefined): DialerProvider | undefined {
  return DIALER_PROVIDERS.find((p) => p.key === key);
}

/** The provider a saved dialer came from, or the closest one by kind for dialers saved before providers existed. */
export function providerOf(d: { provider?: string | null; kind: string }): DialerProvider {
  return dialerProvider(d.provider) ?? dialerProvider(d.kind === 'LINK' ? 'custom' : d.kind === 'TWILIO' ? 'twilio' : d.kind === 'SIM' ? 'sim' : d.kind === 'SIP' ? 'sip-browser' : 'api')!;
}

/** Kept for links saved before the provider list (ADR 0088). */
export const DIALER_PRESETS = [
  { key: 'phone', name: 'Phone app', urlTemplate: 'tel:{phoneE164}', description: 'The phone app on this device, or the app it has for phone links (FaceTime, Phone Link, your softphone).' },
  { key: 'callto', name: 'Softphone (callto:)', urlTemplate: 'callto:{phoneE164}', description: 'Softphones that answer callto: links, such as Skype, Zoiper or MicroSIP.' },
  { key: 'sip', name: 'SIP softphone (sip:)', urlTemplate: 'sip:{phoneE164}', description: 'A SIP softphone or desk phone app that answers sip: links.' },
  { key: 'custom', name: 'My dialer (custom link)', urlTemplate: 'https://dialer.example.com/call?number={phoneE164}&name={employeeName}&company={companyName}', description: 'Any dialer that opens from a link: put the call details into the address with {placeholders}.' },
] as const;

/** Link schemes a dialer may not use: they would run code or read files instead of placing a call. */
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'filesystem']);
const NUMBER_PLACEHOLDER = /\{(phone|phoneE164|phoneDigits|phoneNational)\}/;
/** Extra placeholders a template may use: Exotel's Record=true|false comes from the recording setting. */
const DERIVED = new Set(['recordFlag']);

function unknownPlaceholder(t: string, custom: string[] = []): string | null {
  const unknown = [...t.matchAll(/\{(\w+)\}/g)].map((x) => x[1]!).filter((p) => !(p in DIALER_PLACEHOLDERS) && !DERIVED.has(p) && !custom.includes(p));
  return unknown.length ? `Unknown placeholder {${unknown[0]}}.` : null;
}

export function dialerTemplateProblem(t: string, custom: string[] = []): string | null {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(t.trim());
  if (!m) return 'Start the link with its scheme, for example tel:, callto:, sip: or https://';
  if (BLOCKED_SCHEMES.has(m[1]!.toLowerCase())) return 'This kind of link cannot place a call.';
  if (!NUMBER_PLACEHOLDER.test(t)) return 'Put {phoneE164}, {phone} or {phoneDigits} where the number goes.';
  return unknownPlaceholder(t, custom);
}

/** A cloud dialer's request: an https address, and the number somewhere in the path or the body. */
export function dialerApiProblem(c: { apiBaseUrl?: string | null; callPath?: string | null; apiBody?: string | null; hangupPath?: string | null; testPath?: string | null }, custom: string[] = []): { field: DialerFieldKey; message: string } | null {
  if (!c.apiBaseUrl || !/^https?:\/\/[^\s/{}]+[^\s]*$/i.test(c.apiBaseUrl.trim())) return { field: 'apiBaseUrl', message: 'The API address starts with https://' };
  if (!c.callPath) return { field: 'callPath', message: 'Enter the path that places a call' };
  if (!NUMBER_PLACEHOLDER.test(`${c.callPath} ${c.apiBody ?? ''}`)) return { field: 'apiBody', message: 'Put {phoneE164} where the number goes, in the path or the request.' };
  for (const [field, v] of [['callPath', c.callPath], ['apiBody', c.apiBody], ['hangupPath', c.hangupPath], ['testPath', c.testPath]] as const) {
    if (v && /^[a-z]+:/i.test(v.trim())) return { field, message: 'Write a path that starts with /, not a full address' };
    const p = v ? unknownPlaceholder(v, custom) : null;
    if (p) return { field, message: p };
  }
  return null;
}

const phoneText = z.string().trim().max(40).regex(/^\+[1-9][\d\s().-]{6,30}$/, 'Write the number with its country code, for example +44 7700 900123');
/** An extension or a number: SIP and PBX agents are often an extension such as 204. */
const agentText = z.string().trim().max(40).regex(/^\+?[\d\s().*#-]{2,40}$/, 'Write a phone number with its country code, or an extension').nullable().optional().or(z.literal('').transform(() => null));
const pathText = z.string().trim().max(1000).nullable().optional().or(z.literal('').transform(() => null));

export const RECORDING_MODES = ['OFF', 'ON_DEMAND', 'ALWAYS'] as const;
export type RecordingMode = (typeof RECORDING_MODES)[number];
export const RECORDING_MODE_LABELS: Record<RecordingMode, string> = { OFF: 'Never record', ON_DEMAND: 'When I start it', ALWAYS: 'Every call' };

/** A dialer's settings that are not secret. Secrets are written separately and never read back. */
export const dialerConfigSchema = z.object({
  website: z.string().trim().max(300).url('Enter the provider’s web address').nullable().optional().or(z.literal('').transform(() => null)),
  urlTemplate: optionalText(1000),
  apiBaseUrl: optionalText(300),
  callPath: pathText,
  hangupPath: pathText,
  testPath: pathText,
  apiMethod: z.enum(['POST', 'GET', 'PUT']).default('POST'),
  apiContentType: z.enum(['JSON', 'FORM']).default('JSON'),
  apiBody: optionalText(4000),
  /** Where the provider's call id is in its answer, as a dotted path such as Call.Sid. */
  responseCallIdPath: z.string().trim().max(120).regex(/^[\w.-]*$/, 'A path such as Call.Sid or data.id').nullable().optional().or(z.literal('').transform(() => null)),
  apiAuth: z.enum(DIALER_AUTHS).default('NONE'),
  apiUser: optionalText(300),
  apiHeaderName: z.string().trim().max(80).regex(/^[A-Za-z0-9-]+$/, 'A header name has only letters, digits and -').nullable().optional().or(z.literal('').transform(() => null)),
  clientId: optionalText(300),
  tokenUrl: optionalText(500),
  account: optionalText(200),
  sipServer: optionalText(300),
  sipDomain: optionalText(200),
  sipPort: z.coerce.number().int().min(1).max(65_535).nullable().optional(),
  sipUsername: optionalText(200),
  extension: z.string().trim().max(20).regex(/^[\d*#]*$/, 'An extension has only digits').nullable().optional().or(z.literal('').transform(() => null)),
  /** TWILIO and API: the caller's own phone (or extension), rung first. */
  agentPhone: agentText,
  /** The numbers a call can show; the first is the default. */
  callerIds: z.array(phoneText).max(20).default([]),
  registeredNumber: phoneText.nullable().optional().or(z.literal('').transform(() => null)),
  /** Added to numbers written without one, for example +91. */
  defaultCountryCode: z.string().trim().regex(/^\+[1-9]\d{0,3}$/, 'A country code such as +91').nullable().optional().or(z.literal('').transform(() => null)),
  /** Countries it may call (ISO codes). Empty: anywhere. */
  regions: z.array(z.string().trim().regex(/^[A-Z]{2}$/, 'A two-letter country code such as IN')).max(250).default([]),
  allowOutgoing: z.boolean().default(true),
  allowIncoming: z.boolean().default(false),
  recording: z.enum(RECORDING_MODES).default('OFF'),
  historySync: z.boolean().default(false),
  /** Provider-specific values, each a {placeholder} of its own. */
  customParams: z.array(z.object({ key: z.string().trim().regex(/^[a-zA-Z]\w{0,39}$/, 'Letters, digits and _ only'), value: z.string().trim().max(500) })).max(20).default([]),
  deviceId: uuidRef,
});
export type DialerConfig = z.infer<typeof dialerConfigSchema>;

export const dialerInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name your dialer').max(80),
    kind: z.enum(DIALER_KINDS),
    /** Which provider it was set up from (DIALER_PROVIDERS key). */
    provider: z.string().trim().max(40).nullable().optional(),
    /** Kept at the top for dialers saved before config existed (ADR 0088). */
    urlTemplate: optionalText(1000),
    /** Optional: the details of every call are also posted here, signed (HMAC-SHA256) with the dialer's secret. */
    webhookUrl: optionalText(1000),
    agentPhone: agentText,
    config: dialerConfigSchema.partial().optional(),
    /** Write-only. A key left out keeps what is saved; null clears it. */
    secrets: z.object(Object.fromEntries(DIALER_SECRETS.map((k) => [k, z.string().max(4000).nullable().optional()])) as Record<DialerSecret, z.ZodOptional<z.ZodNullable<z.ZodString>>>).partial().optional(),
    active: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    const c = d.config ?? {};
    const custom = (c.customParams ?? []).map((p) => p.key);
    const template = d.urlTemplate ?? c.urlTemplate;
    if (d.kind === 'LINK') {
      if (!template) ctx.addIssue({ code: 'custom', path: ['urlTemplate'], message: 'Enter the link your dialer opens' });
      else {
        const p = dialerTemplateProblem(template, custom);
        if (p) ctx.addIssue({ code: 'custom', path: ['urlTemplate'], message: p });
      }
    }
    if (d.kind === 'API') {
      const p = dialerApiProblem(c, custom);
      if (p) ctx.addIssue({ code: 'custom', path: [p.field], message: p.message });
      const all = `${c.callPath ?? ''} ${c.apiBody ?? ''}`;
      if (c.apiAuth === 'HEADER' && !c.apiHeaderName) ctx.addIssue({ code: 'custom', path: ['apiHeaderName'], message: 'Enter the header the key goes in' });
      if (c.apiAuth === 'BASIC' && !c.apiUser) ctx.addIssue({ code: 'custom', path: ['apiUser'], message: 'Enter the user name or API key' });
      if (c.apiAuth === 'OAUTH2' && (!c.clientId || !c.tokenUrl)) ctx.addIssue({ code: 'custom', path: [c.clientId ? 'tokenUrl' : 'clientId'], message: c.clientId ? 'Enter the token address' : 'Enter the client id' });
      if (c.tokenUrl && !/^https?:\/\//i.test(c.tokenUrl)) ctx.addIssue({ code: 'custom', path: ['tokenUrl'], message: 'The token address starts with https://' });
      if (/\{agentPhone\}/.test(all) && !(d.agentPhone ?? c.agentPhone)) ctx.addIssue({ code: 'custom', path: ['agentPhone'], message: 'Enter your phone or extension: the request uses it' });
      if (/\{callerId\}/.test(all) && !c.callerIds?.length) ctx.addIssue({ code: 'custom', path: ['callerIds'], message: 'Add a caller id: the request uses it' });
      if (/\{account\}/.test(`${all} ${c.testPath ?? ''}`) && !c.account) ctx.addIssue({ code: 'custom', path: ['account'], message: 'Enter your account id: the request uses it' });
    }
    if (d.kind === 'SIP') {
      if (!c.sipServer || !/^wss:\/\/[^\s/]+/i.test(c.sipServer)) ctx.addIssue({ code: 'custom', path: ['sipServer'], message: 'Enter your SIP server’s WebSocket address, starting with wss://' });
      if (!c.sipDomain) ctx.addIssue({ code: 'custom', path: ['sipDomain'], message: 'Enter the SIP domain' });
      if (!c.sipUsername) ctx.addIssue({ code: 'custom', path: ['sipUsername'], message: 'Enter the SIP user name' });
    }
    const agent = d.agentPhone ?? c.agentPhone;
    if (d.kind === 'TWILIO' && !agent) ctx.addIssue({ code: 'custom', path: ['agentPhone'], message: 'Enter the phone Twilio should ring first' });
    if (d.kind === 'TWILIO' && agent && !/^\+/.test(agent)) ctx.addIssue({ code: 'custom', path: ['agentPhone'], message: 'Write the number with its country code, for example +44 7700 900123' });
    if (d.kind === 'SIM' && !c.deviceId) ctx.addIssue({ code: 'custom', path: ['deviceId'], message: 'Link your phone first: sign in to the SampForce app on it' });
    if (d.webhookUrl && !/^https?:\/\//i.test(d.webhookUrl)) ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'The webhook address starts with https://' });
  });
export type DialerInput = z.infer<typeof dialerInputSchema>;

/** Connection status, from the last test or call. Never "connected" without a successful answer from the provider. */
export const DIALER_STATUSES = ['UNTESTED', 'CONNECTED', 'FAILED', 'NOT_TESTABLE'] as const;
export type DialerStatus = (typeof DIALER_STATUSES)[number];

export interface DialerRow {
  id: string;
  name: string;
  kind: DialerKind;
  provider: string | null;
  urlTemplate: string | null;
  webhookUrl: string | null;
  /** Shown once, when the webhook is first set or the secret is renewed; otherwise null. */
  webhookSecret: string | null;
  hasWebhookSecret: boolean;
  agentPhone: string | null;
  config: DialerConfig;
  /** Which secrets are saved. Their values are never sent back. */
  secretsSaved: Record<DialerSecret, boolean>;
  /** API and LINK: where the provider sends the call status and recording back. */
  eventsUrl: string | null;
  capabilities: DialerCapabilities;
  status: DialerStatus;
  statusAt: string | null;
  statusMessage: string | null;
  /** SIM: the linked phone. */
  device: CallDeviceRow | null;
  active: boolean;
  isDefault: boolean;
  lastUsedAt: string | null;
  createdAt: string;
}

/** A phone with the SampForce app, linked to dial on its SIM. */
export interface CallDeviceRow {
  id: string;
  name: string;
  platform: 'ios' | 'android' | 'web';
  /** Seen in the last 10 minutes: the app is signed in and checking for calls. */
  online: boolean;
  lastSeenAt: string;
  /** Android with call-log permission: talk time comes back by itself. */
  callLogSync: boolean;
  linkedAt: string;
}

/** The caller's dialers and what the workspace offers. */
export interface DialerSettings {
  dialers: DialerRow[];
  /** The built-in phone app dialer, used when the person has not added one. */
  builtIn: { name: string; urlTemplate: string };
  twilio: { connected: boolean; fromNumber: string | null };
  /** The caller's linked phones. Empty until they sign in to the phone app. */
  devices: CallDeviceRow[];
  recordingPolicy: RecordingPolicy;
}

export interface DialerTestResult {
  ok: boolean;
  status: DialerStatus;
  message: string;
  /** What was checked, step by step. */
  steps: { label: string; ok: boolean; detail: string | null }[];
  /** LINK: the link a sample call opens. API: the request a sample call sends, with secrets hidden. */
  sample: { link: string | null; request: { method: string; url: string; headers: Record<string, string>; body: string | null } | null };
}

/** One entry of a dialer's integration log: tests, calls placed, ends, events received, recordings fetched. */
export interface DialerLogRow {
  id: string;
  action: 'TEST' | 'PLACE' | 'HANGUP' | 'EVENT' | 'RECORDING' | 'WEBHOOK' | 'TOKEN';
  ok: boolean;
  httpStatus: number | null;
  message: string;
  callId: string | null;
  attempt: number;
  durationMs: number | null;
  at: string;
}

// ───────────── Outcomes ─────────────

/**
 * What happened on the call. The first 17 are SampForce's; a workspace adds its own (CallOutcomeDef with custom true).
 * Outcomes where nobody answered never mark a company lost or not interested.
 */
export const CALL_OUTCOMES = [
  'NOT_PICKED',
  'NO_ANSWER',
  'CALL_BACK',
  'NOT_INTERESTED',
  'WRONG_NUMBER',
  'BUSY',
  'SEND_DETAILS',
  'ANOTHER_CALL',
  'CALL_SCHEDULED',
  'INTERESTED',
  'QUALIFIED',
  'RFQ_EXPECTED',
  'RFQ_RECEIVED',
  'DEAL_CREATED',
  'EXISTING_CLIENT',
  'CONNECTED',
  'OTHER',
  'VOICEMAIL',
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];
/** A workspace's own outcome is stored by its key, CUSTOM_ followed by letters. */
export const callOutcomeKey = z.string().trim().regex(/^(?:[A-Z_]{2,40}|CUSTOM_[A-Z0-9_]{1,40})$/, 'Choose what happened on the call');

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  NOT_PICKED: 'Call not picked up',
  NO_ANSWER: 'Call not answered',
  CALL_BACK: 'Requested a callback',
  NOT_INTERESTED: 'Not interested',
  WRONG_NUMBER: 'Wrong number',
  BUSY: 'Number busy',
  SEND_DETAILS: 'Requested details by email',
  ANOTHER_CALL: 'Requested another call',
  CALL_SCHEDULED: 'Call scheduled',
  INTERESTED: 'Interested',
  QUALIFIED: 'Qualified opportunity',
  RFQ_EXPECTED: 'RFQ expected',
  RFQ_RECEIVED: 'RFQ received',
  DEAL_CREATED: 'Deal created',
  EXISTING_CLIENT: 'Existing client',
  CONNECTED: 'Call completed successfully',
  OTHER: 'Other',
  VOICEMAIL: 'Left voicemail',
};

/** What an outcome does after the call is saved. */
export const OUTCOME_ACTIONS = ['NONE', 'CALLBACK', 'NEXT_CALL', 'EMAIL_TASK', 'MEETING', 'FLAG_NUMBER', 'DEAL', 'NOT_INTERESTED'] as const;
export type OutcomeAction = (typeof OUTCOME_ACTIONS)[number];
export const OUTCOME_ACTION_LABELS: Record<OutcomeAction, string> = {
  NONE: 'Nothing else',
  CALLBACK: 'Create a callback reminder',
  NEXT_CALL: 'Schedule the next call',
  EMAIL_TASK: 'Create an email follow-up',
  MEETING: 'Schedule a meeting follow-up',
  FLAG_NUMBER: 'Flag the number for checking',
  DEAL: 'Create or update a deal',
  NOT_INTERESTED: 'Mark the contact not interested',
};

/** The tone groups the outcome chips are drawn in. */
export type OutcomeTone = 'reached' | 'positive' | 'missed' | 'stop' | 'neutral';

export interface CallOutcomeDef {
  key: string;
  label: string;
  /** A lucide icon name the page draws. */
  icon: string;
  color: string;
  tone: OutcomeTone;
  /** Someone answered: the call counts as a conversation (stops the email cadence, moves the employee's stage). */
  reached: boolean;
  action: OutcomeAction;
  /** Minutes from now that the follow-up is suggested for, when the action plans one. */
  followUpInMinutes: number | null;
  custom: boolean;
  active: boolean;
}

const o = (key: CallOutcome, icon: string, color: string, tone: OutcomeTone, reached: boolean, action: OutcomeAction, followUpInMinutes: number | null): CallOutcomeDef => ({ key, label: CALL_OUTCOME_LABELS[key], icon, color, tone, reached, action, followUpInMinutes, custom: false, active: true });
const H = 60;
const D = 24 * H;

export const DEFAULT_CALL_OUTCOMES: readonly CallOutcomeDef[] = [
  o('NOT_PICKED', 'PhoneMissed', '#f59e0b', 'missed', false, 'NEXT_CALL', 2 * H),
  o('NO_ANSWER', 'PhoneOff', '#f97316', 'missed', false, 'NEXT_CALL', D),
  o('CALL_BACK', 'PhoneCallback', '#0ea5e9', 'reached', true, 'CALLBACK', D),
  o('NOT_INTERESTED', 'ThumbsDown', '#e11d48', 'stop', true, 'NOT_INTERESTED', null),
  o('WRONG_NUMBER', 'PhoneOff', '#dc2626', 'stop', false, 'FLAG_NUMBER', null),
  o('BUSY', 'PhoneForwarded', '#eab308', 'missed', false, 'NEXT_CALL', 30),
  o('SEND_DETAILS', 'MailPlus', '#6366f1', 'reached', true, 'EMAIL_TASK', H),
  o('ANOTHER_CALL', 'CalendarClock', '#3b82f6', 'reached', true, 'NEXT_CALL', 3 * D),
  o('CALL_SCHEDULED', 'CalendarCheck', '#2563eb', 'reached', true, 'NEXT_CALL', D),
  o('INTERESTED', 'Sparkles', '#10b981', 'positive', true, 'MEETING', 2 * D),
  o('QUALIFIED', 'BadgeCheck', '#059669', 'positive', true, 'DEAL', null),
  o('RFQ_EXPECTED', 'FileClock', '#14b8a6', 'positive', true, 'NEXT_CALL', 3 * D),
  o('RFQ_RECEIVED', 'FileCheck2', '#0d9488', 'positive', true, 'DEAL', null),
  o('DEAL_CREATED', 'Handshake', '#16a34a', 'positive', true, 'DEAL', null),
  o('EXISTING_CLIENT', 'Building2', '#8b5cf6', 'reached', true, 'NONE', null),
  o('CONNECTED', 'PhoneCall', '#22c55e', 'reached', true, 'NONE', null),
  o('VOICEMAIL', 'Voicemail', '#a855f7', 'missed', false, 'NEXT_CALL', D),
  o('OTHER', 'MoreHorizontal', '#64748b', 'neutral', false, 'NONE', null),
];

export const OUTCOME_ICONS = ['PhoneMissed', 'PhoneOff', 'PhoneCallback', 'ThumbsDown', 'ThumbsUp', 'PhoneForwarded', 'MailPlus', 'CalendarClock', 'CalendarCheck', 'Sparkles', 'BadgeCheck', 'FileClock', 'FileCheck2', 'Handshake', 'Building2', 'PhoneCall', 'Voicemail', 'MoreHorizontal', 'Star', 'Flag', 'Clock', 'Ban', 'Languages', 'UserX', 'Users'] as const;

/** A workspace's own outcome, or a change to one of SampForce's (label, colour, action, on or off). */
export const callOutcomeInputSchema = z.object({
  label: z.string().trim().min(1, 'Name the outcome').max(60),
  icon: z.enum(OUTCOME_ICONS).default('Star'),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour such as #10b981').default('#64748b'),
  tone: z.enum(['reached', 'positive', 'missed', 'stop', 'neutral']).default('neutral'),
  reached: z.boolean().default(false),
  action: z.enum(OUTCOME_ACTIONS).default('NONE'),
  followUpInMinutes: z.coerce.number().int().min(5).max(90 * D).nullable().optional(),
  active: z.boolean().default(true),
});
export type CallOutcomeInput = z.infer<typeof callOutcomeInputSchema>;

/** The outcomes, SampForce's first with the workspace's changes, then the workspace's own. */
export function mergeOutcomes(overrides: Partial<Record<string, Partial<CallOutcomeDef>>>, custom: CallOutcomeDef[]): CallOutcomeDef[] {
  return [...DEFAULT_CALL_OUTCOMES.map((d) => ({ ...d, ...(overrides[d.key] ?? {}), key: d.key, custom: false })), ...custom.map((c) => ({ ...c, custom: true }))];
}

/** Outcomes where someone answered, by default. A workspace's outcome says for itself. */
export const CALL_REACHED: ReadonlySet<string> = new Set(DEFAULT_CALL_OUTCOMES.filter((d) => d.reached).map((d) => d.key));

// ───────────── Placing calls ─────────────

/** OPEN: placed, not logged yet. Dialers that report back also pass through RINGING and IN_PROGRESS. */
export const CALL_STATUSES = ['OPEN', 'REQUESTED', 'RINGING', 'IN_PROGRESS', 'ON_HOLD', 'ENDED', 'FAILED', 'MISSED', 'LOGGED'] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  OPEN: 'Placed',
  REQUESTED: 'Waiting for the phone',
  RINGING: 'Ringing',
  IN_PROGRESS: 'In progress',
  ON_HOLD: 'On hold',
  ENDED: 'Ended',
  FAILED: 'Failed',
  MISSED: 'Missed',
  LOGGED: 'Logged',
};

export const CALL_DIRECTIONS = ['OUTGOING', 'INCOMING'] as const;
export type CallDirection = (typeof CALL_DIRECTIONS)[number];

/** Which number on the record was dialled. OTHER: typed on the keypad. */
export const CALL_NUMBER_SOURCES = ['EMPLOYEE', 'COMPANY', 'OTHER'] as const;
export type CallNumberSource = (typeof CALL_NUMBER_SOURCES)[number];

export const callStartSchema = z
  .object({
    companyId: uuidRef,
    contactId: uuidRef,
    /** Which of the record's numbers to call; or a number typed on the keypad. */
    numberSource: z.enum(CALL_NUMBER_SOURCES).default('EMPLOYEE'),
    number: z.string().trim().max(40).optional(),
    /** Added to a number written without one. */
    countryCode: z.string().trim().regex(/^\+[1-9]\d{0,3}$/).nullable().optional(),
    /** null or missing: the person's default dialer (the phone app when they have none). */
    dialerId: uuidRef,
    /** true: the phone app on this device, even when the person has a default dialer. */
    phoneApp: z.boolean().optional(),
    /** One of the dialer's caller ids; missing: its first. */
    callerId: z.string().trim().max(40).nullable().optional(),
    /** The deal this call is about, when started from one. */
    dealId: uuidRef,
    /** The person agreed to be recorded, when the policy asks for consent before recording. */
    recordingConsent: z.boolean().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.numberSource === 'OTHER' && !d.number) ctx.addIssue({ code: 'custom', path: ['number'], message: 'Type the number to call' });
    if (d.numberSource === 'EMPLOYEE' && !d.contactId) ctx.addIssue({ code: 'custom', path: ['contactId'], message: 'Choose the employee to call' });
    if (d.numberSource === 'COMPANY' && !d.companyId) ctx.addIssue({ code: 'custom', path: ['companyId'], message: 'Choose the company to call' });
  });
export type CallStartInput = z.infer<typeof callStartSchema>;

/** What to do after the call, as the page offers it from the outcome. Every part is optional. */
export const callFollowUpSchema = z.object({
  /** CALL: the next call or callback. EMAIL: an email to send. MEETING: a meeting to hold. */
  type: z.enum(['CALL', 'EMAIL', 'MEETING']),
  at: isoDateTime,
  note: optionalText(500),
});
export type CallFollowUpInput = z.infer<typeof callFollowUpSchema>;

export const callLogSchema = z.object({
  outcome: callOutcomeKey,
  remarks: optionalText(10_000),
  /** Talk time in seconds; dialers that report back fill it in themselves. */
  durationSec: z.coerce.number().int().min(0).max(86_400).nullable().optional(),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']).nullable().optional(),
  /** When set, the next call is scheduled as a call follow-up (kept for ADR 0088 clients). */
  nextCallAt: optionalDateTime,
  nextCallNote: optionalText(500),
  /** The follow-up the outcome suggests, as the person left it. Replaces nextCallAt when given. */
  followUp: callFollowUpSchema.nullable().optional(),
  /** WRONG_NUMBER and similar: flag the number on the record for checking. */
  flagNumber: z.boolean().optional(),
  /** NOT_INTERESTED: also mark the contact not interested (never the company). */
  markNotInterested: z.boolean().optional(),
  /** Link the call to this deal (an existing one of the company). */
  dealId: uuidRef,
  /** RFQ received, qualified and similar: create a deal for the company from the call (needs deals:write). */
  createDeal: z.object({ name: z.string().trim().min(1, 'Name the deal').max(200), amount: z.coerce.number().min(0).max(1e12).default(0), currency: z.string().trim().length(3).toUpperCase().optional() }).nullable().optional(),
});
export type CallLogInput = z.infer<typeof callLogSchema>;

/** Editing a logged call: its outcome, remarks and talk time. The next call is changed on its follow-up. */
export const callUpdateSchema = callLogSchema.pick({ outcome: true, remarks: true, durationSec: true, sentiment: true, dealId: true }).partial().strict();
export type CallUpdateInput = z.infer<typeof callUpdateSchema>;

/** In-call controls, sent to the dialer that can do them. */
export const callControlSchema = z.object({
  action: z.enum(['HANGUP', 'MUTE', 'UNMUTE', 'HOLD', 'RESUME', 'RECORD_START', 'RECORD_STOP']),
});
export type CallControlInput = z.infer<typeof callControlSchema>;

export const CALL_SORTS = ['newest', 'oldest', 'longest', 'company'] as const;
export const callListQuerySchema = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  outcome: z.string().trim().max(60).optional(),
  status: z.enum(CALL_STATUSES).optional(),
  direction: z.enum(CALL_DIRECTIONS).optional(),
  companyId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  dialerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  hasRecording: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  q: z.string().trim().max(100).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  sort: z.enum(CALL_SORTS).default('newest'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Calls placed before this time (the previous page's last startedAt); newest first only. */
  before: isoDateTime.optional(),
});
export type CallListQuery = z.infer<typeof callListQuerySchema>;

export const callTargetSearchSchema = z.object({ q: z.string().trim().min(1).max(100) });

/** Everything a call needs about who is being called: what the dialer receives, and what the Calls page shows. */
export interface CallDetails {
  company: { id: string; name: string; phone: string | null; leadNumber: string | null; logo: CompanyLogoRef | null; country: string | null; timezone: string | null; phoneFlagged: boolean } | null;
  employee: { id: string; name: string; designation: string | null; email: string | null; phone: string | null; timezone: string | null; phoneFlagged: boolean; notInterested: boolean } | null;
  /** Hidden by record visibility (the role may see the record but not someone else's contact details). */
  detailsHidden: boolean;
  /** The other employees of the company with a phone number, to switch to. */
  colleagues: { id: string; name: string; designation: string | null; phone: string }[];
  /** Is it a good time to call where they are? From the employee's time zone, else the company's. */
  localTime: CallWindow | null;
  lastCall: { at: string; outcome: string | null; by: string | null; remarks: string | null } | null;
  nextCall: { id: string; dueAt: string; title: string } | null;
  /** Calls to them so far, and how many reached someone. */
  callCount: number;
  reachedCount: number;
  /** The company's open deals, to link the call to. */
  deals: { id: string; name: string; stage: string | null; amount: number | null; currency: string | null }[];
  favorite: boolean;
}

/** A company or employee found from the Calls search, with the numbers on file. */
export interface CallTarget {
  kind: 'company' | 'employee';
  companyId: string | null;
  contactId: string | null;
  name: string;
  subtitle: string | null;
  phone: string | null;
  companyPhone: string | null;
  companyName: string | null;
  /** The company's logo (for an employee, their company's). */
  logo: CompanyLogoRef | null;
}

export interface CallFavorite extends CallTarget {
  id: string;
  lastCallAt: string | null;
}

export interface CallRow {
  id: string;
  direction: CallDirection;
  status: CallStatus;
  outcome: string | null;
  number: string;
  numberSource: CallNumberSource;
  callerId: string | null;
  dialer: { id: string | null; name: string; kind: DialerKind; provider: string | null };
  company: { id: string; name: string } | null;
  employee: { id: string; name: string; designation: string | null; email: string | null; phone: string | null } | null;
  deal: { id: string; name: string } | null;
  /** The details handed to the dialer when the call started. */
  details: CallHandoff;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  remarks: string | null;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE' | null;
  nextCall: { id: string; dueAt: string | null; title: string; status: 'OPEN' | 'DONE' | 'CANCELED'; type: string | null } | null;
  interactionId: string | null;
  webhook: { status: 'SENT' | 'FAILED'; at: string; error: string | null } | null;
  providerStatus: string | null;
  recording: { id: string; durationSec: number | null; source: RecordingSource } | null;
  muted: boolean;
  onHold: boolean;
  recordingActive: boolean;
  /** The caller confirmed the other person agreed to be recorded. */
  recordingConsent: boolean;
  error: string | null;
  by: PersonRef | null;
}

/** The details a call hands to the dialer. */
export interface CallHandoff {
  companyName: string | null;
  companyPhone: string | null;
  employeeName: string | null;
  designation: string | null;
  email: string | null;
  employeePhone: string | null;
}

export interface CallStarted {
  call: CallRow;
  /** LINK dialers: the address to open now. Null for dialers that ring by themselves. */
  launchUrl: string | null;
  /** SIP dialers: what the browser phone dials. */
  sipTarget: string | null;
}

export interface CallStats {
  today: { calls: number; reached: number; talkSec: number; notLogged: number };
  nextCallsToday: number;
  overdueCalls: number;
  /** This week, day by day (Monday first): calls and reached, for the sparkline. */
  week: { day: string; calls: number; reached: number }[];
  /** Today's calls by outcome. */
  outcomes: { outcome: string; count: number }[];
  /** Incoming calls ringing for me now (dialers that report incoming calls). */
  ringing: CallRow[];
}

// ───────────── Recordings ─────────────

export const RECORDING_SOURCES = ['PROVIDER', 'UPLOAD', 'BROWSER'] as const;
export type RecordingSource = (typeof RECORDING_SOURCES)[number];
export const RECORDING_SOURCE_LABELS: Record<RecordingSource, string> = { PROVIDER: 'From the provider', UPLOAD: 'Uploaded', BROWSER: 'Recorded in the browser' };

/** The workspace's rules for recordings. Admins set them; nothing is recorded where the policy or provider says no. */
export const recordingPolicySchema = z.object({
  /** Recording is allowed at all. */
  enabled: z.boolean().default(true),
  /** Ask the caller to confirm the other person agreed before recording starts. */
  requireConsent: z.boolean().default(true),
  /** Read out or shown to the caller: what to tell the other person. */
  consentNotice: z.string().trim().max(400).default('This call may be recorded for quality and training.'),
  /** Days a recording is kept; null keeps it until deleted. */
  retentionDays: z.coerce.number().int().min(1).max(3650).nullable().default(365),
  /** Who may download: everyone who can play it, managers and admins, or nobody. */
  download: z.enum(['ALL', 'MANAGERS', 'NONE']).default('MANAGERS'),
});
export type RecordingPolicy = z.infer<typeof recordingPolicySchema>;

export const recordingListQuerySchema = z.object({
  scope: z.enum(['mine', 'team', 'all']).default('mine'),
  q: z.string().trim().max(100).optional(),
  dialerId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  outcome: z.string().trim().max(60).optional(),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: isoDateTime.optional(),
});
export type RecordingListQuery = z.infer<typeof recordingListQuerySchema>;

export const recordingNoteSchema = z.object({ notes: z.string().trim().max(5000).nullable() });

export interface RecordingRow {
  id: string;
  callId: string;
  source: RecordingSource;
  contentType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  notes: string | null;
  createdAt: string;
  expiresAt: string | null;
  /** Can be played here (stored, or fetched from the provider on demand). */
  playable: boolean;
  canDownload: boolean;
  call: { startedAt: string; direction: CallDirection; outcome: string | null; number: string; dialer: { name: string; provider: string | null } };
  company: { id: string; name: string } | null;
  employee: { id: string; name: string; designation: string | null } | null;
  by: PersonRef | null;
}

/** The biggest recording a person can upload or record in the browser. Kept in the database, like other files. */
export const RECORDING_MAX_BYTES = 12 * 1024 * 1024;
export const RECORDING_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/aac'] as const;

// ───────────── Good time to call ─────────────

export type CallWindowKind = 'GOOD' | 'LUNCH' | 'EARLY' | 'LATE' | 'WEEKEND';
export interface CallWindow {
  timeZone: string;
  /** Their wall clock, HH:mm. */
  time: string;
  /** Mon..Sun in English; the page formats its own. */
  weekday: string;
  /** Minutes their clock is ahead of UTC. */
  offsetMinutes: number;
  kind: CallWindowKind;
  good: boolean;
}

export const CALL_WINDOW_LABELS: Record<CallWindowKind, string> = {
  GOOD: 'Good time to call',
  LUNCH: 'Lunch time there',
  EARLY: 'Too early there',
  LATE: 'After office hours there',
  WEEKEND: 'Weekend there',
};

/** Office hours: Monday to Friday 09:00 to 18:00 on their clock, lunch 13:00 to 14:00. */
export function callWindow(timeZone: string | null | undefined, now = new Date()): CallWindow | null {
  if (!timeZone) return null;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  } catch {
    return null;
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekday = get('weekday');
  const wall = Date.UTC(Number(get('year')), Number(get('month')) - 1, Number(get('day')), hour, minute);
  const offsetMinutes = Math.round((wall - Math.floor(now.getTime() / 60_000) * 60_000) / 60_000);
  const mins = hour * 60 + minute;
  const kind: CallWindowKind = weekday === 'Sat' || weekday === 'Sun' ? 'WEEKEND' : mins < 9 * 60 ? 'EARLY' : mins >= 18 * 60 ? 'LATE' : mins >= 13 * 60 && mins < 14 * 60 ? 'LUNCH' : 'GOOD';
  return { timeZone, time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, weekday, offsetMinutes, kind, good: kind === 'GOOD' };
}

// ───────────── Numbers and links ─────────────

/** Country calling codes for the keypad's picker: the common ones first. */
export const CALLING_CODES: readonly { country: string; code: string; name: string }[] = [
  { country: 'IN', code: '+91', name: 'India' },
  { country: 'US', code: '+1', name: 'United States' },
  { country: 'GB', code: '+44', name: 'United Kingdom' },
  { country: 'AE', code: '+971', name: 'United Arab Emirates' },
  { country: 'SG', code: '+65', name: 'Singapore' },
  { country: 'AU', code: '+61', name: 'Australia' },
  { country: 'CA', code: '+1', name: 'Canada' },
  { country: 'DE', code: '+49', name: 'Germany' },
  { country: 'FR', code: '+33', name: 'France' },
  { country: 'ES', code: '+34', name: 'Spain' },
  { country: 'IT', code: '+39', name: 'Italy' },
  { country: 'NL', code: '+31', name: 'Netherlands' },
  { country: 'SA', code: '+966', name: 'Saudi Arabia' },
  { country: 'QA', code: '+974', name: 'Qatar' },
  { country: 'JP', code: '+81', name: 'Japan' },
  { country: 'CN', code: '+86', name: 'China' },
  { country: 'HK', code: '+852', name: 'Hong Kong' },
  { country: 'MY', code: '+60', name: 'Malaysia' },
  { country: 'ZA', code: '+27', name: 'South Africa' },
  { country: 'BR', code: '+55', name: 'Brazil' },
  { country: 'MX', code: '+52', name: 'Mexico' },
  { country: 'IE', code: '+353', name: 'Ireland' },
  { country: 'CH', code: '+41', name: 'Switzerland' },
  { country: 'SE', code: '+46', name: 'Sweden' },
  { country: 'PL', code: '+48', name: 'Poland' },
  { country: 'NZ', code: '+64', name: 'New Zealand' },
  { country: 'PH', code: '+63', name: 'Philippines' },
  { country: 'ID', code: '+62', name: 'Indonesia' },
  { country: 'BD', code: '+880', name: 'Bangladesh' },
  { country: 'PK', code: '+92', name: 'Pakistan' },
  { country: 'LK', code: '+94', name: 'Sri Lanka' },
  { country: 'NP', code: '+977', name: 'Nepal' },
  { country: 'KR', code: '+82', name: 'South Korea' },
  { country: 'EG', code: '+20', name: 'Egypt' },
  { country: 'NG', code: '+234', name: 'Nigeria' },
  { country: 'KE', code: '+254', name: 'Kenya' },
];

/** A number in international form, or null when it has no country code (+ or 00) or is not a plausible length. */
export function e164(phone: string | null | undefined, defaultCountryCode?: string | null): string | null {
  let t = phone?.trim();
  if (!t) return null;
  if (!/^(\+|00)/.test(t) && defaultCountryCode && /^\+\d{1,4}$/.test(defaultCountryCode)) t = `${defaultCountryCode}${t.replace(/^0+/, '')}`;
  if (!/^(\+|00)/.test(t)) return null;
  const digits = t.replace(/^00/, '').replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return null;
  return `+${digits}`;
}

/** A number the device's dialer can take: international when possible, else only the digits (and a leading +). */
export function dialable(phone: string, defaultCountryCode?: string | null): string {
  return e164(phone, defaultCountryCode) ?? phone.trim().replace(/(?!^\+)[^\d]/g, '');
}

/** The calling code a number starts with, from the picker's list (longest match), or null. */
export function callingCodeOf(phone: string | null | undefined): string | null {
  const n = e164(phone);
  if (!n) return null;
  return [...new Set(CALLING_CODES.map((c) => c.code))].sort((a, b) => b.length - a.length).find((c) => n.startsWith(c)) ?? null;
}

/**
 * The dialer link or request with every {placeholder} filled in. `encode`: 'url' for a link or a path, 'form' for a
 * form body, 'json' for a JSON body (escaped as a JSON string), 'raw' to leave values as they are.
 * A web address keeps + encoded (in a query a bare + is a space); phone links (tel:, callto:, sip:, app schemes) keep
 * the + of an international number as is.
 */
export function fillDialerTemplate(template: string, values: Partial<Record<string, string | null>>, encode: 'url' | 'form' | 'json' | 'raw' = 'url'): string {
  const web = /^https?:/i.test(template.trim());
  return template.replace(/\{(\w+)\}/g, (all, key: string) => {
    if (!(key in values) && !(key in DIALER_PLACEHOLDERS)) return all;
    const raw = values[key] ?? '';
    if (encode === 'raw') return raw;
    if (encode === 'json') return JSON.stringify(raw).slice(1, -1);
    const v = encodeURIComponent(raw);
    return encode === 'form' || web ? v : v.replace(/%2B/g, '+');
  });
}

/** A value from a provider's JSON answer by a dotted path (Call.Sid, data.0.id). */
export function pickPath(obj: unknown, path: string | null | undefined): string | null {
  if (!path) return null;
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' || typeof cur === 'number' ? String(cur) : null;
}

/** Talk time as m:ss or h:mm:ss. */
export function talkTime(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

// ───────────── Provider events ─────────────

/**
 * What a provider sends back to a dialer's events address, as JSON or a form. Field names vary by provider, so the
 * common ones are all read. The SampForce call is found by our call id ({callId} passed when the call was placed), or by
 * the provider's own call id.
 */
export interface ProviderEvent {
  callId: string | null;
  providerCallId: string | null;
  status: CallStatus | null;
  rawStatus: string | null;
  direction: CallDirection | null;
  from: string | null;
  to: string | null;
  durationSec: number | null;
  recordingUrl: string | null;
}

const EVENT_STATUS: Record<string, CallStatus> = {
  queued: 'RINGING', initiated: 'RINGING', ringing: 'RINGING', calling: 'RINGING', created: 'RINGING', 'call.created': 'RINGING', 'call.ringing_on_agent': 'RINGING',
  answered: 'IN_PROGRESS', 'in-progress': 'IN_PROGRESS', inprogress: 'IN_PROGRESS', connected: 'IN_PROGRESS', 'call.answered': 'IN_PROGRESS', 'call.agent_connected': 'IN_PROGRESS',
  hold: 'ON_HOLD', 'call.hold': 'ON_HOLD', 'call.unhold': 'IN_PROGRESS',
  completed: 'ENDED', ended: 'ENDED', hangup: 'ENDED', 'call.ended': 'ENDED', 'call.hungup': 'ENDED', success: 'ENDED',
  busy: 'FAILED', failed: 'FAILED', 'no-answer': 'FAILED', noanswer: 'FAILED', 'no answer': 'FAILED', canceled: 'FAILED', cancelled: 'FAILED', missed: 'MISSED', 'call.missed': 'MISSED', 'call.voicemail_left': 'MISSED',
};

export function readProviderEvent(body: Record<string, unknown>): ProviderEvent {
  const flat: Record<string, unknown> = { ...body };
  // Aircall and others wrap the call in data: lift its fields.
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) Object.assign(flat, body.data as object, { event: body.event ?? (body.data as Record<string, unknown>).event });
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = flat[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  };
  const custom = str('callId', 'call_id_sampforce', 'reference', 'CustomField', 'custom', 'customField');
  const raw = (str('status', 'CallStatus', 'Status', 'call_status', 'event', 'EventType', 'state') ?? '').toLowerCase();
  const dir = (str('direction', 'Direction', 'CallType', 'call_type') ?? '').toLowerCase();
  const dur = Number(str('durationSec', 'duration', 'CallDuration', 'Duration', 'DialCallDuration', 'conversation_duration', 'billsec'));
  return {
    callId: custom && /^[0-9a-f-]{36}$/i.test(custom) ? custom.toLowerCase() : null,
    providerCallId: str('providerCallId', 'CallSid', 'Sid', 'call_id', 'uuid', 'id'),
    status: EVENT_STATUS[raw] ?? null,
    rawStatus: raw || null,
    direction: /^(in|inbound|incoming|call-attempt)/.test(dir) ? 'INCOMING' : /^(out|outbound|outgoing)/.test(dir) ? 'OUTGOING' : null,
    from: str('from', 'From', 'caller', 'CallFrom', 'raw_digits'),
    to: str('to', 'To', 'CallTo', 'called'),
    durationSec: Number.isFinite(dur) && dur >= 0 ? Math.round(dur) : null,
    recordingUrl: str('recordingUrl', 'RecordingUrl', 'recording_url', 'recording', 'asset'),
  };
}
