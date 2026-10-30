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
