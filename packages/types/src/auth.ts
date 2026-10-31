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
}

export interface MeResponse {
  user: SessionUser;
  tenant: { id: string; name: string; slug: string; plan: string; isDemo: boolean; brandColor: string | null };
  role: string;
  permissions: string[];
  memberships: MembershipSummary[];
  /** How this session signed in. */
  authMethod: 'password' | 'mfa' | 'sso';
  mfaEnabled: boolean;
  /** The workspace's policy is not met yet: only setup screens work until it is. */
  restriction?: 'mfa_enrolment' | 'sso_required';
}
