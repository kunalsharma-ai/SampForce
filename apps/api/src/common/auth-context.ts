import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { FeatureKey, Permission, WorkspaceAction } from '@dealflow/types';

export interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  membershipId: string;
  roleKey: string;
  permissions: string[];
  /** Record visibility of the caller's role (ADR 0060): OWN, TEAM or ALL. Missing means ALL. */
  recordScope?: string;
  /** Whether the role sees details of visible records someone else owns. Missing means yes. */
  viewOthersDetails?: boolean;
  /**
   * The caller's workspace in the organisation's hierarchy (ADR 0071). Null or missing = the Super Workspace.
   */
  workspaceNodeId?: string | null;
  /** How this session signed in. */
  authMethod: 'password' | 'mfa' | 'sso';
  /** Set for single sign-on sessions, which can only act in this workspace. */
  ssoTenantId?: string;
  /**
   * Set when the workspace's security policy is not met yet: only routes marked @AllowRestricted work
   * (the profile, two-step verification setup, sessions, switching workspace).
   */
  restriction?: 'mfa_enrolment' | 'sso_required' | 'workspace_deactivated';
  /**
   * Set when the caller is the browser extension (only routes marked @ExtensionAccess) or a workspace API key
   * (only routes marked @ApiKeyAccess). For an API key, sessionId is the key's id.
   */
  via?: 'extension' | 'api_key' | 'mobile';
  /** The phone (MobileDevice id) of a mobile session (ADR 0072). */
  deviceId?: string;
}

export interface RequestMeta {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type AuthedRequest = Request & { auth?: AuthContext; id?: string | number };

export const IS_PUBLIC = 'dealflow:isPublic';
/** Marks a route as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_RESTRICTED = 'dealflow:allowRestricted';
/** Reachable while the workspace's MFA or SSO policy still blocks the session (see AuthContext.restriction). */
export const AllowRestricted = () => SetMetadata(ALLOW_RESTRICTED, true);

export const EXTENSION_ACCESS = 'dealflow:extensionAccess';
/** Reachable with a browser extension token. Every other route refuses one. */
export const ExtensionAccess = () => SetMetadata(EXTENSION_ACCESS, true);

export const API_KEY_ACCESS = 'dealflow:apiKeyAccess';
/** Reachable with a workspace API key (Zapier, scripts). Every other route refuses one. */
export const ApiKeyAccess = () => SetMetadata(API_KEY_ACCESS, true);

export const MOBILE_ACCESS = 'dealflow:mobileAccess';
/**
 * Reachable from the SampForce phone app (ADR 0072). Every other route refuses a mobile session, so the app can only
 * use what was built and checked for it, whatever request a modified app sends.
 */
export const MobileAccess = () => SetMetadata(MOBILE_ACCESS, true);

export const REQUIRED_PERMISSIONS = 'dealflow:permissions';
/** Every listed permission must be granted by the caller's role in the active tenant. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest>();
  if (!req.auth) throw new Error('Auth context missing: route is not protected by AuthGuard');
  return req.auth;
});

export function requestMeta(req: AuthedRequest): RequestMeta {
  return {
    requestId: String(req.id ?? ''),
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
  };
}

export const Meta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<AuthedRequest>()),
);

export const REQUIRED_FEATURE = 'dealflow:feature';
/**
 * The plan feature a controller or route belongs to (ADR 0057). FeatureGuard refuses it with FEATURE_NOT_IN_PLAN
 * when the workspace's plan, with operator overrides, does not include it. A function picks the feature from the
 * request (one route serving several apps); returning null means no feature applies.
 */
export type FeatureSelector = FeatureKey | ((req: AuthedRequest) => FeatureKey | null);
export const RequireFeature = (feature: FeatureSelector) => SetMetadata(REQUIRED_FEATURE, feature);

export const REQUIRED_ACTION = 'dealflow:action';
/**
 * The workspace action a route performs (ADR 0071), when its permission and HTTP method do not say it: assigning
 * an owner, approving, exporting. HierarchyGuard checks it against the caller's workspace.
 */
export const RequireAction = (action: WorkspaceAction) => SetMetadata(REQUIRED_ACTION, action);

export const OWN_HIERARCHY_RULES = 'dealflow:ownHierarchyRules';
/**
 * The route's service applies the hierarchy rules itself (workspace administration, whose refusals are more
 * specific), so HierarchyGuard checks only the route's feature, not its action.
 */
export const OwnHierarchyRules = () => SetMetadata(OWN_HIERARCHY_RULES, true);

export const ALSO_REQUIRED_FEATURES = 'dealflow:alsoFeatures';
/**
 * Further catalogue features (usually subfeatures, ADR 0071) a route needs on top of its @RequireFeature and the
 * features its permissions belong to. Merged from the controller and the route; checked against the plan
 * (FeatureGuard) and the caller's workspace (HierarchyGuard).
 */
export const AlsoRequireFeature = (...features: FeatureKey[]) => SetMetadata(ALSO_REQUIRED_FEATURES, features);
