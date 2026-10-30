import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { API_ENV, type ApiEnv } from '../common/env';

export interface AccessClaims {
  sub: string;
  tid: string;
  sid: string;
}

const ISSUER = 'dealflow-api';
const AUDIENCE = 'dealflow';

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
    return new SignJWT({ tid: claims.tid, sid: claims.sid })
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
      return { sub: payload.sub, tid: payload.tid, sid: payload.sid };
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
