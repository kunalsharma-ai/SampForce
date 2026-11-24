import { z } from 'zod';
import { WORKSPACE_BLACKLIST_MAX_DAYS, type WorkspaceLevel } from './workspaces';

/*
 * Console Workspace Management (workspace management, sections 18-22): every client's Super, Manager and Executive
 * Workspaces in one directory, with their status, and the Console's actions on them. A Super Workspace is its client:
 * suspending it suspends the client, deleting it closes the company (30 days to restore, then erased).
 */

export const CONSOLE_WORKSPACE_STATUSES = ['ACTIVE', 'PENDING', 'SUSPENDED', 'BLACKLISTED', 'DELETED'] as const;
export type ConsoleWorkspaceStatus = (typeof CONSOLE_WORKSPACE_STATUSES)[number];

export const CONSOLE_WORKSPACE_STATUS_LABEL: Record<ConsoleWorkspaceStatus, string> = {
  ACTIVE: 'Active',
  PENDING: 'Pending',
  SUSPENDED: 'Suspended',
  BLACKLISTED: 'Temporarily blacklisted',
  DELETED: 'Deleted',
};

export const CONSOLE_WORKSPACE_STATUS_TEXT: Record<ConsoleWorkspaceStatus, string> = {
  ACTIVE: 'Its people can sign in and work.',
  PENDING: 'Nobody has accepted the invitation yet.',
  SUSPENDED: 'Its people, and everyone below it, cannot work until it is reactivated.',
  BLACKLISTED: 'Blocked until a set day, then it lifts by itself.',
  DELETED: 'Removed. Its records went to the workspace above; it can be restored.',
};

export const consoleWorkspaceQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    level: z.enum(['SUPER', 'MANAGER', 'EXECUTIVE']).optional(),
    status: z.enum(CONSOLE_WORKSPACE_STATUSES).optional(),
    tenantId: z.string().uuid().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type ConsoleWorkspaceQuery = z.infer<typeof consoleWorkspaceQuerySchema>;

export interface ConsoleDirectoryWorkspace {
  /** The workspace id; `root:<clientId>` for a Super Workspace that was never stored. */
  id: string;
  tenantId: string;
  client: string;
  level: WorkspaceLevel;
  name: string;
  designation: string;
  /** The person at its head (the first who joined), or the invited email while nobody has. */
  owner: { name: string; email: string } | null;
  invited: string | null;
  status: ConsoleWorkspaceStatus;
  /** Why it is blocked or removed, when someone said. */
  statusReason: string | null;
  /** A blacklist's end, or for a deleted Super Workspace the day its data is erased. */
  statusUntil: string | null;
  /** The current block was set by the Console: the client cannot lift it. */
  lockedByConsole: boolean;
  /** Whether a deleted workspace can still be restored. */
  restorable: boolean;
  createdAt: string;
  users: number;
  parent: { id: string; name: string; level: WorkspaceLevel } | null;
  permissions: { features: number; deleteAllowed: boolean; createsExecutives: boolean };
}

export interface ConsoleWorkspaceList {
  rows: ConsoleDirectoryWorkspace[];
  total: number;
  page: number;
  pageSize: number;
  /** Over every workspace the filters other than status match, so the status chips show what each would list. */
  counts: Record<ConsoleWorkspaceStatus, number>;
}

export interface ConsoleWorkspaceHistoryEntry {
  at: string;
  action: string;
  /** "Ada Ops (SampForce)" for the Console, the person's name for the client. */
  actor: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'REFUSED';
  detail: string | null;
}

export interface ConsoleWorkspaceDetail extends ConsoleDirectoryWorkspace {
  description: string | null;
  department: string | null;
  people: { name: string; email: string; role: string }[];
  children: { id: string; name: string; level: WorkspaceLevel; status: ConsoleWorkspaceStatus }[];
  /** Feature keys it may use now. */
  features: string[];
  history: ConsoleWorkspaceHistoryEntry[];
}

const reason = z.string().trim().min(3).max(500);
/** The operator's own password: every block and every delete asks for it again. */
const password = z.string().min(1).max(200);

export const consoleWorkspaceEditSchema = z
  .object({ name: z.string().trim().min(2).max(80).optional(), designation: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(500).nullable().optional(), reason })
  .strict();
export type ConsoleWorkspaceEditInput = z.infer<typeof consoleWorkspaceEditSchema>;

export const consoleWorkspaceSuspendSchema = z.object({ reason, password }).strict();
export type ConsoleWorkspaceSuspendInput = z.infer<typeof consoleWorkspaceSuspendSchema>;

export const consoleWorkspaceBlacklistSchema = z
  .object({
    until: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the day the blacklist ends')
      .refine((d) => new Date(`${d}T00:00:00Z`).getTime() <= Date.now() + (WORKSPACE_BLACKLIST_MAX_DAYS + 1) * 86_400_000, 'A blacklist lasts at most a year'),
    reason,
    password,
  })
  .strict();
export type ConsoleWorkspaceBlacklistInput = z.infer<typeof consoleWorkspaceBlacklistSchema>;

export const consoleWorkspaceDeleteSchema = z.object({ confirmName: z.string().trim().min(1).max(120), reason, password }).strict();
export type ConsoleWorkspaceDeleteInput = z.infer<typeof consoleWorkspaceDeleteSchema>;

export const consoleWorkspaceRestoreSchema = z.object({ reason }).strict();
export type ConsoleWorkspaceRestoreInput = z.infer<typeof consoleWorkspaceRestoreSchema>;
