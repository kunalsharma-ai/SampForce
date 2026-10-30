import type { CookieOptions, Response } from 'express';
import type { ApiEnv } from '../common/env';

export const ACCESS_COOKIE = 'df_access';
export const REFRESH_COOKIE = 'df_refresh';
const REFRESH_PATH = '/api/v1/auth';

function base(env: ApiEnv): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'lax' };
}

export function setAuthCookies(
  res: Response,
  env: ApiEnv,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base(env),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base(env),
    path: REFRESH_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function setAccessCookie(res: Response, env: ApiEnv, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...base(env),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response, env: ApiEnv): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(env), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(env), path: REFRESH_PATH });
}
