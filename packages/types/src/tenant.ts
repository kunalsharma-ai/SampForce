import { z } from 'zod';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour such as #00D9FF');

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    brandColor: hexColor.nullable().optional(),
    defaultCurrency: z.string().length(3).toUpperCase().optional(),
    defaultTimezone: z.string().min(1).max(64).optional(),
    defaultLocale: z.string().min(2).max(16).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const updateMemberRoleSchema = z.object({ roleKey: z.string().min(1).max(40) });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

export interface TenantDetails {
  id: string;
  name: string;
  slug: string;
  brandColor: string | null;
  defaultCurrency: string;
  defaultTimezone: string;
  defaultLocale: string;
  isDemo: boolean;
  createdAt: string;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  joinedAt: string;
  status: 'ACTIVE' | 'SUSPENDED';
  /** Two-step verification is on for this person's account. */
  mfaEnabled: boolean;
  /** Managed by the workspace's identity provider through SCIM. */
  provisioned: boolean;
}
