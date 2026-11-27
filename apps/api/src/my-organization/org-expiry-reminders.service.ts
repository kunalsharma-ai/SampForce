import { Injectable, Logger } from '@nestjs/common';
import type { TenantTx } from '@dealflow/database';
import { ORG_EXPIRY_WARNING_DAYS } from '@dealflow/types';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { errorMessage, scan } from '../worker/queue';
import { resolveOrganisation } from '../workspaces/access';
import { todayIso } from './my-organization.service';

const DAY = 86_400_000;
/** The sweep looks at most this often; expiry is counted in days. */
const EVERY_MS = 10 * 60_000;
const BATCH = 200;

/** The reminder a document is due, by how close its expiry date is. Each goes out once per expiry date. */
type Stage = 'month' | 'week' | 'expired';
const RANK: Record<Stage, number> = { month: 1, week: 2, expired: 3 };

export function stageOf(expiryDate: string, today: string): Stage | null {
  const days = Math.round((Date.parse(`${expiryDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY);
  if (days < 0) return 'expired';
  if (days <= 7) return 'week';
  if (days <= ORG_EXPIRY_WARNING_DAYS) return 'month';
  return null;
}

/**
 * Expiry reminders for organisation documents (ADR 0100): 30 days before, 7 days before and on expiry, to the people
 * who keep the documents up to date (the Super Workspace, and Manager Workspaces allowed to edit administration)
 * who may see the document. `remindedFor` holds "<expiry date>:<stage>", claimed with a conditional update so
 * several workers never send the same reminder twice, and a changed expiry date starts again.
 */
@Injectable()
export class OrgExpiryRemindersService {
  private readonly log = new Logger(OrgExpiryRemindersService.name);
  private last = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async sweep(now = new Date(), force = false): Promise<number> {
    if (!force && now.getTime() - this.last < EVERY_MS) return 0;
    this.last = now.getTime();
    const today = todayIso(now);
    const horizon = todayIso(new Date(now.getTime() + ORG_EXPIRY_WARNING_DAYS * DAY));
    const candidates = await scan(() =>
      this.prisma.orgDocument.findMany({ where: { expiryDate: { not: null, lte: horizon } }, select: { id: true, tenantId: true, expiryDate: true, remindedFor: true }, take: BATCH * 5 }),
    );
    const due = candidates.filter((d) => {
      const stage = stageOf(d.expiryDate!, today);
      if (!stage) return false;
      const [date, sent] = (d.remindedFor ?? '').split(':');
      return date !== d.expiryDate || !sent || RANK[stage] > (RANK[sent as Stage] ?? 0);
    });
    let sent = 0;
    for (const tenantId of new Set(due.slice(0, BATCH).map((d) => d.tenantId))) {
      try {
        sent += await this.prisma.run({ tenantId }, (tx) => this.remind(tx, tenantId, due.filter((d) => d.tenantId === tenantId), today));
      } catch (err) {
        this.log.error({ err: errorMessage(err), tenantId }, 'organization document reminders failed');
      }
    }
    return sent;
  }

  private async remind(tx: TenantTx, tenantId: string, docs: { id: string; expiryDate: string | null; remindedFor: string | null }[], today: string): Promise<number> {
    const org = await resolveOrganisation(tx, tenantId);
    const members = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' }, select: { userId: true, workspaceNodeId: true } });
    const keepers = { SUPER: [] as string[], MANAGER: [] as string[] };
    for (const m of members) {
      const node = m.workspaceNodeId ? org.byId.get(m.workspaceNodeId) : org.root;
      if (!node || node.node.archivedAt) continue;
      if (node.level === 'SUPER') keepers.SUPER.push(m.userId);
      else if (node.level === 'MANAGER' && (node.actions.Administration ?? []).includes('edit')) keepers.MANAGER.push(m.userId);
    }
    let n = 0;
    for (const d of docs) {
      const stage = stageOf(d.expiryDate!, today)!;
      const key = `${d.expiryDate}:${stage}`;
      const { count } = await tx.orgDocument.updateMany({ where: { id: d.id, tenantId, expiryDate: d.expiryDate, remindedFor: d.remindedFor }, data: { remindedFor: key } });
      if (!count) continue;
      const doc = await tx.orgDocument.findFirst({ where: { id: d.id, tenantId }, select: { title: true, visibility: true } });
      if (!doc) continue;
      const to = doc.visibility === 'SUPER' ? keepers.SUPER : [...keepers.SUPER, ...keepers.MANAGER];
      const title = stage === 'expired' ? `Document expired: ${doc.title}` : stage === 'week' ? `Document expires within a week: ${doc.title}` : `Document expires within 30 days: ${doc.title}`;
      await this.notifications.send(tx, tenantId, to, {
        type: 'organization.document_expiry',
        title,
        body: `Expiry date ${d.expiryDate}. Upload the renewed document in My Organization.`,
        link: `/app/my-organization?tab=documents&document=${d.id}`,
        eventId: `org-doc-expiry:${d.id}:${key}`,
        priority: stage === 'month' ? 'NORMAL' : 'HIGH',
      });
      n++;
    }
    return n;
  }
}
