import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { MfaEnableResponse, MfaSetupResponse, MfaStatus } from '@dealflow/types';
import { SECRET_BOX, type SecretBox } from '../common/crypto';
import { PrismaService } from '../common/prisma.service';
import { authEvents } from '../observability/metrics';
import { PasswordService } from './password.service';
import { generateRecoveryCodes, generateSecret, normaliseRecoveryCode, otpauthUri, verifyTotp } from './totp';

/** Consecutive failures (password or second factor) before sign-in pauses, and for how long. */
export const MAX_FAILED_ATTEMPTS = 10;
export const LOCK_MINUTES = 15;

const INVALID_CODE = { code: 'INVALID_MFA_CODE', message: 'That code is not valid. Check your authenticator app and try again.' };
const WRONG_PASSWORD = { code: 'INVALID_PASSWORD', message: 'The password is incorrect.' };

function hashCode(code: string): string {
  return createHash('sha256').update(normaliseRecoveryCode(code)).digest('hex');
}

/** Two-step verification with an authenticator app (TOTP), recovery codes, and the shared failed-attempt lockout. */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  // ───── Lockout ─────

  isLocked(user: { lockedUntil: Date | null }): boolean {
    return !!user.lockedUntil && user.lockedUntil > new Date();
  }

  /** Counts a failure; the tenth in a row pauses sign-in for LOCK_MINUTES. Atomic, so parallel guesses all count. */
  async recordFailure(userId: string, requestId?: string): Promise<void> {
    const rows = await this.prisma.$queryRaw<{ locked: boolean }[]>`
      UPDATE users SET
        locked_until = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED_ATTEMPTS}::int THEN now() + ${LOCK_MINUTES}::int * interval '1 minute' ELSE locked_until END,
        failed_login_count = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED_ATTEMPTS}::int THEN 0 ELSE failed_login_count + 1 END
      WHERE id = ${userId}::uuid
      RETURNING (locked_until > now()) AS locked`;
    if (rows[0]?.locked) {
      authEvents.inc({ event: 'lockout' });
      this.logger.warn({ userId, requestId }, 'Sign-in paused after repeated failures');
    }
  }

  async clearFailures(userId: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id: userId, OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }] }, data: { failedLoginCount: 0, lockedUntil: null } });
  }

  // ───── Status and enrolment ─────

  async status(userId: string): Promise<MfaStatus> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const remaining = user.mfaEnabledAt ? await this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }) : 0;
    return {
      enabled: !!user.mfaEnabledAt,
      enabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
      canManage: PasswordService.usable(user.passwordHash),
    };
  }

  /** Starts (or restarts) enrolment after re-checking the password. The secret is stored sealed but inactive. */
  async setup(userId: string, password: string): Promise<MfaSetupResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!PasswordService.usable(user.passwordHash)) {
      throw new BadRequestException({ code: 'MFA_MANAGED_BY_SSO', message: 'Your sign-in is managed by your organization’s identity provider.' });
    }
    if (user.mfaEnabledAt) throw new ConflictException({ code: 'MFA_ALREADY_ON', message: 'Two-step verification is already on.' });
    await this.checkPassword(user, password);
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: userId }, data: { mfaSecretEnc: this.box.seal(secret), mfaLastStep: null } });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
  }

  /** Confirms enrolment with a first code and returns ten recovery codes (shown once). */
  async enable(userId: string, code: string): Promise<MfaEnableResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabledAt) throw new ConflictException({ code: 'MFA_ALREADY_ON', message: 'Two-step verification is already on.' });
    if (!user.mfaSecretEnc) throw new BadRequestException({ code: 'MFA_NOT_STARTED', message: 'Start the setup again.' });
    const step = verifyTotp(this.box.open(user.mfaSecretEnc), code);
    if (step === null) throw new BadRequestException(INVALID_CODE);
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { mfaEnabledAt: new Date(), mfaLastStep: BigInt(step) } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashCode(c) })) });
    });
    return { recoveryCodes: codes };
  }

  async disable(userId: string, password: string, code: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt) return;
    await this.checkPassword(user, password);
    if (!(await this.verifySecondFactor(userId, code))) throw new BadRequestException(INVALID_CODE);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { mfaEnabledAt: null, mfaSecretEnc: null, mfaLastStep: null } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
    ]);
  }

  async regenerateRecoveryCodes(userId: string, code: string): Promise<MfaEnableResponse> {
    if (!(await this.verifySecondFactor(userId, code))) throw new BadRequestException(INVALID_CODE);
    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: hashCode(c) })) }),
    ]);
    return { recoveryCodes: codes };
  }

  /**
   * Checks an authenticator code (6 digits) or an unused recovery code. Each TOTP step and each recovery
   * code works once: both are consumed with conditional updates, so two parallel requests cannot share one.
   */
  async verifySecondFactor(userId: string, rawCode: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabledAt || !user.mfaSecretEnc) return false;
    const code = rawCode.replace(/[\s-]/g, '');
    if (/^\d{6}$/.test(code)) {
      const last = user.mfaLastStep === null ? null : Number(user.mfaLastStep);
      const step = verifyTotp(this.box.open(user.mfaSecretEnc), code, { lastStep: last });
      if (step === null) return false;
      const { count } = await this.prisma.user.updateMany({
        where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
        data: { mfaLastStep: BigInt(step) },
      });
      return count === 1;
    }
    const { count } = await this.prisma.mfaRecoveryCode.updateMany({ where: { userId, codeHash: hashCode(code), usedAt: null }, data: { usedAt: new Date() } });
    return count === 1;
  }

  private async checkPassword(user: { id: string; passwordHash: string }, password: string): Promise<void> {
    if (!(await this.passwords.verify(user.passwordHash, password))) {
      await this.recordFailure(user.id);
      throw new BadRequestException(WRONG_PASSWORD);
    }
  }
}
