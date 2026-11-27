import type { TenantTx } from '@dealflow/database';
import type { AuthContext } from '../common/auth-context';
import { callerOf } from '../workspace-work/hierarchy';
import { resolveOrganisation } from '../workspaces/access';

/** True when the caller works in the Super Workspace (or the organisation has no hierarchy): organisation-wide CRM settings are set there. */
export async function inSuperWorkspace(tx: TenantTx, auth: AuthContext): Promise<boolean> {
  if (!auth.workspaceNodeId) return true;
  const org = await resolveOrganisation(tx, auth.tenantId);
  return callerOf(auth, org).level === 'SUPER';
}
