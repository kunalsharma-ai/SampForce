import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { toActivityRow } from '../crm/activities.service';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { ownerRefs } from '../crm/crm-helpers';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';
import { toTaskRow } from '../crm/tasks.service';

export type RecordEntity = 'lead' | 'contact' | 'company' | 'deal' | 'task' | 'activity';

/**
 * Loads the record an automation is about, in the same shape the API returns, so conditions use the
 * field names people see in the app. Returns null when the record was deleted.
 */
@Injectable()
export class AutomationRecords {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly deals: DealsService,
  ) {}

  async load(auth: Pick<AuthContext, 'tenantId' | 'userId'>, entity: string | null, id: string | null): Promise<Record<string, unknown> | null> {
    if (!entity || !id) return null;
    const a = auth as AuthContext;
    try {
      switch (entity as RecordEntity) {
        case 'lead':
          return { ...(await this.leads.get(a, id)) };
        case 'contact':
          return { ...(await this.contacts.get(a, id)) };
        case 'company':
          return { ...(await this.companies.get(a, id)) };
        case 'deal':
          return { ...(await this.deals.get(a, id)) };
        case 'task':
          return this.prisma.run(auth, async (tx) => {
            const row = await tx.task.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
            return row ? { ...toTaskRow(row, await ownerRefs(tx, [row.assigneeId]), new Date()) } : null;
          });
        case 'activity':
          return this.prisma.run(auth, async (tx) => {
            const row = await tx.activity.findFirst({ where: { id, tenantId: auth.tenantId, deletedAt: null } });
            return row ? { ...toActivityRow(row, await ownerRefs(tx, [row.ownerId])) } : null;
          });
        default:
          return null;
      }
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}

/** Links that relate a new task or note to the record that triggered the run. */
export function relatedLinks(entity: string | null, id: string | null, record: Record<string, unknown> | null) {
  const pick = (k: string) => (record && typeof record[k] === 'string' ? (record[k] as string) : undefined);
  switch (entity) {
    case 'lead':
      return { leadId: id ?? undefined };
    case 'contact':
      return { contactId: id ?? undefined };
    case 'deal': {
      const contact = record?.contact as { id?: string } | null | undefined;
      return { opportunityId: id ?? undefined, contactId: contact?.id };
    }
    case 'company':
      return { companyId: id ?? undefined };
    case 'task':
    case 'activity':
      return { leadId: pick('leadId'), contactId: pick('contactId'), opportunityId: pick('opportunityId') };
    default:
      return {};
  }
}

/** Replaces `{{record.field}}` / `{{event.field}}` placeholders in workflow text. */
export function renderTemplate(text: string, ctx: { record: Record<string, unknown> | null; event: Record<string, unknown> }): string {
  return text.replace(/\{\{\s*(record|event)\.([A-Za-z0-9_.]{1,80})\s*\}\}/g, (_, root: string, path: string) => {
    let cur: unknown = root === 'record' ? ctx.record : ctx.event;
    for (const k of path.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    return cur === null || cur === undefined ? '' : typeof cur === 'object' ? '' : String(cur);
  });
}
