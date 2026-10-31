import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '@dealflow/types';

export interface AuthContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  membershipId: string;
  roleKey: string;
  permissions: string[];
  /** How this session signed in. */
  authMethod: 'password' | 'mfa' | 'sso';
  /** Set for single sign-on sessions, which can only act in this workspace. */
  ssoTenantId?: string;
  /**
   * Set when the workspace's security policy is not met yet: only routes marked @AllowRestricted work
   * (the profile, two-step verification setup, sessions, switching workspace).
   */
  restriction?: 'mfa_enrolment' | 'sso_required';
  /** Set when the caller is the browser extension, which may only use routes marked @ExtensionAccess. */
  via?: 'extension';
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
