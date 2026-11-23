import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  type ConsoleSecurityPolicy,
  type ConsoleSecurityPolicyUpdate,
  describeDevice,
  type MfaEnableResponse,
  type MfaSetupResponse,
  type MfaStatus,
  type OperatorLoginEventRow,
  type OperatorLoginOutcome,
  type OperatorSessionRow,
} from '@dealflow/types';
import { PasswordService } from '../auth/password.service';
import { generateRecoveryCodes, generateSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from '../auth/totp';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { type OperatorContext, operatorContext } from './operator-auth';
import { OperatorSessions } from './operator-sessions';

export interface SignInMeta {
  ip: string | null;
  userAgent: string | null;
}

/** What a sign-in step produced: a session to put in the cookie, or a challenge for the second step. */
export type SignInStep =
  | { kind: 'session'; operator: OperatorContext; sessionId: string; seconds: number; mfaSetupRequired: boolean }
  | { kind: 'challenge'; challenge: string };

const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' };
const INVALID_CODE = { code: 'INVALID_MFA_CODE', message: 'That code is not valid. Try again, or use a recovery code.' };
const SETUP_CODE = { code: 'INVALID_MFA_CODE', message: 'That code is not valid. Check your authenticator app and try again.' };
const WRONG_PASSWORD = { code: 'INVALID_PASSWORD', message: 'The password is incorrect.' };

const hashCode = (code: string) => createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');

/** How many earlier successful sign-ins are compared when deciding whether a new one is unusual. */
const KNOWN_IPS_WINDOW = 20;

/**
 * Console sign-in security (ADR 0074): password then authenticator code, a pause after repeated failures, a session row
 * per sign-in, the login history with unusual sign-ins flagged, and the policy Super Admins set.
 */
@Injectable()
export class OperatorSecurityService {
  private readonly logger = new Logger(OperatorSecurityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: OperatorSessions,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  // ───── Signing in ─────

  private locked(op: { lockedUntil: Date | null }): boolean {
    return !!op.lockedUntil && op.lockedUntil > new Date();
  }

  /** Counts a failure; the fifth in a row pauses sign-in. The increment is atomic, so parallel guesses all count. */
  private async fail(operatorId: string): Promise<boolean> {
    const policy = await this.sessions.policy();
    const after = await this.prisma.platformOperator.update({ where: { id: operatorId }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
    if (after.failedLoginCount < policy.lockoutAttempts) return false;
    const hit = await this.prisma.platformOperator.updateMany({
      where: { id: operatorId, failedLoginCount: { gte: policy.lockoutAttempts } },
      data: { failedLoginCount: 0, lockedUntil: new Date(Date.now() + policy.lockoutMinutes * 60_000) },
    });
    return hit.count > 0;
  }

  /**
   * Password step. While an account is paused, or for a wrong password, unknown email or switched-off account, the
   * answer is the same generic error, so it does not reveal which emails have accounts.
   */
  async login(email: string, password: string, remember: boolean, meta: SignInMeta, tokens: { challenge: (id: string) => Promise<string> }): Promise<SignInStep> {
    const op = await this.prisma.platformOperator.findUnique({ where: { email } });
    const locked = !!op && this.locked(op);
    const ok = await this.passwords.verify(locked ? null : (op?.passwordHash ?? null), password);
    if (!op || !ok || op.status !== 'ACTIVE') {
      let outcome: OperatorLoginOutcome = locked ? 'locked' : op && ok ? 'disabled' : 'wrong_password';
      if (op && !ok && !locked && op.status === 'ACTIVE' && (await this.fail(op.id))) outcome = 'locked';
      await this.record(op?.id ?? null, email, outcome, meta);
      await this.audit(op?.id ?? null, 'operator.login_failed', { email, outcome }, meta.ip);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (op.mfaEnabledAt) return { kind: 'challenge', challenge: await tokens.challenge(op.id) };
    return this.signedIn(op.id, remember, meta);
  }

  /** Second step: an authenticator code or a recovery code, within five minutes of the password. */
  async loginMfa(operatorId: string | null, code: string, remember: boolean, meta: SignInMeta): Promise<SignInStep> {
    if (!operatorId) throw new UnauthorizedException({ code: 'MFA_CHALLENGE_EXPIRED', message: 'The sign-in took too long. Enter your password again.' });
    const op = await this.prisma.platformOperator.findUnique({ where: { id: operatorId } });
    if (!op) throw new UnauthorizedException(INVALID_CREDENTIALS);
    if (this.locked(op) || op.status !== 'ACTIVE' || !(await this.verifySecondFactor(op.id, code))) {
      let outcome: OperatorLoginOutcome = this.locked(op) ? 'locked' : op.status !== 'ACTIVE' ? 'disabled' : 'wrong_code';
      if (outcome === 'wrong_code' && (await this.fail(op.id))) outcome = 'locked';
      await this.record(op.id, op.email, outcome, meta);
      await this.audit(op.id, 'operator.login_failed', { email: op.email, outcome }, meta.ip);
      throw new UnauthorizedException(INVALID_CODE);
    }
    return this.signedIn(op.id, remember, meta);
  }

  /** Starts a session after every check passed: clears the failure count and records the sign-in. */
  async signedIn(operatorId: string, remember: boolean, meta: SignInMeta): Promise<SignInStep & { kind: 'session' }> {
    const op = await this.prisma.platformOperator.update({ where: { id: operatorId }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
    const session = await this.sessions.start(op.id, meta, remember);
    const flagged = await this.record(op.id, op.email, 'success', meta);
    await this.audit(op.id, 'operator.login', { sessionId: session.id, ...(flagged ? { suspicious: flagged } : {}) }, meta.ip);
    const policy = await this.sessions.policy();
    return { kind: 'session', operator: await operatorContext(this.prisma, op), sessionId: session.id, seconds: session.seconds, mfaSetupRequired: policy.requireMfa && !op.mfaEnabledAt };
  }

  /**
   * Writes the attempt to the login history. A successful sign-in is flagged as unusual when it comes from an address
   * none of the operator's recent sign-ins used, or follows three or more failures within the hour. Returns the reason.
   */
  private async record(operatorId: string | null, email: string, outcome: OperatorLoginOutcome, meta: SignInMeta): Promise<string | null> {
    let reason: string | null = null;
    if (outcome === 'success' && operatorId) {
      const earlier = await this.prisma.operatorLoginEvent.findMany({ where: { operatorId, outcome: 'success' }, orderBy: { createdAt: 'desc' }, take: KNOWN_IPS_WINDOW, select: { ip: true } });
      const failures = await this.prisma.operatorLoginEvent.count({ where: { operatorId, outcome: { not: 'success' }, createdAt: { gt: new Date(Date.now() - 3_600_000) } } });
      if (failures >= 3) reason = `${failures} failed attempts in the last hour`;
      else if (earlier.length > 0 && meta.ip && !earlier.some((e) => e.ip === meta.ip)) reason = 'New network address';
    }
    await this.prisma.operatorLoginEvent.create({
      data: { operatorId, email, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 400) ?? null, outcome, suspicious: !!reason, reason },
    });
    if (reason) this.logger.warn({ operatorId, reason }, 'Unusual Console sign-in');
    return reason;
  }

  async logout(sessionId: string | undefined): Promise<void> {
    if (sessionId) await this.sessions.revoke(sessionId);
  }

  // ───── Sessions ─────

  async sessionRows(where: Prisma.OperatorSessionWhereInput, current?: string): Promise<OperatorSessionRow[]> {
    const policy = await this.sessions.policy();
    const now = new Date();
    const rows = await this.prisma.operatorSession.findMany({
      where: { ...where, revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - policy.idleMinutes * 60_000) } },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
    });
    const ops = new Map((await this.prisma.platformOperator.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.operatorId))] } }, select: { id: true, name: true, email: true } })).map((o) => [o.id, o]));
    return rows.map((r) => ({
      id: r.id,
      operatorId: r.operatorId,
      operatorName: ops.get(r.operatorId)?.name ?? 'Removed operator',
      operatorEmail: ops.get(r.operatorId)?.email ?? '',
      ip: r.ip,
      device: describeDevice(r.userAgent),
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      current: r.id === current,
    }));
  }

  mySessions(op: OperatorContext): Promise<OperatorSessionRow[]> {
    return this.sessionRows({ operatorId: op.id }, op.sessionId);
  }

  allSessions(op: OperatorContext): Promise<OperatorSessionRow[]> {
    return this.sessionRows({}, op.sessionId);
  }

  /** Ends one session: the operator's own, or anyone's for those who manage security. */
  async endSession(op: OperatorContext, id: string, ip: string | null): Promise<void> {
    const row = await this.prisma.operatorSession.findUnique({ where: { id } }).catch(() => null);
    if (!row || row.revokedAt) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Session not found.' });
    if (row.operatorId !== op.id && !op.permissions.includes('security.manage')) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Your operator role does not allow this action.' });
    await this.sessions.revoke(id);
    await this.audit(op.id, 'operator.session_ended', { sessionId: id, operatorId: row.operatorId }, ip);
  }

  async endOtherSessions(op: OperatorContext, ip: string | null): Promise<{ ended: number }> {
    const ended = await this.sessions.revokeAll(op.id, op.sessionId);
    await this.audit(op.id, 'operator.sessions_ended', { operatorId: op.id, ended }, ip);
    return { ended };
  }

  async endOperatorSessions(op: OperatorContext, operatorId: string, ip: string | null): Promise<{ ended: number }> {
    const ended = await this.sessions.revokeAll(operatorId, operatorId === op.id ? op.sessionId : undefined);
    await this.audit(op.id, 'operator.sessions_ended', { operatorId, ended }, ip);
    return { ended };
  }

  // ───── Login history ─────

  async logins(where: Prisma.OperatorLoginEventWhereInput, limit: number): Promise<OperatorLoginEventRow[]> {
    const rows = await this.prisma.operatorLoginEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: limit });
    const ops = new Map((await this.prisma.platformOperator.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.operatorId ? [r.operatorId] : [])))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    return rows.map((r) => ({
      id: r.id,
      operatorId: r.operatorId,
      operatorName: r.operatorId ? (ops.get(r.operatorId) ?? null) : null,
      email: r.email,
      ip: r.ip,
      device: describeDevice(r.userAgent),
      outcome: r.outcome as OperatorLoginOutcome,
      suspicious: r.suspicious,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // ───── Policy ─────

  policy(): Promise<ConsoleSecurityPolicy> {
    return this.sessions.policy();
  }

  async setPolicy(op: OperatorContext, input: ConsoleSecurityPolicyUpdate, ip: string | null): Promise<ConsoleSecurityPolicy> {
    const before = await this.sessions.policy();
    if (input.requireMfa && !before.requireMfa) {
      const me = await this.prisma.platformOperator.findUnique({ where: { id: op.id }, select: { mfaEnabledAt: true } });
      // Asking everyone for two-step verification starts with the person asking.
      if (!me?.mfaEnabledAt) throw new ConflictException({ code: 'MFA_REQUIRED_FIRST', message: 'Turn on two-step verification for your own account first.' });
    }
    const next = { ...before, ...input };
    await this.sessions.savePolicy(next, op.id);
    await this.audit(op.id, 'console.security_policy_changed', { from: { requireMfa: before.requireMfa, idleMinutes: before.idleMinutes }, to: { requireMfa: next.requireMfa, idleMinutes: next.idleMinutes } }, ip);
    return next;
  }

  // ───── Two-step verification ─────

  async mfaStatus(operatorId: string): Promise<MfaStatus> {
    const op = await this.prisma.platformOperator.findUniqueOrThrow({ where: { id: operatorId } });
    const remaining = op.mfaEnabledAt ? await this.prisma.operatorRecoveryCode.count({ where: { operatorId, usedAt: null } }) : 0;
    return { enabled: !!op.mfaEnabledAt, enabledAt: op.mfaEnabledAt?.toISOString() ?? null, recoveryCodesRemaining: remaining, canManage: true };
  }

  private async checkPassword(op: { id: string; passwordHash: string }, password: string): Promise<void> {
    if (!(await this.passwords.verify(op.passwordHash, password))) {
      await this.fail(op.id);
      throw new BadRequestException(WRONG_PASSWORD);
    }
  }

  async mfaSetup(operatorId: string, password: string): Promise<MfaSetupResponse> {
    const op = await this.prisma.platformOperator.findUniqueOrThrow({ where: { id: operatorId } });
    if (op.mfaEnabledAt) throw new ConflictException({ code: 'MFA_ALREADY_ON', message: 'Two-step verification is already on.' });
    await this.checkPassword(op, password);
    const secret = generateSecret();
    await this.prisma.platformOperator.update({ where: { id: operatorId }, data: { mfaSecretEnc: this.box.seal(secret), mfaLastStep: null } });
    return { secret, otpauthUri: otpauthUri(secret, op.email, 'SampForce Console') };
  }

  async mfaEnable(op: OperatorContext, code: string, ip: string | null): Promise<MfaEnableResponse> {
    const row = await this.prisma.platformOperator.findUniqueOrThrow({ where: { id: op.id } });
    if (row.mfaEnabledAt) throw new ConflictException({ code: 'MFA_ALREADY_ON', message: 'Two-step verification is already on.' });
    if (!row.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_NOT_STARTED', message: 'Start the setup again.' });
    const step = verifyTotp(this.box.open(row.mfaSecretEnc), code);
    if (step === null) throw new BadRequestException(SETUP_CODE);
    const codes = generateRecoveryCodes();
    await this.prisma.platformOperator.update({ where: { id: op.id }, data: { mfaEnabledAt: new Date(), mfaLastStep: BigInt(step) } });
    await this.prisma.operatorRecoveryCode.deleteMany({ where: { operatorId: op.id } });
    await this.prisma.operatorRecoveryCode.createMany({ data: codes.map((c) => ({ operatorId: op.id, codeHash: hashCode(c) })) });
    // As in workspaces: turning it on signs out the operator's other browsers, which signed in without a code.
    const ended = await this.sessions.revokeAll(op.id, op.sessionId);
    await this.audit(op.id, 'operator.mfa_enabled', ended ? { sessionsEnded: ended } : {}, ip);
    return { recoveryCodes: codes };
  }

  async mfaDisable(op: OperatorContext, password: string, code: string, ip: string | null): Promise<void> {
    const row = await this.prisma.platformOperator.findUniqueOrThrow({ where: { id: op.id } });
    if (!row.mfaEnabledAt) return;
    if ((await this.sessions.policy()).requireMfa) throw new ConflictException({ code: 'MFA_REQUIRED', message: 'The Console’s security policy requires two-step verification.' });
    await this.checkPassword(row, password);
    if (!(await this.verifySecondFactor(op.id, code))) throw new BadRequestException(INVALID_CODE);
    await this.clearMfa(op.id);
    await this.audit(op.id, 'operator.mfa_disabled', {}, ip);
  }

  async regenerateCodes(op: OperatorContext, code: string, ip: string | null): Promise<MfaEnableResponse> {
    if (!(await this.verifySecondFactor(op.id, code))) throw new BadRequestException(INVALID_CODE);
    const codes = generateRecoveryCodes();
    await this.prisma.operatorRecoveryCode.deleteMany({ where: { operatorId: op.id } });
    await this.prisma.operatorRecoveryCode.createMany({ data: codes.map((c) => ({ operatorId: op.id, codeHash: hashCode(c) })) });
    await this.audit(op.id, 'operator.recovery_codes_regenerated', {}, ip);
    return { recoveryCodes: codes };
  }

  /** For an operator who lost their phone and codes: a Super Admin turns it off, and the operator sets it up again. */
  async resetMfa(actor: OperatorContext, operatorId: string, ip: string | null): Promise<void> {
    if (operatorId === actor.id) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Use your account page to change your own two-step verification.' });
    const op = await this.prisma.platformOperator.findUnique({ where: { id: operatorId } });
    if (!op) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Operator not found.' });
    await this.clearMfa(operatorId);
    // Their sessions end, so the next sign-in goes through the new setup.
    await this.sessions.revokeAll(operatorId);
    await this.audit(actor.id, 'operator.mfa_reset', { operatorId, email: op.email }, ip);
  }

  private async clearMfa(operatorId: string): Promise<void> {
    await this.prisma.platformOperator.update({ where: { id: operatorId }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null } });
    await this.prisma.operatorRecoveryCode.deleteMany({ where: { operatorId } });
  }

  /** An authenticator code (each step works once) or an unused recovery code (each works once). */
  async verifySecondFactor(operatorId: string, raw: string): Promise<boolean> {
    const op = await this.prisma.platformOperator.findUniqueOrThrow({ where: { id: operatorId } });
    if (!op.mfaEnabledAt || !op.mfaSecretEnc) return false;
    const code = raw.replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(code)) {
      const step = verifyTotp(this.box.open(op.mfaSecretEnc), code, { lastStep: op.mfaLastStep === null ? null : Number(op.mfaLastStep) });
      if (step === null) return false;
      const { count } = await this.prisma.platformOperator.updateMany({
        where: { id: operatorId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
        data: { mfaLastStep: BigInt(step) },
      });
      return count === 1;
    }
    const { count } = await this.prisma.operatorRecoveryCode.updateMany({ where: { operatorId, codeHash: hashCode(code), usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }

  private async audit(operatorId: string | null, action: string, metadata: Record<string, unknown>, ip: string | null): Promise<void> {
    await this.prisma.platformAuditLog.create({ data: { operatorId, action, targetTenantId: null, metadata: metadata as Prisma.InputJsonValue, ip } });
  }
}
