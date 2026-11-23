import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import {
  BUILT_IN_OPERATOR_ROLES,
  BUILT_IN_ROLE_DEFS,
  type ConsoleOperatorRow,
  defaultRoleKey,
  expandPermissions,
  isBuiltInRole,
  legacyOperatorRole,
  type OperatorInviteInput,
  type OperatorInviteResult,
  type OperatorPermission,
  type OperatorRoleInput,
  type OperatorRoleRow,
  type OperatorRoleUpdate,
  type OperatorTokenInfo,
  type OperatorUpdateInput,
} from '@dealflow/types';
import { PasswordService } from '../auth/password.service';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { MailerService } from '../mail/mailer.service';
import { type OperatorContext, operatorContext } from './operator-auth';
import { OperatorSessions } from './operator-sessions';
import { writePlatformAudit, type PlatformAuditEntry } from './platform-audit';

/** An invited operator has no password until they open their link; `!` marks a hash that can never match. */
const INVITED_HASH = '!invited';
const INVITE_HOURS = 72;
export const RESET_MINUTES = 60;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const LINK_INVALID = { code: 'LINK_INVALID', message: 'This link has expired or was already used. Ask for a new one.' };
const NO_ESCALATION = { code: 'FORBIDDEN', message: 'You can only give permissions that you have yourself.' };

type OperatorRecord = { id: string; email: string; name: string; role: 'ADMIN' | 'SUPPORT'; consoleRole: string | null; status: 'ACTIVE' | 'DISABLED'; passwordHash: string; lastLoginAt: Date | null; createdAt: Date };

/**
 * Operators, roles and permissions in the Console (ADR 0074): invite operators by email link, change their role or
 * switch them off, and keep custom roles. Nobody can give a permission they do not hold themselves, change their own
 * role or status, or leave the platform without an active Super Admin.
 */
@Injectable()
export class OperatorAdminService {
  private readonly logger = new Logger(OperatorAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly mailer: MailerService,
    private readonly sessions: OperatorSessions,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  // ───── Roles ─────

  async roles(): Promise<OperatorRoleRow[]> {
    const [custom, ops] = await Promise.all([
      this.prisma.operatorConsoleRole.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.platformOperator.findMany({ select: { role: true, consoleRole: true } }),
    ]);
    const count = new Map<string, number>();
    for (const o of ops) {
      const key = o.consoleRole ?? defaultRoleKey(o.role);
      count.set(key, (count.get(key) ?? 0) + 1);
    }
    return [
      ...BUILT_IN_OPERATOR_ROLES.map((k) => ({ ...BUILT_IN_ROLE_DEFS[k], operators: count.get(k) ?? 0 })),
      ...custom.map((r) => ({ key: r.id, name: r.name, description: r.description, builtIn: false, permissions: expandPermissions(r.permissions), operators: count.get(r.id) ?? 0 })),
    ];
  }

  /** The permissions of a role key, or a 400 when there is no such role. */
  private async rolePermissions(key: string): Promise<{ name: string; permissions: OperatorPermission[] }> {
    if (isBuiltInRole(key)) return BUILT_IN_ROLE_DEFS[key];
    const custom = await this.prisma.operatorConsoleRole.findUnique({ where: { id: key } }).catch(() => null);
    if (!custom) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Choose one of the roles in the list.' });
    return { name: custom.name, permissions: expandPermissions(custom.permissions) };
  }

  private assertCanGrant(actor: OperatorContext, perms: readonly OperatorPermission[]): void {
    if (!perms.every((p) => actor.permissions.includes(p))) throw new ForbiddenException(NO_ESCALATION);
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const lower = name.trim().toLowerCase();
    const clash =
      BUILT_IN_OPERATOR_ROLES.some((k) => BUILT_IN_ROLE_DEFS[k].name.toLowerCase() === lower) ||
      (await this.prisma.operatorConsoleRole.findMany({ select: { id: true, name: true } })).some((r) => r.id !== exceptId && r.name.toLowerCase() === lower);
    if (clash) throw new ConflictException({ code: 'CONFLICT', message: 'A role with this name already exists.' });
  }

  async createRole(actor: OperatorContext, input: OperatorRoleInput, ip: string | null): Promise<OperatorRoleRow> {
    const permissions = expandPermissions(input.permissions);
    this.assertCanGrant(actor, permissions);
    await this.assertNameFree(input.name);
    const row = await this.prisma.operatorConsoleRole.create({ data: { name: input.name.trim(), description: input.description?.trim() ?? '', permissions } });
    await this.log(actor.id, 'operator_role.created', { roleId: row.id, name: row.name, permissions }, ip);
    return { key: row.id, name: row.name, description: row.description, builtIn: false, permissions, operators: 0 };
  }

  async updateRole(actor: OperatorContext, id: string, input: OperatorRoleUpdate, ip: string | null): Promise<OperatorRoleRow> {
    if (isBuiltInRole(id)) throw new BadRequestException({ code: 'BUILT_IN_ROLE', message: 'Built-in roles cannot be changed. Create a custom role instead.' });
    const row = await this.prisma.operatorConsoleRole.findUnique({ where: { id } }).catch(() => null);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });
    // Changing a role changes what its operators can do, so both the old and the new set must be the actor's own.
    this.assertCanGrant(actor, expandPermissions(row.permissions));
    const permissions = input.permissions ? expandPermissions(input.permissions) : expandPermissions(row.permissions);
    this.assertCanGrant(actor, permissions);
    if (input.name !== undefined) await this.assertNameFree(input.name, id);
    if (input.permissions && actor.consoleRole === id) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot change your own role.' });
    const updated = await this.prisma.operatorConsoleRole.update({
      where: { id },
      data: { ...(input.name !== undefined ? { name: input.name.trim() } : {}), ...(input.description !== undefined ? { description: input.description.trim() } : {}), permissions },
    });
    await this.log(actor.id, 'operator_role.updated', { roleId: id, name: updated.name, from: row.permissions, to: permissions }, ip);
    const operators = await this.prisma.platformOperator.count({ where: { consoleRole: id } });
    return { key: id, name: updated.name, description: updated.description, builtIn: false, permissions, operators };
  }

  async deleteRole(actor: OperatorContext, id: string, ip: string | null): Promise<void> {
    if (isBuiltInRole(id)) throw new BadRequestException({ code: 'BUILT_IN_ROLE', message: 'Built-in roles cannot be changed. Create a custom role instead.' });
    const row = await this.prisma.operatorConsoleRole.findUnique({ where: { id } }).catch(() => null);
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Role not found.' });
    if ((await this.prisma.platformOperator.count({ where: { consoleRole: id } })) > 0) {
      throw new ConflictException({ code: 'ROLE_IN_USE', message: 'Move the operators with this role to another role first.' });
    }
    await this.prisma.operatorConsoleRole.delete({ where: { id } });
    await this.log(actor.id, 'operator_role.deleted', { roleId: id, name: row.name }, ip);
  }

  // ───── Operators ─────

  private async rows(where: Prisma.PlatformOperatorWhereInput = {}): Promise<ConsoleOperatorRow[]> {
    const [ops, custom] = await Promise.all([
      this.prisma.platformOperator.findMany({ where, orderBy: { createdAt: 'asc' } }),
      this.prisma.operatorConsoleRole.findMany({ select: { id: true, name: true } }),
    ]);
    const names = new Map(custom.map((r) => [r.id, r.name]));
    return ops.map((o) => this.row(o, names));
  }

  private row(o: OperatorRecord & { mfaEnabledAt?: Date | null }, names: Map<string, string>): ConsoleOperatorRow {
    const key = o.consoleRole ?? defaultRoleKey(o.role);
    return {
      id: o.id,
      email: o.email,
      name: o.name,
      role: key,
      roleName: isBuiltInRole(key) ? BUILT_IN_ROLE_DEFS[key].name : (names.get(key) ?? 'No role'),
      status: o.status === 'DISABLED' ? 'DISABLED' : o.passwordHash === INVITED_HASH ? 'INVITED' : 'ACTIVE',
      lastLoginAt: o.lastLoginAt?.toISOString() ?? null,
      createdAt: o.createdAt.toISOString(),
      mfaEnabled: !!o.mfaEnabledAt,
    };
  }

  private async one(id: string): Promise<ConsoleOperatorRow> {
    const [row] = await this.rows({ id });
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Operator not found.' });
    return row;
  }

  list(): Promise<ConsoleOperatorRow[]> {
    return this.rows();
  }

  async invite(actor: OperatorContext, input: OperatorInviteInput, ip: string | null): Promise<OperatorInviteResult> {
    const role = await this.rolePermissions(input.role);
    this.assertCanGrant(actor, role.permissions);
    if (await this.prisma.platformOperator.findUnique({ where: { email: input.email } })) {
      throw new ConflictException({ code: 'CONFLICT', message: 'An operator with this email already exists.' });
    }
    const op = await this.prisma.platformOperator.create({
      data: { email: input.email, name: input.name, passwordHash: INVITED_HASH, role: legacyOperatorRole(input.role), consoleRole: input.role },
    });
    await this.log(actor.id, 'operator.invited', { operatorId: op.id, email: op.email, role: input.role }, ip);
    return this.sendLink(actor, op, 'invite');
  }

  /** A fresh invitation link for an operator who has not chosen a password yet; earlier links stop working. */
  async reinvite(actor: OperatorContext, id: string, ip: string | null): Promise<OperatorInviteResult> {
    const op = await this.prisma.platformOperator.findUnique({ where: { id } });
    if (!op) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Operator not found.' });
    if (op.passwordHash !== INVITED_HASH) throw new ConflictException({ code: 'ALREADY_JOINED', message: 'This operator has already set a password.' });
    this.assertCanGrant(actor, (await operatorContext(this.prisma, op)).permissions);
    await this.log(actor.id, 'operator.reinvited', { operatorId: op.id, email: op.email }, ip);
    return this.sendLink(actor, op, 'invite');
  }

  async update(actor: OperatorContext, id: string, input: OperatorUpdateInput, ip: string | null): Promise<ConsoleOperatorRow> {
    const op = await this.prisma.platformOperator.findUnique({ where: { id } });
    if (!op) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Operator not found.' });
    const current = await operatorContext(this.prisma, op);
    const roleChanges = input.role !== undefined && input.role !== current.consoleRole;
    const statusChanges = input.status !== undefined && input.status !== op.status;
    if (op.id === actor.id && (roleChanges || statusChanges)) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot change your own role or switch off your own account.' });
    }
    if (roleChanges || statusChanges) this.assertCanGrant(actor, current.permissions);
    const next = roleChanges ? await this.rolePermissions(input.role!) : null;
    if (next) this.assertCanGrant(actor, next.permissions);
    const legacy = roleChanges ? legacyOperatorRole(input.role!) : op.role;
    const losesSuper = op.role === 'ADMIN' && op.status === 'ACTIVE' && (legacy !== 'ADMIN' || input.status === 'DISABLED');
    if (losesSuper && (await this.prisma.platformOperator.count({ where: { role: 'ADMIN', status: 'ACTIVE', id: { not: op.id } } })) === 0) {
      throw new ConflictException({ code: 'LAST_SUPER_ADMIN', message: 'This is the last active Super Admin. Make another operator a Super Admin first.' });
    }
    await this.prisma.platformOperator.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(roleChanges ? { consoleRole: input.role, role: legacy } : {}),
        ...(statusChanges ? { status: input.status } : {}),
      },
    });
    if (roleChanges) await this.log(actor.id, 'operator.role_changed', { operatorId: id, email: op.email, from: current.consoleRole, to: input.role }, ip);
    // A switched-off operator's sessions end at once (the guard refuses them anyway; this keeps the session list true).
    if (statusChanges && input.status === 'DISABLED') await this.sessions.revokeAll(id);
    if (statusChanges) await this.log(actor.id, input.status === 'DISABLED' ? 'operator.disabled' : 'operator.enabled', { operatorId: id, email: op.email }, ip);
    if (input.name !== undefined && input.name !== op.name) await this.log(actor.id, 'operator.renamed', { operatorId: id, from: op.name, to: input.name }, ip);
    return this.one(id);
  }

  /** A reset link a Super Admin hands to an operator (shown when email is not set up). */
  async resetLink(actor: OperatorContext, id: string, ip: string | null): Promise<OperatorInviteResult> {
    const op = await this.prisma.platformOperator.findUnique({ where: { id } });
    if (!op) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Operator not found.' });
    if (op.status !== 'ACTIVE') throw new ConflictException({ code: 'OPERATOR_DISABLED', message: 'Switch the operator back on first.' });
    if (op.passwordHash === INVITED_HASH) return this.reinvite(actor, id, ip);
    this.assertCanGrant(actor, (await operatorContext(this.prisma, op)).permissions);
    await this.log(actor.id, 'operator.reset_link_issued', { operatorId: op.id, email: op.email }, ip);
    return this.sendLink(actor, op, 'reset');
  }

  /** "Forgot password" on the sign-in page: emails a link when the account exists. The answer is the same either way. */
  async forgot(email: string, ip: string | null): Promise<void> {
    const op = await this.prisma.platformOperator.findUnique({ where: { email } });
    await this.log(op?.id ?? null, 'operator.reset_requested', { email, known: !!op }, ip);
    if (!op || op.status !== 'ACTIVE' || op.passwordHash === INVITED_HASH || !this.mailer.configured) return;
    await this.sendLink(null, op, 'reset');
  }

  // ───── Links to choose a password ─────

  /** Issues a one-time link (earlier unused links of the operator stop working) and emails it when email is set up. */
  async sendLink(actor: OperatorContext | null, op: { id: string; email: string; name: string }, purpose: 'invite' | 'reset'): Promise<OperatorInviteResult> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + (purpose === 'invite' ? INVITE_HOURS * 3_600_000 : RESET_MINUTES * 60_000));
    await this.prisma.operatorPasswordToken.deleteMany({ where: { operatorId: op.id, usedAt: null } });
    await this.prisma.operatorPasswordToken.create({ data: { operatorId: op.id, purpose, tokenHash: sha256(token), expiresAt } });
    const link = `${this.env.PUBLIC_WEB_URL.replace(/\/+$/, '')}/operator/set-password#token=${token}`;
    let emailed = false;
    if (this.mailer.configured) {
      const text =
        purpose === 'invite'
          ? `Hello ${op.name},\n\n${actor?.name ?? 'A Super Admin'} added you to the SampForce Console. Choose your password here (the link works for ${INVITE_HOURS} hours):\n\n${link}\n\nIf you did not expect this, you can ignore this email.`
          : `Hello ${op.name},\n\nSomeone asked to reset the password of your SampForce Console account. Choose a new password here (the link works for ${RESET_MINUTES} minutes):\n\n${link}\n\nIf it was not you, ignore this email: your password stays the same.`;
      try {
        await this.mailer.send({ to: op.email, subject: purpose === 'invite' ? 'Your SampForce Console account' : 'Reset your SampForce Console password', text });
        emailed = true;
      } catch (err) {
        this.logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'The operator link email was not sent');
      }
    }
    // When it was emailed, the link is not shown: only the person with the mailbox can use it.
    return { operator: await this.one(op.id), emailed, link: emailed ? null : link, expiresAt: expiresAt.toISOString() };
  }

  private async liveToken(token: string) {
    const row = await this.prisma.operatorPasswordToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) throw new BadRequestException(LINK_INVALID);
    const op = await this.prisma.platformOperator.findUnique({ where: { id: row.operatorId } });
    if (!op || op.status !== 'ACTIVE') throw new BadRequestException(LINK_INVALID);
    return { row, op };
  }

  async tokenInfo(token: string): Promise<OperatorTokenInfo> {
    const { row, op } = await this.liveToken(token);
    return { purpose: row.purpose === 'reset' ? 'reset' : 'invite', email: op.email, name: op.name, expiresAt: row.expiresAt.toISOString() };
  }

  /**
   * Sets the password from a link. Each link works once, and every open session of the operator ends. Returns whether
   * the operator may be signed in at once: not when two-step verification is on, which the sign-in page then asks for.
   */
  async setPassword(token: string, password: string, ip: string | null): Promise<{ operatorId: string; signIn: boolean }> {
    const { row, op } = await this.liveToken(token);
    // Checked before the link is used up, so the person can try another password with the same link.
    if (op.passwordHash !== INVITED_HASH && (await this.passwords.verify(op.passwordHash, password))) {
      throw new BadRequestException({ code: 'PASSWORD_REUSED', message: 'Choose a password you have not used before.' });
    }
    const used = await this.prisma.operatorPasswordToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new BadRequestException(LINK_INVALID);
    const updated = await this.prisma.platformOperator.update({ where: { id: op.id }, data: { passwordHash: await this.passwords.hash(password), lastLoginAt: new Date() } });
    await this.prisma.operatorPasswordToken.deleteMany({ where: { operatorId: op.id, usedAt: null } });
    const ended = await this.sessions.revokeAll(op.id);
    await this.log(op.id, row.purpose === 'reset' ? 'operator.password_reset' : 'operator.joined', ended ? { sessionsEnded: ended } : {}, ip);
    return { operatorId: updated.id, signIn: !updated.mfaEnabledAt };
  }

  private async log(operatorId: string | null, action: string, metadata: Record<string, unknown>, ip: string | null, extra: Pick<PlatformAuditEntry, 'target' | 'before' | 'after'> = {}): Promise<void> {
    await writePlatformAudit(this.prisma, { operatorId, action, metadata, ip, ...extra });
  }
}
