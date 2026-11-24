import { createHash, randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { PASSWORD_CONFIRMATION_MINUTES } from '@dealflow/types';
import type { AuthedRequest } from '../auth-context';
import { PrismaService } from '../prisma.service';

/** Who is confirming: a workspace person (USER) or a Console operator (OPERATOR), and the session asking. */
export interface ConfirmationPrincipal {
  kind: 'USER' | 'OPERATOR';
  id: string;
  sessionId: string | null;
}

/** Finds the principal of a request; returns null when the request is not one this resolver knows. */
export type PrincipalResolver = (req: Request) => ConfirmationPrincipal | null;

const FAILURE_WINDOW_MS = 15 * 60_000;
const FAILURE_LIMIT = 5;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Issues and spends password-confirmation passes. The check of the password itself stays with whoever owns the
 * credentials (AuthService for workspace people, the operator service for the Console); this service only counts
 * failures, pauses the check after five wrong tries in fifteen minutes, and keeps the passes.
 */
@Injectable()
export class PasswordConfirmationService {
  private readonly resolvers: PrincipalResolver[] = [];

  constructor(private readonly prisma: PrismaService) {
    // Workspace people: the signed-in session the access token names (the web app, the phone app).
    this.resolvers.push((req) => {
      const auth = (req as AuthedRequest).auth;
      return auth ? { kind: 'USER', id: auth.userId, sessionId: auth.sessionId } : null;
    });
  }

  /** Lets another module (the Console) teach the guard who its callers are. Earlier resolvers win. */
  registerResolver(resolver: PrincipalResolver): void {
    this.resolvers.push(resolver);
  }

  principalOf(req: Request): ConfirmationPrincipal | null {
    for (const r of this.resolvers) {
      const p = r(req);
      if (p) return p;
    }
    return null;
  }

  /** Throws 429 while the principal has typed five wrong passwords in the last fifteen minutes. */
  async assertNotPaused(p: Pick<ConfirmationPrincipal, 'kind' | 'id'>): Promise<void> {
    const since = new Date(Date.now() - FAILURE_WINDOW_MS);
    const failures = await this.prisma.passwordCheckFailure.count({ where: { principalKind: p.kind, principalId: p.id, createdAt: { gt: since } } });
    if (failures >= FAILURE_LIMIT) {
      throw new HttpException(
        { code: 'PASSWORD_CHECK_PAUSED', message: 'Too many wrong passwords. Try again in 15 minutes.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(p: Pick<ConfirmationPrincipal, 'kind' | 'id'>): Promise<void> {
    await this.prisma.passwordCheckFailure.create({ data: { principalKind: p.kind, principalId: p.id } });
  }

  /** A new pass for this principal and session, after its password was checked. Older unused passes are dropped. */
  async issue(p: ConfirmationPrincipal): Promise<{ token: string; expiresAt: string }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_CONFIRMATION_MINUTES * 60_000);
    await this.prisma.passwordConfirmation.deleteMany({ where: { principalKind: p.kind, principalId: p.id, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }] } });
    await this.prisma.passwordCheckFailure.deleteMany({ where: { principalKind: p.kind, principalId: p.id } });
    await this.prisma.passwordConfirmation.create({
      data: { tokenHash: hash(token), principalKind: p.kind, principalId: p.id, sessionId: p.sessionId, expiresAt },
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Spends a pass: true only for an unused, unexpired pass of this principal and session. The conditional update
   * makes two parallel requests unable to share one.
   */
  async spend(token: string, p: ConfirmationPrincipal): Promise<boolean> {
    if (!token || token.length > 200) return false;
    const { count } = await this.prisma.passwordConfirmation.updateMany({
      where: {
        tokenHash: hash(token),
        principalKind: p.kind,
        principalId: p.id,
        ...(p.sessionId ? { sessionId: p.sessionId } : {}),
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { usedAt: new Date() },
    });
    return count === 1;
  }
}
