import { z } from 'zod';
import { FEATURE_BY_KEY, FEATURE_GROUPS, FEATURE_KEYS, type FeatureGroup, type FeatureKey, featureKeySchema, normaliseFeatures, withParents } from './features';

/*
 * The four-level workspace hierarchy (ADR 0071).
 *
 * Console Admin (platform staff, the operator console) → Super Workspace (one per client organisation, the root) →
 * Manager Workspaces → Executive Workspaces. Every workspace of an organisation shares its CRM data; a workspace
 * narrows what its people may see and do with two kinds of grant:
 *
 *  - features: which catalogue features (modules, features, subfeatures) the workspace has;
 *  - actions: what its people may do within them, per module (catalogue group) and optionally per feature.
 *
 * A child's grant is always intersected with its parent's effective grant, recomputed on every request, so nothing
 * is copied down and a revocation anywhere applies to the whole branch below at once.
 */

export const WORKSPACE_LEVELS = ['SUPER', 'MANAGER', 'EXECUTIVE'] as const;
export type WorkspaceLevel = (typeof WORKSPACE_LEVELS)[number];
export const workspaceLevelSchema = z.enum(WORKSPACE_LEVELS);

/** The designation shown with a workspace until its creator names another. */
export const DEFAULT_WORKSPACE_DESIGNATION: Record<WorkspaceLevel, string> = {
  SUPER: 'Client Administrator',
  MANAGER: 'Sales Manager',
  EXECUTIVE: 'Sales Executive',
};

export const WORKSPACE_LEVEL_LABEL: Record<WorkspaceLevel, string> = {
  SUPER: 'Super Workspace',
  MANAGER: 'Manager Workspace',
  EXECUTIVE: 'Executive Workspace',
};

export const WORKSPACE_ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'assign', 'approve', 'manage', 'configure', 'reports', 'cross_workspace'] as const;
export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];
export const workspaceActionSchema = z.enum(WORKSPACE_ACTIONS);

export const WORKSPACE_ACTION_LABEL: Record<WorkspaceAction, string> = {
  view: 'View',
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
  assign: 'Assign',
  approve: 'Approve',
  manage: 'Manage',
  configure: 'Configure',
  reports: 'Access reports',
  cross_workspace: 'Access other workspaces',
};

/** A module is a catalogue group; action grants are kept per module, and may be narrowed per feature key. */
export type WorkspaceModule = FeatureGroup;
export const WORKSPACE_MODULES: readonly WorkspaceModule[] = FEATURE_GROUPS;

/** Actions per module (a FeatureGroup) or per feature key. A key that is missing means "nothing" below the root. */
export type ActionGrants = Partial<Record<string, WorkspaceAction[]>>;

const ACTION_KEYS = new Set<string>([...FEATURE_GROUPS, ...FEATURE_KEYS]);
export const actionGrantsSchema = z
  .record(z.string(), z.array(workspaceActionSchema).max(WORKSPACE_ACTIONS.length))
  .refine((g) => Object.keys(g).every((k) => ACTION_KEYS.has(k)), 'Unknown module or feature');

/** Every action on every module: what the root has when the Console sets no ceiling. */
export function allActions(): ActionGrants {
  return Object.fromEntries(FEATURE_GROUPS.map((g) => [g, [...WORKSPACE_ACTIONS]]));
}

/** Keeps known actions in catalogue order, without duplicates. */
export function normaliseActions(list: readonly string[]): WorkspaceAction[] {
  const set = new Set(list);
  return WORKSPACE_ACTIONS.filter((a) => set.has(a));
}

/** Reads a stored grant leniently: unknown keys and actions are dropped. */
export function parseActionGrants(stored: unknown): ActionGrants {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
  const out: ActionGrants = {};
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!ACTION_KEYS.has(k) || !Array.isArray(v)) continue;
    out[k] = normaliseActions(v.filter((a): a is string => typeof a === 'string'));
  }
  return out;
}

/**
 * A child's effective actions: for every module and feature key, what it was granted AND what its parent has.
 * A feature-level entry only narrows; it never adds actions its module does not have.
 */
export function intersectActions(parent: ActionGrants, own: ActionGrants): ActionGrants {
  const out: ActionGrants = {};
  for (const key of Object.keys(own)) {
    const mine = own[key] ?? [];
    const theirs = parent[key] ?? (FEATURE_GROUPS.includes(key as FeatureGroup) ? [] : moduleActions(parent, key));
    out[key] = mine.filter((a) => theirs.includes(a));
  }
  // A feature-level narrowing on the parent still applies to the child.
  for (const key of Object.keys(parent)) {
    if (key in out || FEATURE_GROUPS.includes(key as FeatureGroup)) continue;
    out[key] = [...(parent[key] ?? [])];
  }
  return out;
}

function moduleActions(grants: ActionGrants, featureKey: string): WorkspaceAction[] {
  const group = FEATURE_BY_KEY[featureKey as FeatureKey]?.group;
  return group ? (grants[group] ?? []) : [];
}

/** Whether `grants` allow `action` on `feature`: its module allows it and no feature-level entry takes it away. */
export function actionAllowed(grants: ActionGrants, feature: FeatureKey, action: WorkspaceAction): boolean {
  const group = FEATURE_BY_KEY[feature].group;
  if (!(grants[group] ?? []).includes(action)) return false;
  const narrowed = grants[feature];
  return !narrowed || narrowed.includes(action);
}

/** Actions a new child gets unless its creator chooses: everything its parent has, minus what each level never needs. */
export function defaultChildActions(level: Exclude<WorkspaceLevel, 'SUPER'>, parent: ActionGrants): ActionGrants {
  const keep: Record<Exclude<WorkspaceLevel, 'SUPER'>, readonly WorkspaceAction[]> = {
    MANAGER: ['view', 'create', 'edit', 'delete', 'export', 'assign', 'approve', 'manage', 'reports'],
    EXECUTIVE: ['view', 'create', 'edit', 'delete', 'reports'],
  };
  const out: ActionGrants = {};
  for (const [key, list] of Object.entries(parent)) {
    let allowed = (list ?? []).filter((a) => keep[level].includes(a));
    // Executives only look at administration (their own profile, targets and tasks); they never run it.
    if (level === 'EXECUTIVE' && key === 'Administration') allowed = allowed.filter((a) => a === 'view');
    out[key] = allowed;
  }
  return out;
}

/** A child's effective features: its own grant that its parent also has, without orphaned subfeatures. */
export function intersectFeatures(parent: readonly FeatureKey[], own: readonly string[]): FeatureKey[] {
  const p = new Set(parent);
  return withParents(normaliseFeatures(own).filter((k) => p.has(k)));
}

// ───────────── API shapes ─────────────

const name = z.string().trim().min(2).max(80);
const designation = z.string().trim().min(2).max(80);

/** Fill a new workspace: invite someone by email, or move a member of the organisation into it. */
export const workspacePersonSchema = z.union([
  z.object({ inviteEmail: z.string().trim().toLowerCase().email().max(254), roleKey: z.string().trim().min(2).max(64).optional() }).strict(),
  z.object({ userId: z.string().uuid() }).strict(),
]);

export const createWorkspaceSchema = z
  .object({
    level: z.enum(['MANAGER', 'EXECUTIVE']),
    name,
    designation: designation.optional(),
    /** Executive Workspaces: the Manager Workspace it reports to; omitted = directly under the Super Workspace. */
    parentId: z.string().uuid().optional(),
    /** Omitted = everything the parent has. */
    features: z.array(featureKeySchema).max(FEATURE_KEYS.length).optional(),
    actions: actionGrantsSchema.optional(),
    person: workspacePersonSchema.optional(),
  })
  .strict();
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({ name: name.optional(), designation: designation.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one thing');
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

/** What a parent hands down to one child. Only the parent level may change it; nobody changes their own. */
export const workspacePermissionsSchema = z
  .object({
    features: z.array(featureKeySchema).max(FEATURE_KEYS.length).optional(),
    actions: actionGrantsSchema.optional(),
    /** Manager Workspaces only, set by the Super Workspace. */
    canCreateExecutives: z.boolean().optional(),
    canViewOtherManagers: z.boolean().optional(),
    /** Manager and Executive Workspaces, set by their parent: chat with workspaces of the same level. */
    canChatWithPeers: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'Change at least one permission');
export type WorkspacePermissionsInput = z.infer<typeof workspacePermissionsSchema>;

export const moveWorkspaceSchema = z.object({ parentId: z.string().uuid().nullable() }).strict();
export type MoveWorkspaceInput = z.infer<typeof moveWorkspaceSchema>;

export const assignWorkspaceMemberSchema = z.object({ userId: z.string().uuid() }).strict();
export type AssignWorkspaceMemberInput = z.infer<typeof assignWorkspaceMemberSchema>;

export interface WorkspacePerson {
  userId: string;
  name: string;
  email: string;
}

export interface WorkspaceUsage {
  managers: { used: number; max: number | null };
  executives: { used: number; max: number | null };
}

export interface WorkspaceRow {
  id: string;
  /** The organisation (tenant) id. */
  organizationId: string;
  level: WorkspaceLevel;
  name: string;
  designation: string;
  parentId: string | null;
  people: WorkspacePerson[];
  /** Invitations sent into it and not accepted yet. */
  pendingInvites: string[];
  /** What the workspace may use now (after inheritance). */
  features: FeatureKey[];
  actions: ActionGrants;
  /** Features its parent has that were not handed to it: shown as restricted, grantable by the parent. */
  restrictedFeatures: FeatureKey[];
  canCreateExecutives: boolean;
  canViewOtherManagers: boolean;
  /** Managers: may chat with other managers. Executives: with the other executives of their team. */
  canChatWithPeers: boolean;
  /** Whether the caller may change what this workspace is granted (they are its parent level). */
  editable: boolean;
  createdAt: string;
}

export interface WorkspaceTree {
  organization: { id: string; name: string };
  usage: WorkspaceUsage;
  /** The caller's own workspace and what they may do here. */
  mine: WorkspaceRow;
  canCreate: { managers: boolean; executives: boolean };
  /** Workspaces the caller can see: the whole organisation for the Super Workspace, the branch below a manager. */
  workspaces: WorkspaceRow[];
}

/** The caller's identity in the hierarchy, shown in the header and the profile (ADR 0071). */
export interface WorkspaceIdentity {
  id: string;
  level: WorkspaceLevel;
  levelLabel: string;
  name: string;
  /** The workspace's designation (system access), not the person's job title. */
  designation: string;
  organizationId: string;
  organizationName: string;
  /** The person's job title from the organisation's designations; never grants anything. */
  jobTitle: string | null;
  reportingManager: { id: string; name: string } | null;
  parent: { id: string; name: string; level: WorkspaceLevel } | null;
  actions: ActionGrants;
}
