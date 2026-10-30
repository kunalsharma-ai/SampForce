import { Controller, Get, Query } from '@nestjs/common';
import { type CursorPage, type CursorPageQuery, cursorPageQuerySchema } from '@dealflow/types';
import { Auth, type AuthContext, RequirePermissions } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

export interface AuditLogRow {
  id: string;
  action: string;
  actorType: string;
  actorName: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  createdAt: string;
}

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(
    @Auth() auth: AuthContext,
    @Query(new ZodPipe(cursorPageQuerySchema)) q: CursorPageQuery,
  ): Promise<CursorPage<AuditLogRow>> {
    const rows = await this.prisma.run(auth, (tx) =>
      tx.auditLog.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
    );
    const page = rows.slice(0, q.limit);
    const names = await this.actorNames(page.map((r) => r.actorUserId));
    return {
      items: page.map((r) => ({
        id: r.id,
        action: r.action,
        actorType: r.actorType,
        actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null,
        entityType: r.entityType,
        entityId: r.entityId,
        metadata: r.metadata,
        ipAddress: r.ipAddress,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor: rows.length > q.limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async actorNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((v): v is string => !!v))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }
}
