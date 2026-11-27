import type { FeatureKey, WorkspaceAction } from '@dealflow/types';

/*
 * How a route maps onto the catalogue (ADR 0071). Most routes already say which permission they need
 * (`leads:write`); the resource names the feature and the verb plus the HTTP method name the action. Routes can be
 * more specific with @RequireFeature (a subfeature) and @RequireAction (assign, approve, export...).
 */

/** The feature each permission resource belongs to, for routes without a more specific @RequireFeature. */
export const RESOURCE_FEATURE: Partial<Record<string, FeatureKey>> = {
  leads: 'lead_management',
  contacts: 'contact_management',
  companies: 'account_management',
  deals: 'opportunity_management',
  pipelines: 'sales_pipeline',
  activities: 'activity_tracking',
  members: 'user_management',
  audit: 'audit_log',
  quotes: 'quotes',
  catalog: 'quotes',
  contracts: 'contracts',
  marketing: 'marketing',
  success: 'customer_success',
  reports: 'reports',
  sequences: 'sequences',
  gamification: 'gamification',
  enquiries: 'website_enquiries',
  prospects: 'prospect_lists',
  ai: 'ai_assistant',
  automation: 'automation',
};

/** Whole permissions that name a feature regardless of their resource. */
export const PERMISSION_FEATURE: Partial<Record<string, FeatureKey>> = {
  'crm:configure': 'crm_configuration',
  'data:export': 'data_export',
};

/** The action a permission asks for on a request with this HTTP method. */
export function actionFor(permission: string | null, method: string): WorkspaceAction {
  const verb = permission?.split(':')[1];
  const resource = permission?.split(':')[0];
  if (resource === 'reports' && verb === 'read') return 'reports';
  if (verb === 'manage') return 'manage';
  if (verb === 'approve') return 'approve';
  if (verb === 'export' || permission === 'data:export') return 'export';
  if (verb === 'configure') return 'configure';
  if (verb === 'read') return 'view';
  switch (method.toUpperCase()) {
    case 'GET':
    case 'HEAD':
      return 'view';
    case 'POST':
      return 'create';
    case 'DELETE':
      return 'delete';
    default:
      return 'edit';
  }
}

/** Features a route needs in the caller's workspace: its explicit one plus those its permissions belong to. */
export function routeFeatures(explicit: FeatureKey | null, permissions: readonly string[]): FeatureKey[] {
  const out = new Set<FeatureKey>();
  if (explicit) out.add(explicit);
  for (const p of permissions) {
    const f = PERMISSION_FEATURE[p] ?? RESOURCE_FEATURE[p.split(':')[0]!];
    if (f) out.add(f);
  }
  return [...out];
}
