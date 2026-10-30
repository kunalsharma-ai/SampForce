import { randomBytes } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@dealflow/database';
import type { InvitationCreated, InvitationRow } from '@dealflow/types';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type InvitationWithRole = Prisma.InvitationGetPayload<{ include: { role: true } }>;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  list(auth: AuthContext): Promise<InvitationRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.invitation.findMany({
        where: { tenantId: auth.tenantId },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map(toRow);
    });
  }

  /**
   * Creates an invitation and returns its link once. Only the SHA-256 hash of the token is stored.
   * No email provider is configured yet, so nothing is sent: the inviter copies the link.
   */
  create(auth: AuthContext, input: { email: string; roleKey: string }, meta: RequestMeta): Promise<InvitationCreated> {
    return this.prisma.run(auth, async (tx) => {
      const role = await tx.role.findUnique({ where: { tenantId_key: { tenantId: auth.tenantId, key: input.roleKey } } });
      if (!role) throw new BadRequestException({ code: 'UNKNOWN_ROLE', message: 'That role does not exist.' });
      if (role.key === 'owner' && auth.roleKey !== 'owner') {
        throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Only an owner can invite another owner.' });
      }
      const member = await tx.membership.findFirst({
        where: { tenantId: auth.tenantId, status: 'ACTIVE', user: { email: input.email } },
        select: { id: true },
      });
      if (member) throw new ConflictException({ code: 'ALREADY_MEMBER', message: 'That person is already a member of this workspace.' });

      // A new invitation replaces any pending one for the same address.
      await tx.invitation.updateMany({
        where: { tenantId: auth.tenantId, email: input.email, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const token = randomBytes(32).toString('base64url');
      const row = await tx.invitation.create({
        data: {
          tenantId: auth.tenantId,
          email: input.email,
          roleId: role.id,
          tokenHash: TokenService.hashRefresh(token),
          invitedById: auth.userId,
          expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
        },
        include: { role: true },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'member.invited', entityType: 'invitation', entityId: row.id,
        metadata: { email: input.email, role: role.key }, meta,
      });
      const origin = this.env.WEB_ORIGINS.split(',')[0]!.trim().replace(/\/$/, '');
      const inviteUrl = `${origin}/invite/${token}`;
      if (this.env.NODE_ENV !== 'production') this.logger.log({ email: input.email }, `Invitation link (dev only, not emailed): ${inviteUrl}`);
      return { ...toRow(row), inviteUrl, emailDelivery: 'not_configured' };
    });
  }

  revoke(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    return this.prisma.run(auth, async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: { id, tenantId: auth.tenantId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pending invitation not found.' });
      await this.audit.record(tx, { tenantId: auth.tenantId, actorUserId: auth.userId, action: 'member.invitation_revoked', entityType: 'invitation', entityId: id, meta });
    });
  }
}

function toRow(r: InvitationWithRole): InvitationRow {
  const status = r.acceptedAt ? 'accepted' : r.revokedAt ? 'revoked' : r.expiresAt < new Date() ? 'expired' : 'pending';
  return {
    id: r.id,
    email: r.email,
    roleKey: r.role.key,
    roleName: r.role.name,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    status,
  };
}
