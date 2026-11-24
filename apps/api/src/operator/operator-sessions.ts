import { Injectable } from '@nestjs/common';
import { type ConsoleSecurityPolicy, DEFAULT_CONSOLE_SECURITY_POLICY } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';

/** Operator sessions are short; there is no refresh token. Each is a row the guard checks (ADR 0074). */
export const OPERATOR_SESSION_SECONDS = 8 * 60 * 60;
/** "Keep me signed in": seven days, still ended by the idle timeout. */
export const OPERATOR_REMEMBER_SECONDS = 7 * 24 * 60 * 60;

const POLICY_KEY = 'console.security_policy';
/** lastSeenAt is written at most this often, so a busy page does not write on every request. */
const TOUCH_MS = 60_000;
const POLICY_CACHE_MS = 15_000;

/**
 * Console sessions (ADR 0074): one row per sign-in, named by the session cookie, so a session can be listed, ended by
 * its operator or a Super Admin, and ends by itself after the idle timeout in the security policy.
 */
@Injectable()
export class OperatorSessions {
  private cached: { at: number; policy: ConsoleSecurityPolicy } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async policy(): Promise<ConsoleSecurityPolicy> {
    if (this.cached && Date.now() - this.cached.at < POLICY_CACHE_MS) return this.cached.policy;
    const row = await this.prisma.platformSetting.findUnique({ where: { key: POLICY_KEY } });
    let stored: Partial<ConsoleSecurityPolicy> = {};
    try {
      stored = row ? (JSON.parse(row.value) as Partial<ConsoleSecurityPolicy>) : {};
    } catch {
      stored = {};
    }
    const policy = {
      ...DEFAULT_CONSOLE_SECURITY_POLICY,
      ...(typeof stored.requireMfa === 'boolean' ? { requireMfa: stored.requireMfa } : {}),
      ...(typeof stored.idleMinutes === 'number' ? { idleMinutes: stored.idleMinutes } : {}),
    };
    this.cached = { at: Date.now(), policy };
    return policy;
  }

  async savePolicy(policy: ConsoleSecurityPolicy, operatorId: string): Promise<void> {
    const value = JSON.stringify({ requireMfa: policy.requireMfa, idleMinutes: policy.idleMinutes });
    await this.prisma.platformSetting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value, updatedById: operatorId }, update: { value, updatedById: operatorId } });
    this.cached = null;
  }

  async start(operatorId: string, meta: { ip: string | null; userAgent: string | null }, remember: boolean): Promise<{ id: string; seconds: number }> {
    const seconds = remember ? OPERATOR_REMEMBER_SECONDS : OPERATOR_SESSION_SECONDS;
    const row = await this.prisma.operatorSession.create({
      data: { operatorId, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, remember, expiresAt: new Date(Date.now() + seconds * 1000) },
    });
    return { id: row.id, seconds };
  }

  /** The live session, or null when it was ended, has expired or sat idle too long. Touches lastSeenAt. */
  async check(sid: string, operatorId: string): Promise<{ id: string; mfaSetupRequired: boolean } | null> {
    const row = await this.prisma.operatorSession.findUnique({ where: { id: sid } }).catch(() => null);
    const now = Date.now();
    if (!row || row.operatorId !== operatorId || row.revokedAt || row.expiresAt.getTime() <= now) return null;
    const policy = await this.policy();
    if (now - row.lastSeenAt.getTime() > policy.idleMinutes * 60_000) {
      await this.prisma.operatorSession.updateMany({ where: { id: sid, revokedAt: null }, data: { revokedAt: new Date() } });
      return null;
    }
    if (now - row.lastSeenAt.getTime() > TOUCH_MS) await this.prisma.operatorSession.update({ where: { id: sid }, data: { lastSeenAt: new Date() } });
    let mfaSetupRequired = false;
    if (policy.requireMfa) {
      const op = await this.prisma.platformOperator.findUnique({ where: { id: operatorId }, select: { mfaEnabledAt: true } });
      mfaSetupRequired = !op?.mfaEnabledAt;
    }
    return { id: row.id, mfaSetupRequired };
  }

  async revoke(id: string): Promise<boolean> {
    const r = await this.prisma.operatorSession.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
    return r.count > 0;
  }

  /** Ends every live session of an operator, except one (the session making the change) when given. */
  async revokeAll(operatorId: string, except?: string): Promise<number> {
    const r = await this.prisma.operatorSession.updateMany({
      where: { operatorId, revokedAt: null, ...(except ? { id: { not: except } } : {}) },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }
}
