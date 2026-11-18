import { z } from 'zod';

/**
 * A workspace's own AI keys or AI server and its own email server (ADR 0068). Admins enter them under Integrations;
 * they are sealed in the database and used before the deployment's shared providers.
 */
export const OWN_AI_KINDS = ['anthropic', 'openai', 'gemini', 'groq', 'openrouter', 'mistral', 'custom_ai'] as const;
export type OwnAiKind = (typeof OWN_AI_KINDS)[number];

export const OWN_AI_NAMES: Record<OwnAiKind, string> = {
  anthropic: 'Anthropic Claude',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  custom_ai: 'Own AI server (OpenAI-compatible)',
};

export const ownAiProviderInputSchema = z.object({
  kind: z.enum(OWN_AI_KINDS),
  /** A new key; omit (or null) to keep the one saved for this provider. Optional for a self-hosted server. */
  apiKey: z.string().trim().min(1).max(4096).nullable().optional(),
  /** Empty: the provider's default model. Required for an own server. */
  model: z.string().trim().max(200).optional(),
  /** Own server only: the address before /chat/completions, for example https://ai.example.com/v1. */
  baseUrl: z.string().trim().url().max(2048).optional(),
});

export const ownAiSaveSchema = z.object({
  /** In the order they are tried. */
  providers: z.array(ownAiProviderInputSchema).min(1).max(OWN_AI_KINDS.length),
  /** After the workspace's own providers, also use the providers SampForce shares (and its AI credits). */
  useShared: z.boolean(),
});
export type OwnAiSaveInput = z.infer<typeof ownAiSaveSchema>;

export interface OwnAiProviderRow {
  kind: OwnAiKind;
  name: string;
  model: string;
  baseUrl: string | null;
  /** Last four characters of the key, or null when there is none (or it is short). */
  keyHint: string | null;
  hasKey: boolean;
  lastOkAt: string | null;
  lastError: { at: string; message: string } | null;
}

export interface OwnAiStatus {
  configured: boolean;
  providers: OwnAiProviderRow[];
  useShared: boolean;
  /** Whether the deployment has shared AI providers at all. */
  sharedAvailable: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const ownEmailSaveSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  /** `tls`: encrypted from the start (usually 465). `starttls`: upgraded after connecting (usually 587 or 2525). `none`: only for a private server the operator approved. */
  security: z.enum(['tls', 'starttls', 'none']),
  username: z.string().trim().max(320).optional(),
  /** A new password; omit (or null) to keep the saved one. */
  password: z.string().max(1024).nullable().optional(),
  fromAddress: z.string().trim().email().max(320),
  fromName: z.string().trim().max(120).optional(),
});
export type OwnEmailSaveInput = z.infer<typeof ownEmailSaveSchema>;

export interface OwnEmailStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  security: 'tls' | 'starttls' | 'none' | null;
  username: string | null;
  hasPassword: boolean;
  fromAddress: string | null;
  fromName: string | null;
  lastOkAt: string | null;
  lastError: { at: string; message: string } | null;
  /** Whether the deployment's shared email service is set up (used when the workspace's own one fails). */
  sharedAvailable: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

/** Result of a test: what was checked, in words. */
export interface OwnServerTestResult {
  ok: boolean;
  message: string;
}
