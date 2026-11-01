import { z } from 'zod';
import { DOMAIN_EVENT_TYPES } from './automation';

/** Workspace API keys for Zapier, Make, n8n and scripts. Shown once; only a SHA-256 hash is stored. */
export const API_KEY_PREFIX = 'dfk_';

/**
 * What a key may be allowed to do. A key acts as the person who created it, limited to these scopes and to that
 * person's current role. Exports, settings, members, billing, integrations and AI are never available to keys.
 */
export const API_KEY_SCOPES = [
  'leads:read',
  'leads:write',
  'contacts:read',
  'contacts:write',
  'companies:read',
  'companies:write',
  'deals:read',
  'deals:write',
  'pipelines:read',
  'activities:read',
  'activities:write',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const apiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, 'Choose at least one scope').max(API_KEY_SCOPES.length),
  /** Optional expiry in days (1 to 730). Without it the key works until revoked. */
  expiresInDays: z.number().int().min(1).max(730).optional(),
});
export type ApiKeyCreateInput = z.infer<typeof apiKeyCreateSchema>;

export interface ApiKeyRow {
  id: string;
  name: string;
  /** The first characters, to recognise a key; never enough to use it. */
  prefix: string;
  scopes: ApiKeyScope[];
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** Zapier subscriptions made with this key. */
  hooks: number;
}

export interface ApiKeyCreated extends ApiKeyRow {
  /** The full key. Returned once, at creation. */
  key: string;
}

/** Events Zapier (or any REST-hook client) can subscribe to, with the scope needed to read them. */
export const ZAPIER_EVENTS = {
  'lead.created': 'leads:read',
  'lead.updated': 'leads:read',
  'lead.converted': 'leads:read',
  'contact.created': 'contacts:read',
  'contact.updated': 'contacts:read',
  'company.created': 'companies:read',
  'deal.created': 'deals:read',
  'deal.stage_changed': 'deals:read',
  'deal.won': 'deals:read',
  'deal.lost': 'deals:read',
  'task.created': 'activities:read',
  'task.completed': 'activities:read',
} as const satisfies Partial<Record<(typeof DOMAIN_EVENT_TYPES)[number], ApiKeyScope>>;
export type ZapierEvent = keyof typeof ZAPIER_EVENTS;

export const zapierSubscribeSchema = z.object({
  event: z.enum(Object.keys(ZAPIER_EVENTS) as [ZapierEvent, ...ZapierEvent[]]),
  targetUrl: z.string().url().max(2000),
});

export interface ZapierMe {
  workspace: string;
  user: string;
  keyName: string;
  scopes: ApiKeyScope[];
}

export interface ZapierStatus {
  /** The operator's invite link to the DealFlow Zapier app; null while it is not deployed (Pending Configuration). */
  inviteUrl: string | null;
  subscriptions: number;
}
