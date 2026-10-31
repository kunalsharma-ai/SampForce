import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { API_ENV, type ApiEnv } from '../common/env';

export type AuthMethod = 'password' | 'mfa' | 'sso';

export interface AccessClaims {
  sub: string;
  tid: string;
  sid: string;
  /** How the session was authenticated. */
  amr: AuthMethod;
  /** Single sign-on sessions are bound to the workspace that signed them in. */
  stid?: string;
}

const ISSUER = 'dealflow-api';
const AUDIENCE = 'dealflow';
const MFA_AUDIENCE = 'dealflow-mfa-challenge';
const METHODS: AuthMethod[] = ['password', 'mfa', 'sso'];

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  get accessTtlSeconds(): number {
    return this.env.ACCESS_TOKEN_TTL_SECONDS;
  }

  get refreshTtlMs(): number {
    return this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
  }

  signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ tid: claims.tid, sid: claims.sid, amr: claims.amr, ...(claims.stid ? { stid: claims.stid } : {}) })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.env.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.tid !== 'string' || typeof payload.sid !== 'string') {
        return null;
      }
      const amr = METHODS.includes(payload.amr as AuthMethod) ? (payload.amr as AuthMethod) : 'password';
      const stid = typeof payload.stid === 'string' ? payload.stid : undefined;
      return { sub: payload.sub, tid: payload.tid, sid: payload.sid, amr, ...(stid ? { stid } : {}) };
    } catch {
      return null;
    }
  }

  /** Proof that the password was right, exchanged within five minutes for a session once the second factor checks out. */
  signMfaChallenge(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(MFA_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(this.key);
  }

  async verifyMfaChallenge(token: string): Promise<string | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: MFA_AUDIENCE, algorithms: ['HS256'] });
      return typeof payload.sub === 'string' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  /** Opaque, high-entropy refresh token. Only its SHA-256 hash is persisted. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: TokenService.hashRefresh(token) };
  }

  static hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
