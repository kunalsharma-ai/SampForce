import { Inject, Injectable } from '@nestjs/common';
import type { Membership, Role, TenantTx, User } from '@dealflow/database';
import { z } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { entitlementsFor } from '../billing/entitlements';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { hashScimToken } from './security.service';

/**
 * SCIM 2.0 (RFC 7643/7644) user provisioning for one workspace. A SCIM "User" is a person's membership of
 * the workspace: ids are membership ids, so one workspace's identity provider never addresses another's
 * records. People's accounts are global, so SCIM may only rename them or change their email while this is
 * the only workspace they belong to.
 */

export const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';

export class ScimError extends Error {
  constructor(
    readonly status: number,
    detail: string,
    readonly scimType?: string,
  ) {
    super(detail);
  }
}

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const scimUserSchema = z
  .object({
    userName: z.string().trim().min(1).max(254),
    externalId: z.string().trim().max(255).nullish(),
    displayName: z.string().trim().max(120).nullish(),
    name: z
      .object({ formatted: z.string().max(120).nullish(), givenName: z.string().max(60).nullish(), familyName: z.string().max(60).nullish() })
      .partial()
      .nullish(),
    emails: z.array(z.object({ value: z.string().max(254), primary: z.union([z.boolean(), z.string()]).nullish(), type: z.string().nullish() })).max(10).nullish(),
    active: z.union([z.boolean(), z.string()]).nullish(),
  })
  .passthrough();
type ScimUserInput = z.infer<typeof scimUserSchema>;

const patchSchema = z.object({
  Operations: z
    .array(z.object({ op: z.string(), path: z.string().max(200).optional(), value: z.unknown().optional() }))
    .min(1)
    .max(50),
});

/** What a request wants to change, after reading SCIM's several spellings. */
interface Desired {
  email?: string;
  name?: string;
  externalId?: string | null;
  active?: boolean;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string' && /^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  return undefined;
}

function nameFrom(u: Partial<ScimUserInput>): string | undefined {
  const parts = [u.name?.givenName, u.name?.familyName].filter((p): p is string => !!p?.trim());
  return (u.displayName || u.name?.formatted || (parts.length ? parts.join(' ') : undefined))?.trim().slice(0, 120) || undefined;
}

function emailFrom(u: Partial<ScimUserInput>): string | undefined {
  const primary = u.emails?.find((e) => bool(e.primary)) ?? u.emails?.[0];
  const candidate = (primary?.value ?? (u.userName && emailRe.test(u.userName) ? u.userName : undefined))?.trim().toLowerCase();
  return candidate && emailRe.test(candidate) ? candidate : undefined;
}

type Member = Membership & { user: User };
type Row = Member & { role: Role };

@Injectable()
export class ScimService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  private location(id: string): string {
    return `${this.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/api/v1/scim/v2/Users/${id}`;
  }

  /** Resolves the bearer token to its workspace (narrow RLS policy on the token hash), and checks the plan. */
  async authenticate(header: string | undefined): Promise<{ tenantId: string; tokenId: string }> {
    const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
    if (!token) throw new ScimError(401, 'Missing bearer token.');
    const hash = hashScimToken(token);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.scim_token_hash', ${hash}, true)`;
      return tx.scimToken.findFirst({ where: { tokenHash: hash, revokedAt: null }, select: { id: true, tenantId: true, lastUsedAt: true } });
    });
    if (!row) throw new ScimError(401, 'The token is not valid or has been revoked.');
    await this.prisma.run({ tenantId: row.tenantId }, async (tx) => {
      if (!(await entitlementsFor(tx, row.tenantId)).entitlements.sso) throw new ScimError(403, 'SCIM provisioning is not included in this workspace’s plan.');
      // Record use at most once a minute.
      if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await tx.scimToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    });
    return { tenantId: row.tenantId, tokenId: row.id };
  }

  toResource(m: Member) {
    const [givenName, ...rest] = m.user.name.split(' ');
    return {
      schemas: [SCIM_USER],
      id: m.id,
      ...(m.externalId ? { externalId: m.externalId } : {}),
      userName: m.user.email,
      name: { formatted: m.user.name, givenName: givenName ?? '', familyName: rest.join(' ') },
      displayName: m.user.name,
      emails: [{ value: m.user.email, type: 'work', primary: true }],
      active: m.status === 'ACTIVE',
      meta: { resourceType: 'User', created: m.createdAt.toISOString(), lastModified: m.updatedAt.toISOString(), location: this.location(m.id) },
    };
  }

  async list(tenantId: string, filter: string | undefined, startIndex: number, count: number) {
    const where: Record<string, unknown> = { tenantId };
    if (filter) {
      const m = filter.trim().match(/^([\w.[\]" ]+?)\s+eq\s+"((?:[^"\\]|\\.)*)"$/i);
      if (!m) throw new ScimError(400, 'Only "attribute eq value" filters on userName, externalId, id or emails are supported.', 'invalidFilter');
      const attr = m[1]!.replace(/\s+/g, ' ').toLowerCase();
      const value = m[2]!.replace(/\\(.)/g, '$1');
      if (attr === 'username' || attr === 'emails.value' || attr === 'emails' || attr === 'emails[type eq "work"].value') where.user = { email: value.toLowerCase() };
      else if (attr === 'externalid') where.externalId = value;
      else if (attr === 'id') where.id = /^[0-9a-f-]{36}$/i.test(value) ? value : '00000000-0000-0000-0000-000000000000';
      else throw new ScimError(400, `Filtering on ${m[1]} is not supported.`, 'invalidFilter');
    }
    const start = Math.max(1, startIndex);
    const take = Math.min(Math.max(0, count), 200);
    return this.prisma.run({ tenantId }, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.membership.count({ where }),
        tx.membership.findMany({ where, include: { user: true }, orderBy: { createdAt: 'asc' }, skip: start - 1, take }),
      ]);
      return { schemas: [SCIM_LIST], totalResults: total, startIndex: start, itemsPerPage: rows.length, Resources: rows.map((r) => this.toResource(r)) };
    });
  }

  async get(tenantId: string, id: string) {
    return this.prisma.run({ tenantId }, async (tx) => this.toResource(await this.find(tx, id)));
  }

  async create(tenantId: string, tokenId: string, body: unknown) {
    const input = this.parse(scimUserSchema, body);
    const email = emailFrom(input);
    if (!email) throw new ScimError(400, 'Provide an email address in userName or emails.', 'invalidValue');
    const name = nameFrom(input) ?? email.split('@')[0]!;
    const active = bool(input.active) ?? true;
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    return this.prisma.run({ tenantId, userId: existingUser?.id }, async (tx) => {
      if (existingUser && (await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: existingUser.id } } }))) {
        throw new ScimError(409, 'This person is already a member of the workspace.', 'uniqueness');
      }
      if (input.externalId && (await tx.membership.findFirst({ where: { tenantId, externalId: input.externalId } }))) {
        throw new ScimError(409, 'Another member already has this externalId.', 'uniqueness');
      }
      if (active) await this.assertSeat(tx, tenantId);
      const user = existingUser ?? (await tx.user.create({ data: { email, name, passwordHash: PasswordService.UNUSABLE } }));
      const roleId = await this.provisioningRole(tx, tenantId);
      const m = await tx.membership.create({
        data: { tenantId, userId: user.id, roleId, externalId: input.externalId ?? null, status: active ? 'ACTIVE' : 'SUSPENDED' },
        include: { user: true },
      });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'scim.user_created', entityType: 'membership', entityId: m.id, metadata: { email, tokenId, linkedExisting: !!existingUser } });
      return this.toResource(m);
    });
  }

  async replace(tenantId: string, tokenId: string, id: string, body: unknown) {
    const input = this.parse(scimUserSchema, body);
    return this.apply(tenantId, tokenId, id, { email: emailFrom(input), name: nameFrom(input), externalId: input.externalId ?? null, active: bool(input.active) ?? true });
  }

  async patch(tenantId: string, tokenId: string, id: string, body: unknown) {
    const { Operations } = this.parse(patchSchema, body);
    const desired: Desired = {};
    const name: { given?: string; family?: string } = {};
    const set = (path: string, value: unknown) => {
      const p = path.toLowerCase();
      if (p === 'active') {
        const b = bool(value);
        if (b === undefined) throw new ScimError(400, 'active must be true or false.', 'invalidValue');
        desired.active = b;
      } else if (p === 'externalid') desired.externalId = value == null ? null : String(value).slice(0, 255);
      else if (p === 'displayname' || p === 'name.formatted') desired.name = String(value).trim().slice(0, 120);
      else if (p === 'name.givenname') name.given = String(value).trim();
      else if (p === 'name.familyname') name.family = String(value).trim();
      else if (p === 'username' || p === 'emails[type eq "work"].value' || p === 'emails.value') desired.email = String(value).trim().toLowerCase();
      else if (p === 'emails' && Array.isArray(value)) desired.email = emailFrom({ emails: value as ScimUserInput['emails'] });
      else if (p === 'name' && value && typeof value === 'object') {
        const v = value as Record<string, unknown>;
        if (typeof v.givenName === 'string') name.given = v.givenName;
        if (typeof v.familyName === 'string') name.family = v.familyName;
        if (typeof v.formatted === 'string') desired.name = v.formatted.slice(0, 120);
      }
      // Attributes DealFlow does not store (title, phoneNumbers, enterprise extension…) are accepted and ignored.
    };
    for (const op of Operations) {
      const kind = op.op.toLowerCase();
      if (kind === 'remove') {
        if (op.path?.toLowerCase() === 'externalid') desired.externalId = null;
        continue;
      }
      if (kind !== 'add' && kind !== 'replace') throw new ScimError(400, `Unsupported operation ${op.op}.`, 'invalidSyntax');
      if (op.path) set(op.path, op.value);
      else if (op.value && typeof op.value === 'object') for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) set(k, v);
    }
    if (name.given !== undefined || name.family !== undefined) {
      const current = await this.get(tenantId, id);
      desired.name ??= [name.given ?? current.name.givenName, name.family ?? current.name.familyName].filter(Boolean).join(' ').slice(0, 120);
    }
    return this.apply(tenantId, tokenId, id, desired);
  }

  /** DELETE removes the person from the workspace (their account and the records they own stay). */
  async remove(tenantId: string, tokenId: string, id: string): Promise<void> {
    await this.prisma.run({ tenantId }, async (tx) => {
      const m = await this.find(tx, id);
      this.assertNotOwner(m);
      await tx.membership.delete({ where: { id: m.id } });
      await this.audit.record(tx, { tenantId, actorUserId: null, actorType: 'SYSTEM', action: 'scim.user_deleted', entityType: 'membership', entityId: m.id, metadata: { email: m.user.email, tokenId } });
    });
  }

  private async apply(tenantId: string, tokenId: string, id: string, desired: Desired) {
    return this.prisma.run({ tenantId }, async (tx) => {
      const m = await this.find(tx, id);
      const userData: { name?: string; email?: string } = {};
      const wantsName = desired.name && desired.name !== m.user.name;
      const wantsEmail = desired.email && desired.email !== m.user.email;
      if (wantsName || wantsEmail) {
        // The account is shared with any other workspaces the person belongs to; leave it alone if so.
        const others = await this.prisma.run({ userId: m.userId }, (utx) => utx.membership.count({ where: { userId: m.userId, tenantId: { not: tenantId } } }));
        if (others === 0) {
          if (wantsName) userData.name = desired.name!;
          if (wantsEmail) {
            if (!emailRe.test(desired.email!)) throw new ScimError(400, 'That is not a valid email address.', 'invalidValue');
            if (await this.prisma.user.findUnique({ where: { email: desired.email! } })) throw new ScimError(409, 'Another account already uses that email address.', 'uniqueness');
            userData.email = desired.email!;
          }
        } else if (wantsEmail) {
          throw new ScimError(400, 'This person also belongs to other DealFlow workspaces, so their email can only be changed by them.', 'mutability');
        }
      }
      if (desired.active === false || (desired.active === true && m.status !== 'ACTIVE')) this.assertNotOwner(m);
      if (desired.active === true && m.status !== 'ACTIVE') await this.assertSeat(tx, tenantId);
      if (desired.externalId !== undefined && desired.externalId !== m.externalId && desired.externalId) {
        const clash = await tx.membership.findFirst({ where: { tenantId, externalId: desired.externalId, id: { not: m.id } } });
        if (clash) throw new ScimError(409, 'Another member already has this externalId.', 'uniqueness');
      }
      if (Object.keys(userData).length) await tx.user.update({ where: { id: m.userId }, data: userData });
      const updated = await tx.membership.update({
        where: { id: m.id },
        data: {
          ...(desired.externalId !== undefined ? { externalId: desired.externalId } : {}),
          ...(desired.active !== undefined ? { status: desired.active ? 'ACTIVE' : 'SUSPENDED' } : {}),
        },
        include: { user: true },
      });
      const statusChanged = updated.status !== m.status;
      await this.audit.record(tx, {
        tenantId, actorUserId: null, actorType: 'SYSTEM', action: statusChanged ? (updated.status === 'ACTIVE' ? 'scim.user_reactivated' : 'scim.user_deactivated') : 'scim.user_updated',
        entityType: 'membership', entityId: m.id, metadata: { email: updated.user.email, tokenId, changed: Object.keys(userData) },
      });
      return this.toResource(updated);
    });
  }

  private async find(tx: TenantTx, id: string): Promise<Row> {
    const m = /^[0-9a-f-]{36}$/i.test(id) ? await tx.membership.findUnique({ where: { id }, include: { user: true, role: true } }) : null;
    if (!m) throw new ScimError(404, 'User not found.');
    return m;
  }

  private assertNotOwner(m: Row): void {
    // Owners are never deactivated by provisioning, so an identity-provider mistake cannot lock the workspace.
    if (m.role.key === 'owner') throw new ScimError(403, 'Owners are managed in DealFlow, not through SCIM.');
  }

  private async assertSeat(tx: TenantTx, tenantId: string): Promise<void> {
    const ent = await entitlementsFor(tx, tenantId);
    if (ent.seatLimit !== null && (await tx.membership.count({ where: { tenantId, status: 'ACTIVE' } })) >= ent.seatLimit) {
      throw new ScimError(403, 'The workspace has no free seats on its current plan.');
    }
  }

  /** The SSO connection's default role when set, otherwise the Member role. */
  private async provisioningRole(tx: TenantTx, tenantId: string): Promise<string> {
    const conn = await tx.ssoConnection.findUnique({ where: { tenantId }, select: { defaultRoleId: true } });
    if (conn?.defaultRoleId) return conn.defaultRoleId;
    const role = await tx.role.findFirstOrThrow({ where: { tenantId, key: 'member' } });
    return role.id;
  }

  private parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
    const r = schema.safeParse(body);
    if (!r.success) throw new ScimError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '), 'invalidValue');
    return r.data;
  }
}
