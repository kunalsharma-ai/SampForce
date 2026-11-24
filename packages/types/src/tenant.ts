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
  designation: { id: string; name: string; tier: 'EXECUTIVE' | 'MANAGER' | 'SENIOR' } | null;
  department: { id: string; name: string } | null;
  reportingManager: { id: string; name: string } | null;
}

/**
 * Removing a person from the workspace (Team Management): their sign-in here stops, their records go to the person
 * chosen, and their invitations are deleted. Their account and the history of what they did stay.
 */
export const removeMemberSchema = z
  .object({ handoverToUserId: z.string().uuid().nullable().optional() })
  .optional()
  .transform((v) => v ?? {});
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;

/** What removing a person would touch, shown before the owner confirms. */
export interface MemberRemovalImpact {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  roleName: string;
  /** Records they own (not deleted) and their open tasks, which go to the person chosen. */
  records: { companies: number; contacts: number; leads: number; deals: number; rfqs: number; contracts: number; openTasks: number };
  /** Invitation rows for their email in this workspace, deleted with them. */
  invitations: number;
  /** Active members who can receive the records (everyone but the person removed). */
  handoverOptions: { userId: string; name: string; email: string }[];
  /** True when they own records or open tasks, so a receiver must be chosen. */
  handoverRequired: boolean;
}

/** What a removal did, for the confirmation message. */
export interface MemberRemoved {
  name: string;
  email: string;
  handoverTo: string | null;
  recordsMoved: number;
  invitationsDeleted: number;
  sessionsEnded: number;
}
