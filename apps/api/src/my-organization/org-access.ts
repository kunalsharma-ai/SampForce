import { ForbiddenException } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import type { OrgAccess, OrgCredentialAccess, OrgDocumentVisibility } from '@dealflow/types';
import type { AuthContext } from '../common/auth-context';
import { callerOf } from '../workspace-work/hierarchy';
import { resolveOrganisation } from '../workspaces/access';

/*
 * Who may do what in My Organization (ADR 0100). Worked out from the caller's workspace and the actions the workspace
 * above handed down for the Administration module in the Permission Center, on every request, so a direct API call
 * meets the same answer as the screen.
 */

/** Roles that only read (Viewer) never change the organisation's record, whatever their workspace may do. */
function roleWrites(auth: AuthContext): boolean {
  return auth.permissions.includes('tenant:manage') || auth.permissions.includes('companies:write');
}

export async function orgAccessOf(tx: TenantTx, auth: AuthContext): Promise<OrgAccess> {
  const org = await resolveOrganisation(tx, auth.tenantId);
  const me = callerOf(auth, org);
  const admin = me.actions.Administration ?? [];
  const writes = roleWrites(auth);
  // The Super Workspace is never limited (ADR 0096); the others follow what they were handed down.
  const superWs = me.level === 'SUPER';
  return {
    level: me.level,
    canEdit: writes && (superWs || admin.includes('edit')),
    canDelete: writes && (superWs || admin.includes('delete')),
    canManageCredentials: writes && (superWs || (me.level === 'MANAGER' && admin.includes('manage'))),
    canSeeCredentials: writes && me.level !== 'EXECUTIVE',
    canShare: true,
  };
}

/** Document audiences the caller is part of. */
export function visibleAudiences(access: OrgAccess): OrgDocumentVisibility[] {
  if (access.level === 'SUPER') return ['ALL', 'MANAGERS', 'SUPER'];
  if (access.level === 'MANAGER') return ['ALL', 'MANAGERS'];
  return ['ALL'];
}

export function credentialAudiences(access: OrgAccess): OrgCredentialAccess[] {
  if (!access.canSeeCredentials) return [];
  return access.level === 'SUPER' ? ['SUPER', 'MANAGERS'] : ['MANAGERS'];
}

const forbid = (message: string) => new ForbiddenException({ code: 'ACTION_NOT_GRANTED', message });

export function assertEdit(access: OrgAccess): void {
  if (!access.canEdit) throw forbid('Your workspace may view My Organization but not change it. Ask the workspace above yours for Edit on Administration.');
}

export function assertDelete(access: OrgAccess): void {
  if (!access.canDelete) throw forbid('Your workspace may not delete in My Organization. Ask the workspace above yours for Delete on Administration.');
}

export function assertCredentials(access: OrgAccess): void {
  if (!access.canManageCredentials) throw forbid('Only the Super Workspace, and Manager Workspaces allowed to manage administration, can change credentials.');
}
