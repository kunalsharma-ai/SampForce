import type { TenantTx } from '@dealflow/database';
import { ForbiddenException } from '@nestjs/common';
import type { WorkspaceLevel } from '@dealflow/types';
import { resolveOrganisation, resolveWorkspaceAccess } from '../workspaces/access';

/*
 * Who may chat with the SampBidx team (ADR 0077). The `sampbidx_chat` feature runs down the workspace hierarchy like
 * every other module: the Console Admin allows it for an organisation (its Super Workspace), the Super Workspace hands
 * it down to Manager Workspaces, and they to Executive Workspaces. Switched off at any level, it is off below. The
 * SampBidx app itself (`sampbidx`) must be there too, since the messages travel through its connection.
 */

/** directKey of the general line to the SampBidx team; a workspace has one. */
export const SAMPBIDX_GENERAL_KEY = 'sampbidx';
export const SAMPBIDX_GENERAL_TITLE = 'SampBidx team';
/** directKey of the chat about one transfer (one RFQ or RFQ email sent to SampBidx). */
export const sampbidxTransferKey = (transferId: string) => `sampbidx:${transferId}`;

type Reader = Parameters<typeof resolveOrganisation>[0];

/** Whether a workspace of the hierarchy (null = the Super Workspace) has SampBidx chat. */
export async function sampbidxChatAllowed(tx: Reader, tenantId: string, nodeId: string | null | undefined): Promise<boolean> {
  const access = await resolveWorkspaceAccess(tx, tenantId, nodeId);
  return access.features.includes('sampbidx_chat') && access.features.includes('sampbidx');
}

export function sampbidxChatRefused(): ForbiddenException {
  return new ForbiddenException({
    code: 'FEATURE_NOT_GRANTED',
    message: 'Chat with SampBidx team is not available in your workspace. Ask the administrator of the workspace above yours.',
    details: [{ path: 'feature', message: 'sampbidx_chat' }],
  });
}

export interface SampbidxChatMember {
  userId: string;
  name: string;
  email: string;
  role: string | null;
  workspace: string;
  level: WorkspaceLevel;
}

/** Everyone active in the organisation whose workspace has SampBidx chat now. */
export async function sampbidxChatMembers(tx: TenantTx, tenantId: string): Promise<SampbidxChatMember[]> {
  const org = await resolveOrganisation(tx, tenantId);
  const has = (features: string[]) => features.includes('sampbidx_chat') && features.includes('sampbidx');
  if (!has(org.root.features) && ![...org.byId.values()].some((a) => has(a.features))) return [];
  const rows = await tx.membership.findMany({
    where: { tenantId, status: 'ACTIVE', user: { status: 'ACTIVE' } },
    include: { user: { select: { id: true, name: true, email: true } }, role: { select: { name: true } } },
  });
  const out: SampbidxChatMember[] = [];
  for (const r of rows) {
    const access = r.workspaceNodeId ? (org.byId.get(r.workspaceNodeId) ?? null) : org.root;
    if (!access || !has(access.features)) continue;
    out.push({ userId: r.user.id, name: r.user.name, email: r.user.email, role: r.role?.name ?? null, workspace: access.node.name, level: access.level });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
