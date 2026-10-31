/**
 * Permission catalogue. Permissions are coarse "resource:action" strings so they can be
 * stored on tenant roles, checked in API guards and mirrored in the UI.
 */
export const PERMISSIONS = [
  'tenant:read',
  'tenant:manage',
  'members:read',
  'members:manage',
  'audit:read',
  'dashboard:read',
  'leads:read',
  'leads:write',
  'contacts:read',
  'contacts:write',
  'companies:read',
  'companies:write',
  'deals:read',
  'deals:write',
  'pipelines:read',
  'pipelines:manage',
  'activities:read',
  'activities:write',
  'billing:read',
  'billing:manage',
  'integrations:manage',
  'automation:manage',
  'ai:use',
  'ai:manage',
  'data:export',
  'catalog:manage',
  'quotes:read',
  'quotes:write',
  'quotes:approve',
  'contracts:read',
  'contracts:write',
  'marketing:read',
  'marketing:manage',
  'success:read',
  'success:write',
  'reports:read',
  'reports:write',
  'reports:manage',
  'sequences:read',
  'sequences:write',
  'gamification:read',
  'gamification:manage',
  'visitors:read',
  'visitors:manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[number];

const READ_ONLY: Permission[] = PERMISSIONS.filter((p) => p.endsWith(':read'));

const MEMBER: Permission[] = [
  ...READ_ONLY.filter((p) => !['audit:read', 'billing:read'].includes(p)),
  'leads:write',
  'contacts:write',
  'companies:write',
  'deals:write',
  'activities:write',
  'ai:use',
  'quotes:write',
  'contracts:write',
  'success:write',
  'reports:write',
  'sequences:write',
];

const MANAGER: Permission[] = [...MEMBER, 'pipelines:manage', 'automation:manage', 'audit:read', 'catalog:manage', 'quotes:approve', 'marketing:manage', 'reports:manage', 'gamification:manage', 'visitors:manage'];

const ADMIN: Permission[] = PERMISSIONS.filter((p) => p !== 'billing:manage');

export const SYSTEM_ROLE_DEFINITIONS: Record<
  SystemRoleKey,
  { name: string; description: string; permissions: Permission[] }
> = {
  owner: {
    name: 'Owner',
    description: 'Full control of the workspace, including billing and ownership transfer.',
    permissions: [...PERMISSIONS],
  },
  admin: {
    name: 'Administrator',
    description: 'Manages workspace settings, members, integrations and automation.',
    permissions: ADMIN,
  },
  manager: {
    name: 'Sales Manager',
    description: 'Manages pipelines and automations and can review the audit log.',
    permissions: MANAGER,
  },
  member: {
    name: 'Sales Representative',
    description: 'Works leads, contacts, companies, deals and activities.',
    permissions: MEMBER,
  },
  viewer: {
    name: 'Viewer',
    description: 'Read-only access to CRM records and dashboards.',
    permissions: READ_ONLY.filter((p) => !['audit:read', 'billing:read'].includes(p)),
  },
};

export function hasPermission(granted: readonly string[], required: Permission): boolean {
  return granted.includes(required);
}
