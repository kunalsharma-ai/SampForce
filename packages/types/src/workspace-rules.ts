import { z } from 'zod';
import { FEATURE_BY_KEY, FEATURE_GROUPS, FEATURE_KEYS, type FeatureGroup, type FeatureKey, featureKeySchema } from './features';
import { FIELD_ACCESS_CATALOGUE, FIELD_ACCESS_IDS } from './field-access';
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
  /** Single sections (features) withheld from Manager Workspaces, inside the modules they may use (R8, ADR 0092). */
  managerHiddenSections: FeatureKey[];
  /** Single sections withheld from Executive Workspaces. */
  executiveHiddenSections: FeatureKey[];
  /** Record fields (`company.primaryEmail`…, see FIELD_ACCESS_CATALOGUE) Manager Workspaces never see or change. */
  managerHiddenFields: string[];
  /** Record fields Executive Workspaces never see or change. */
  executiveHiddenFields: string[];
}

/** What applies when the Console has set nothing: no extra limits. */
export const DEFAULT_WORKSPACE_RULES: WorkspaceRules = {
  managerDelete: true,
  executiveDelete: true,
  managerModules: [...FEATURE_GROUPS],
  executiveModules: [...FEATURE_GROUPS],
  mfaRequired: { SUPER: false, MANAGER: false, EXECUTIVE: false },
  managerHiddenSections: [],
  executiveHiddenSections: [],
  managerHiddenFields: [],
  executiveHiddenFields: [],
};

const modules = z.array(z.enum(FEATURE_GROUPS)).max(FEATURE_GROUPS.length);
const sections = z.array(featureKeySchema).max(FEATURE_KEYS.length);
const fields = z.array(z.enum(FIELD_ACCESS_IDS)).max(FIELD_ACCESS_IDS.length);
const mfa = z.object({ SUPER: z.boolean(), MANAGER: z.boolean(), EXECUTIVE: z.boolean() }).strict();

export const workspaceRulesSchema = z
  .object({
    managerDelete: z.boolean(),
    executiveDelete: z.boolean(),
    managerModules: modules,
    executiveModules: modules,
    mfaRequired: mfa,
    // Optional so a Console screen or script from before R8 still saves; missing means nothing withheld.
    managerHiddenSections: sections.default([]),
    executiveHiddenSections: sections.default([]),
    managerHiddenFields: fields.default([]),
    executiveHiddenFields: fields.default([]),
  })
  .strict();

/** A client override: only the rules it changes. Null in place of the whole override returns the client to its plan. */
export const workspaceRulesOverrideSchema = z
  .object({
    managerDelete: z.boolean().optional(),
    executiveDelete: z.boolean().optional(),
    managerModules: modules.optional(),
    executiveModules: modules.optional(),
    mfaRequired: mfa.partial().optional(),
    managerHiddenSections: sections.optional(),
    executiveHiddenSections: sections.optional(),
    managerHiddenFields: fields.optional(),
    executiveHiddenFields: fields.optional(),
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
const keepSections = (list: readonly string[]): FeatureKey[] => FEATURE_KEYS.filter((k) => list.includes(k));
const keepFields = (list: readonly string[]): string[] => FIELD_ACCESS_CATALOGUE.map((e) => e.id).filter((id) => list.includes(id));

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
    managerHiddenSections: o.managerHiddenSections ? keepSections(o.managerHiddenSections) : [...base.managerHiddenSections],
    executiveHiddenSections: o.executiveHiddenSections ? keepSections(o.executiveHiddenSections) : [...base.executiveHiddenSections],
    managerHiddenFields: o.managerHiddenFields ? keepFields(o.managerHiddenFields) : [...base.managerHiddenFields],
    executiveHiddenFields: o.executiveHiddenFields ? keepFields(o.executiveHiddenFields) : [...base.executiveHiddenFields],
  };
}

/** The sections (feature keys) the Console withholds from a level; nothing for the Super Workspace. */
export function hiddenSectionsFor(level: RuleLevel, rules: WorkspaceRules): FeatureKey[] {
  return level === 'MANAGER' ? rules.managerHiddenSections : level === 'EXECUTIVE' ? rules.executiveHiddenSections : [];
}

/** The record fields hidden from a level; nothing for the Super Workspace. */
export function hiddenFieldsFor(level: RuleLevel, rules: WorkspaceRules): string[] {
  return level === 'MANAGER' ? rules.managerHiddenFields : level === 'EXECUTIVE' ? rules.executiveHiddenFields : [];
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
  const hidden = new Set<string>(level === 'MANAGER' ? rules.managerHiddenSections : rules.executiveHiddenSections);
  const mayDelete = level === 'MANAGER' ? rules.managerDelete : rules.executiveDelete;
  const groupOf = (key: string): FeatureGroup | undefined => (FEATURE_GROUPS as readonly string[]).includes(key) ? (key as FeatureGroup) : FEATURE_BY_KEY[key as FeatureKey]?.group;
  const out: ActionGrants = {};
  for (const [key, list] of Object.entries(actions)) {
    const group = groupOf(key);
    out[key] = !group || !allowed.has(group) || hidden.has(key) ? [] : mayDelete ? [...(list ?? [])] : (list ?? []).filter((a) => a !== 'delete');
  }
  // A withheld section takes the sections under it along (a child cannot work without its parent).
  const withheld = (f: FeatureKey): boolean => {
    for (let k: FeatureKey | undefined = f; k; k = FEATURE_BY_KEY[k]?.parent) if (hidden.has(k)) return true;
    return false;
  };
  return { features: features.filter((f) => allowed.has(FEATURE_BY_KEY[f].group) && !withheld(f)), actions: out };
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
