import { z } from 'zod';
import { FEATURE_BY_KEY, FEATURE_GROUPS, type FeatureGroup, type FeatureKey } from './features';
import type { ActionGrants } from './workspaces';

/*
 * Console rules for workspaces (workspace redesign W3, ADR 0074). The Console Admin sets them per plan and may
 * override them for one client. They are limits: a Super Workspace chooses within them and can never go beyond.
 * They never create or remove a Super Workspace.
 */

export const RULE_LEVELS = ['SUPER', 'MANAGER', 'EXECUTIVE'] as const;
export type RuleLevel = (typeof RULE_LEVELS)[number];

export interface WorkspaceRules {
  /** Whether Manager Workspaces may be given Delete at all. */
  managerDelete: boolean;
  /** Whether Executive Workspaces may be given Delete at all. */
  executiveDelete: boolean;
  /** The modules Manager Workspaces may use; the rest are withheld whatever the Super Workspace grants. */
  managerModules: FeatureGroup[];
  /** The modules Executive Workspaces may use. */
  executiveModules: FeatureGroup[];
  /** Two-step sign-in required for the people of each level. */
  mfaRequired: Record<RuleLevel, boolean>;
}

/** What applies when the Console has set nothing: no extra limits. */
export const DEFAULT_WORKSPACE_RULES: WorkspaceRules = {
  managerDelete: true,
  executiveDelete: true,
  managerModules: [...FEATURE_GROUPS],
  executiveModules: [...FEATURE_GROUPS],
  mfaRequired: { SUPER: false, MANAGER: false, EXECUTIVE: false },
};

const modules = z.array(z.enum(FEATURE_GROUPS)).max(FEATURE_GROUPS.length);
const mfa = z.object({ SUPER: z.boolean(), MANAGER: z.boolean(), EXECUTIVE: z.boolean() }).strict();

export const workspaceRulesSchema = z
  .object({ managerDelete: z.boolean(), executiveDelete: z.boolean(), managerModules: modules, executiveModules: modules, mfaRequired: mfa })
  .strict();

/** A client override: only the rules it changes. Null in place of the whole override returns the client to its plan. */
export const workspaceRulesOverrideSchema = z
  .object({
    managerDelete: z.boolean().optional(),
    executiveDelete: z.boolean().optional(),
    managerModules: modules.optional(),
    executiveModules: modules.optional(),
    mfaRequired: mfa.partial().optional(),
  })
  .strict();
export type WorkspaceRulesOverride = z.infer<typeof workspaceRulesOverrideSchema>;

export const putPlanWorkspaceRulesSchema = z.object({ rules: workspaceRulesSchema, reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict();
export type PutPlanWorkspaceRules = z.infer<typeof putPlanWorkspaceRulesSchema>;
export const putClientWorkspaceRulesSchema = z
  .object({ override: workspaceRulesOverrideSchema.nullable(), reason: z.string().trim().min(3, 'Give a reason').max(300) })
  .strict();
export type PutClientWorkspaceRules = z.infer<typeof putClientWorkspaceRulesSchema>;

const keepOrder = (list: readonly string[]): FeatureGroup[] => FEATURE_GROUPS.filter((g) => list.includes(g));

/** Reads stored rules leniently over the defaults (unknown modules dropped). */
export function parseWorkspaceRules(stored: unknown, base: WorkspaceRules = DEFAULT_WORKSPACE_RULES): WorkspaceRules {
  const parsed = workspaceRulesOverrideSchema.safeParse(stored);
  const o: WorkspaceRulesOverride = parsed.success ? parsed.data : {};
  return {
    managerDelete: o.managerDelete ?? base.managerDelete,
    executiveDelete: o.executiveDelete ?? base.executiveDelete,
    managerModules: o.managerModules ? keepOrder(o.managerModules) : [...base.managerModules],
    executiveModules: o.executiveModules ? keepOrder(o.executiveModules) : [...base.executiveModules],
    mfaRequired: { ...base.mfaRequired, ...(o.mfaRequired ?? {}) },
  };
}

/** The rules in force for a client: the defaults, then its plan's rules, then its own override. */
export function effectiveWorkspaceRules(planRules: unknown, override: unknown): WorkspaceRules {
  return parseWorkspaceRules(override, parseWorkspaceRules(planRules));
}

/** Applies the rules to what a Manager or Executive Workspace was given: withheld modules and Delete come off. */
export function capByRules(
  level: 'MANAGER' | 'EXECUTIVE',
  rules: WorkspaceRules,
  features: FeatureKey[],
  actions: ActionGrants,
): { features: FeatureKey[]; actions: ActionGrants } {
  const allowed = new Set<FeatureGroup>(level === 'MANAGER' ? rules.managerModules : rules.executiveModules);
  const mayDelete = level === 'MANAGER' ? rules.managerDelete : rules.executiveDelete;
  const groupOf = (key: string): FeatureGroup | undefined => (FEATURE_GROUPS as readonly string[]).includes(key) ? (key as FeatureGroup) : FEATURE_BY_KEY[key as FeatureKey]?.group;
  const out: ActionGrants = {};
  for (const [key, list] of Object.entries(actions)) {
    const group = groupOf(key);
    out[key] = !group || !allowed.has(group) ? [] : mayDelete ? [...(list ?? [])] : (list ?? []).filter((a) => a !== 'delete');
  }
  return { features: features.filter((f) => allowed.has(FEATURE_BY_KEY[f].group)), actions: out };
}

/** The Console's view of one plan's rules. */
export interface PlanWorkspaceRulesRow {
  planCode: string;
  planName: string;
  rules: WorkspaceRules;
  /** False while the plan still uses the defaults. */
  customised: boolean;
}

/** The Console's view of one client's rules. */
export interface ClientWorkspaceRules {
  tenantId: string;
  planCode: string;
  planRules: WorkspaceRules;
  override: WorkspaceRulesOverride | null;
  effective: WorkspaceRules;
}
