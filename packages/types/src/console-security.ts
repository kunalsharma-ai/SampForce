import { z } from 'zod';
import { emailSchema } from './auth';

/**
 * Console Admin roles and permissions (ADR 0074). Every operator route asks for one permission; an operator holds the
 * permissions of their role. Six roles are built in and cannot be changed; Super Admins can add custom roles with any
 * set. A role that can change something can always see it (an edit permission brings the matching view permission).
 */

export const OPERATOR_PERMISSIONS = [
  'clients.view',
  'clients.edit',
  'clients.status',
  'subscriptions.manage',
  'billing.view',
  'billing.manage',
  'plans.manage',
  'workspaces.view',
  'workspaces.manage',
  'users.view',
  'users.manage',
  'users.export',
  'features.manage',
  'mobile.manage',
  'support.handle',
  'audit.view',
  'operators.manage',
  'providers.manage',
  'settings.manage',
  'security.manage',
  'system.view',
  'notifications.broadcast',
] as const;
export type OperatorPermission = (typeof OPERATOR_PERMISSIONS)[number];

export interface OperatorPermissionDef {
  key: OperatorPermission;
  group: 'Clients' | 'Commercial' | 'People and workspaces' | 'Product' | 'Support' | 'Platform';
  label: string;
  description: string;
}

export const OPERATOR_PERMISSION_DEFS: OperatorPermissionDef[] = [
  { key: 'clients.view', group: 'Clients', label: 'See clients', description: 'Client list, profiles, subscriptions and the overview.' },
  { key: 'clients.edit', group: 'Clients', label: 'Edit clients', description: 'Create clients, change their details and authority.' },
  { key: 'clients.status', group: 'Clients', label: 'Suspend and reactivate', description: 'Suspend, deactivate or reactivate a client.' },
  { key: 'subscriptions.manage', group: 'Commercial', label: 'Manage subscriptions', description: 'Change plans, seats, trials and renewals.' },
  { key: 'billing.view', group: 'Commercial', label: 'See billing', description: 'Invoices, payments and revenue figures.' },
  { key: 'billing.manage', group: 'Commercial', label: 'Manage billing', description: 'Record payments, void invoices, refunds and credits.' },
  { key: 'plans.manage', group: 'Commercial', label: 'Manage plans', description: 'Create and change plans, prices and limits.' },
  { key: 'workspaces.view', group: 'People and workspaces', label: 'See workspaces', description: 'The workspace directory of every client.' },
  { key: 'workspaces.manage', group: 'People and workspaces', label: 'Manage workspaces', description: 'Workspace rules and allocations.' },
  { key: 'users.view', group: 'People and workspaces', label: 'See people', description: 'The people directory: names, emails and roles.' },
  { key: 'users.manage', group: 'People and workspaces', label: 'Manage people', description: 'Invite administrators and change a person’s access.' },
  { key: 'users.export', group: 'People and workspaces', label: 'Export people', description: 'Download the people directory.' },
  { key: 'features.manage', group: 'Product', label: 'Manage features', description: 'Feature overrides, labels and kill switches.' },
  { key: 'mobile.manage', group: 'Product', label: 'Manage the mobile app', description: 'Approve mobile access and set seat and device limits.' },
  { key: 'support.handle', group: 'Support', label: 'Handle support', description: 'Support tickets, support chat and help feedback.' },
  { key: 'audit.view', group: 'Platform', label: 'See the audit log', description: 'Everything operators have done in the Console.' },
  { key: 'operators.manage', group: 'Platform', label: 'Manage operators', description: 'Add operators, change their role, disable them.' },
  { key: 'providers.manage', group: 'Platform', label: 'Manage providers', description: 'Provider keys and connection checks.' },
  { key: 'settings.manage', group: 'Platform', label: 'Manage settings', description: 'Platform settings and help content.' },
  { key: 'security.manage', group: 'Platform', label: 'Manage security', description: 'Sign-in policy, sessions of other operators.' },
  { key: 'system.view', group: 'Platform', label: 'See system health', description: 'Providers, settings and system status, read only.' },
  { key: 'notifications.broadcast', group: 'Platform', label: 'Send announcements', description: 'Notices to clients and their people.' },
];

/** Edit permissions and the view permission each one brings with it. */
export const PERMISSION_IMPLIES: Partial<Record<OperatorPermission, OperatorPermission[]>> = {
  'clients.edit': ['clients.view'],
  'clients.status': ['clients.view'],
  'subscriptions.manage': ['clients.view'],
  'billing.manage': ['billing.view'],
  'workspaces.manage': ['workspaces.view'],
  'users.manage': ['users.view'],
  'users.export': ['users.view'],
  'providers.manage': ['system.view'],
  'settings.manage': ['system.view'],
};

/** A permission set with every implied view permission added, in catalogue order. */
export function expandPermissions(perms: readonly string[]): OperatorPermission[] {
  const out = new Set<OperatorPermission>();
  for (const p of perms) {
    if (!(OPERATOR_PERMISSIONS as readonly string[]).includes(p)) continue;
    out.add(p as OperatorPermission);
    for (const q of PERMISSION_IMPLIES[p as OperatorPermission] ?? []) out.add(q);
  }
  return OPERATOR_PERMISSIONS.filter((p) => out.has(p));
}

export const BUILT_IN_OPERATOR_ROLES = ['super_admin', 'finance', 'support', 'sales', 'operations', 'read_only'] as const;
export type BuiltInOperatorRole = (typeof BUILT_IN_OPERATOR_ROLES)[number];

export interface OperatorRoleDef {
  /** A built-in key, or the id of a custom role. */
  key: string;
  name: string;
  description: string;
  builtIn: boolean;
  permissions: OperatorPermission[];
}

const P = OPERATOR_PERMISSIONS;
export const BUILT_IN_ROLE_DEFS: Record<BuiltInOperatorRole, OperatorRoleDef> = {
  super_admin: { key: 'super_admin', name: 'Super Admin', description: 'Everything in the Console, including operators and security.', builtIn: true, permissions: [...P] },
  finance: {
    key: 'finance', name: 'Finance Admin', description: 'Subscriptions, invoices and payments.', builtIn: true,
    permissions: expandPermissions(['clients.view', 'clients.status', 'subscriptions.manage', 'billing.view', 'billing.manage', 'audit.view']),
  },
  support: {
    key: 'support', name: 'Support Admin', description: 'Tickets, chat and help for clients and their people.', builtIn: true,
    permissions: expandPermissions(['clients.view', 'workspaces.view', 'users.view', 'users.manage', 'support.handle', 'system.view', 'notifications.broadcast']),
  },
  sales: {
    key: 'sales', name: 'Sales Admin', description: 'New clients, plans, subscriptions and features.', builtIn: true,
    permissions: expandPermissions(['clients.view', 'clients.edit', 'subscriptions.manage', 'billing.view', 'plans.manage', 'workspaces.view', 'features.manage', 'notifications.broadcast']),
  },
  operations: {
    key: 'operations', name: 'Operations Admin', description: 'Client setup, workspaces, people, features and the mobile app.', builtIn: true,
    permissions: expandPermissions(['clients.view', 'clients.edit', 'clients.status', 'workspaces.view', 'workspaces.manage', 'users.view', 'users.manage', 'features.manage', 'mobile.manage', 'audit.view', 'system.view']),
  },
  read_only: {
    key: 'read_only', name: 'Read-only', description: 'Sees clients, billing, workspaces, people and the audit log; changes nothing.', builtIn: true,
    permissions: expandPermissions(['clients.view', 'billing.view', 'workspaces.view', 'users.view', 'audit.view', 'system.view']),
  },
};

export function isBuiltInRole(key: string): key is BuiltInOperatorRole {
  return (BUILT_IN_OPERATOR_ROLES as readonly string[]).includes(key);
}

/** The older two-value role: Super Admins are ADMIN (the CLI and the last-admin guard use it), everyone else SUPPORT. */
export function legacyOperatorRole(roleKey: string): 'ADMIN' | 'SUPPORT' {
  return roleKey === 'super_admin' ? 'ADMIN' : 'SUPPORT';
}

/** The role key of an operator whose role was never set in the Console (created by the CLI before ADR 0074). */
export function defaultRoleKey(legacy: 'ADMIN' | 'SUPPORT'): BuiltInOperatorRole {
  return legacy === 'ADMIN' ? 'super_admin' : 'support';
}

// ───── API shapes ─────

const permissionList = z.array(z.enum(OPERATOR_PERMISSIONS)).max(OPERATOR_PERMISSIONS.length);

export const operatorRoleInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Give the role a name of at least 2 characters.').max(60),
    description: z.string().trim().max(200).default(''),
    permissions: permissionList.min(1, 'Choose at least one permission.'),
  })
  .strict();
export type OperatorRoleInput = z.input<typeof operatorRoleInputSchema>;
export const operatorRoleUpdateSchema = operatorRoleInputSchema.partial().strict();
export type OperatorRoleUpdate = z.input<typeof operatorRoleUpdateSchema>;

export interface OperatorRoleRow extends OperatorRoleDef {
  /** Operators with this role, active or disabled. */
  operators: number;
}

export const operatorInviteSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    role: z.string().trim().min(1).max(64),
  })
  .strict();
export type OperatorInviteInput = z.infer<typeof operatorInviteSchema>;

export const operatorUpdateSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120),
    role: z.string().trim().min(1).max(64),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .partial()
  .strict();
export type OperatorUpdateInput = z.infer<typeof operatorUpdateSchema>;

export interface ConsoleOperatorRow {
  id: string;
  email: string;
  name: string;
  role: string;
  roleName: string;
  status: 'ACTIVE' | 'DISABLED' | 'INVITED';
  lastLoginAt: string | null;
  createdAt: string;
  /** Two-step verification is on (ADR 0074 operator security). */
  mfaEnabled: boolean;
}

/** An invitation link for a new operator, or a fresh one; shown to the inviter once when email cannot be sent. */
export interface OperatorInviteResult {
  operator: ConsoleOperatorRow;
  /** Whether the link went out by email. */
  emailed: boolean;
  /** The link to set a password, valid for 72 hours; returned only when it was not emailed. */
  link: string | null;
  expiresAt: string;
}

/** Choosing a password from an invitation or reset link. */
export const OPERATOR_PASSWORD_MIN = 12;
export const operatorPasswordSchema = z
  .string()
  .min(OPERATOR_PASSWORD_MIN, 'Use at least 12 characters.')
  .max(200)
  .refine((p) => /[a-zA-Z]/.test(p) && /[^a-zA-Z]/.test(p), 'Use letters and at least one number or symbol.');

export const operatorSetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: operatorPasswordSchema })
  .strict();
export type OperatorSetPasswordInput = z.infer<typeof operatorSetPasswordSchema>;

export interface OperatorTokenInfo {
  purpose: 'invite' | 'reset';
  email: string;
  name: string;
  expiresAt: string;
}
