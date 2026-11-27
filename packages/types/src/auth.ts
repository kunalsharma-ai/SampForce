import type { FeatureKey } from './features';
import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** At least 10 chars with a letter and a digit. Long passphrases are encouraged. */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(120),
  email: emailSchema,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, 'Enter your organization name').max(120),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Asks for a password reset link. The answer is the same whether or not the address has an account. */
export const passwordResetRequestSchema = z.object({ email: emailSchema });
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;

export const passwordResetSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/** Changing the password while signed in: the current one, then the new one (W6). */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a password you have not used here' });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
/** How many other devices were signed out. */
export interface PasswordChanged {
  signedOut: number;
}

export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });
export type SwitchTenantInput = z.infer<typeof switchTenantSchema>;

export interface MembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** The person's profile photo (ADR 0072, M6), versioned so it can be cached; null without one. */
  photoUrl: string | null;
}

export interface MeResponse {
  user: SessionUser;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    isDemo: boolean;
    brandColor: string | null;
    /**
     * Features the caller's workspace may use now: the plan's (ADR 0057), narrowed by the workspace hierarchy
     * (ADR 0071). Pages for anything else are locked.
     */
    features: FeatureKey[];
    /** Features the organisation's plan includes: a feature here but not in `features` was withheld by a parent workspace. */
    planFeatures: FeatureKey[];
    /** The plan whose features apply (Free while a paid plan is unpaid or canceled). */
    appliedPlan: string;
  };
  role: string;
  permissions: string[];
  /** The caller's place in the workspace hierarchy (ADR 0071). */
  workspace: {
    id: string;
    level: 'SUPER' | 'MANAGER' | 'EXECUTIVE';
    name: string;
    designation: string;
    actions: Partial<Record<string, string[]>>;
    /** Record fields hidden from this workspace: by the Console for its level (R8, ADR 0092) and by the workspaces above it (ADR 0096). Empty for the Super Workspace. */
    hiddenFields?: string[];
    /** Record fields this workspace sees but may not change (set by the workspace above it; ADR 0096). */
    lockedFields?: string[];
    /** Sections the Console withholds from this level; left out of the menu, search and shortcuts like a switched-off page. */
    hiddenSections?: string[];
  };
  memberships: MembershipSummary[];
  /** How this session signed in. */
  authMethod: 'password' | 'mfa' | 'sso';
  mfaEnabled: boolean;
  /** The workspace's policy is not met yet: only setup screens work until it is. */
  restriction?: 'mfa_enrolment' | 'sso_required' | 'workspace_deactivated';
  /** With workspace_deactivated: the workspace is temporarily blacklisted until this time (ISO). */
  restrictionUntil?: string;
}

/*
 * Password confirmation before destructive actions. Deleting anything that matters asks for the person's password
 * (or two-step code) first: POST /auth/confirm-password answers with a one-time pass, sent back in this header with
 * the delete. The pass works once, for this session only, and lapses after five minutes. The server refuses a
 * destructive request without one, whatever the interface shows.
 */
export const PASSWORD_CONFIRMATION_HEADER = 'x-password-confirmation';
/** The error code of a destructive request that needs (a new) password confirmation. */
export const PASSWORD_CONFIRMATION_REQUIRED = 'PASSWORD_CONFIRMATION_REQUIRED';
/** Minutes a confirmation pass stays valid. */
export const PASSWORD_CONFIRMATION_MINUTES = 5;

export const confirmPasswordSchema = z
  .object({
    password: z.string().max(200).optional(),
    /** A two-step code or recovery code, for accounts that sign in with single sign-on. */
    code: z.string().trim().max(40).optional(),
  })
  .refine((v) => !!v.password || !!v.code, { message: 'Enter your password', path: ['password'] });
export type ConfirmPasswordInput = z.infer<typeof confirmPasswordSchema>;

export interface PasswordConfirmationIssued {
  token: string;
  expiresAt: string;
}
