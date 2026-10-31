import { z } from 'zod';

// ───── Two-step verification (TOTP) ─────

/** A 6-digit authenticator code, or a recovery code (xxxxx-xxxxx). Spaces and dashes are ignored. */
export const mfaCodeSchema = z
  .string()
  .trim()
  .min(6, 'Enter the 6-digit code')
  .max(32)
  .transform((v) => v.replace(/[\s-]/g, '').toLowerCase());

export const mfaVerifySchema = z.object({ challenge: z.string().min(10).max(2000), code: mfaCodeSchema });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaSetupSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200) });
export type MfaSetupInput = z.infer<typeof mfaSetupSchema>;

export const mfaEnableSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from your app') });
export type MfaEnableInput = z.infer<typeof mfaEnableSchema>;

export const mfaDisableSchema = z.object({ password: z.string().min(1, 'Enter your password').max(200), code: mfaCodeSchema });
export type MfaDisableInput = z.infer<typeof mfaDisableSchema>;

export const mfaRegenerateSchema = z.object({ code: mfaCodeSchema });

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  /** False for people whose sign-in is managed by their workspace's identity provider (no DealFlow password). */
  canManage: boolean;
}

export interface MfaSetupResponse {
  /** Base32 secret for manual entry. */
  secret: string;
  /** otpauth:// URI for the QR code. */
  otpauthUri: string;
}

export interface MfaEnableResponse {
  recoveryCodes: string[];
}

/** Login answer when the account has two-step verification: no session yet, only a short-lived challenge. */
export interface LoginResponse {
  tenantId?: string;
  mfaRequired?: true;
  challenge?: string;
}

// ───── Sessions ─────

export interface SessionSummary {
  id: string;
  current: boolean;
  method: 'password' | 'mfa' | 'sso';
  userAgent: string | null;
  ipAddress: string | null;
  lastActiveAt: string;
  expiresAt: string;
}

// ───── Workspace security settings ─────

export const mfaPolicySchema = z.object({ requireMfa: z.boolean() });

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,63}$/, 'Enter a domain such as example.com');

export const ssoConnectionSchema = z
  .object({
    loginSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{2,62}$/, 'Use 3 to 63 lower-case letters, numbers or dashes'),
    issuer: z.string().trim().url('Enter the issuer URL from your identity provider').max(500),
    clientId: z.string().trim().min(1, 'Enter the client ID').max(500),
    /** Leave empty to keep the stored secret. Required the first time. */
    clientSecret: z.string().max(2000).optional(),
    allowedDomains: z.array(domainSchema).max(20).default([]),
    jitProvisioning: z.boolean().default(false),
    defaultRoleId: z.string().uuid().nullable().default(null),
    enabled: z.boolean().default(false),
    enforced: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    if (v.enforced && !v.enabled) ctx.addIssue({ code: 'custom', path: ['enforced'], message: 'Turn single sign-on on before requiring it' });
    if (v.jitProvisioning && !v.defaultRoleId) ctx.addIssue({ code: 'custom', path: ['defaultRoleId'], message: 'Choose the role new people get' });
  });
export type SsoConnectionInput = z.infer<typeof ssoConnectionSchema>;

export interface SsoConnectionView {
  loginSlug: string;
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  allowedDomains: string[];
  jitProvisioning: boolean;
  defaultRoleId: string | null;
  enabled: boolean;
  enforced: boolean;
  lastVerifiedAt: string | null;
}

export const scimTokenCreateSchema = z.object({ name: z.string().trim().min(1, 'Name the token').max(80) });

export interface ScimTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SecuritySettings {
  requireMfa: boolean;
  /** Active members who have not turned on two-step verification (and do not sign in through SSO). */
  membersWithoutMfa: number;
  /** Whether the caller has two-step verification on (needed before requiring it for everyone). */
  callerHasMfa: boolean;
  ssoEntitled: boolean;
  sso: SsoConnectionView | null;
  /** Values the identity provider needs. */
  redirectUri: string;
  scimBaseUrl: string;
  scimTokens: ScimTokenView[];
}

/** Error codes the sign-in page turns into messages after an SSO redirect (?sso_error=...). */
export const SSO_ERRORS = {
  unknown_workspace: 'No workspace uses that single sign-on name, or single sign-on is turned off.',
  provider_error: 'Your identity provider did not complete the sign-in. Try again, or ask your administrator.',
  invalid_response: 'The sign-in response could not be verified. Ask your administrator to check the single sign-on settings.',
  expired: 'The sign-in took too long. Start again.',
  domain_not_allowed: 'Your email domain is not allowed for this workspace.',
  not_invited: 'You do not have access to this workspace yet. Ask an administrator to invite you.',
  suspended: 'Your access to this workspace is suspended.',
  no_seats: 'This workspace has no free seats. Ask an administrator.',
  not_entitled: 'Single sign-on is not included in this workspace’s plan.',
} as const;
export type SsoErrorCode = keyof typeof SSO_ERRORS;
