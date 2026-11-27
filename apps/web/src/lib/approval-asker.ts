/*
 * Delete approvals (ADR 0097). The server answers an Executive Workspace's delete with 403 APPROVAL_REQUIRED; `api()`
 * then asks whoever registered here (the dialog the app shell mounts) to send the request to the manager. Kept free of
 * React so `api()` can use it, like the password confirmation.
 */

export interface ApprovalAsk {
  method: string;
  /** The API path after /api/v1, with its query string. */
  path: string;
  body: unknown;
  category: 'delete' | 'record_edit';
  recordTypeLabel: string | null;
  recordName: string | null;
  recordCount: number | null;
  /** The same request already waiting. */
  pendingId: string | null;
  message: string;
}

/** Resolves once the person sent the request (true) or closed the dialog (false). */
export type ApprovalAsker = (ask: ApprovalAsk) => Promise<boolean>;

let asker: ApprovalAsker | null = null;

export function setApprovalAsker(next: ApprovalAsker | null): void {
  asker = next;
}

export function approvalAsker(): ApprovalAsker | null {
  return asker;
}

/** Reads the 403's details into the ask. */
export function approvalAskOf(method: string, path: string, body: unknown, message: string, details: { path: string; message: string }[] | undefined): ApprovalAsk {
  const d = Object.fromEntries((details ?? []).map((x) => [x.path, x.message]));
  return {
    method,
    path,
    body,
    category: d.category === 'record_edit' ? 'record_edit' : 'delete',
    recordTypeLabel: d.recordTypeLabel ?? null,
    recordName: d.recordName ?? null,
    recordCount: d.recordCount ? Number(d.recordCount) : null,
    pendingId: d.pendingId ?? null,
    message,
  };
}
