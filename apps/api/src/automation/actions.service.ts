import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  companyUpdateSchema,
  contactUpdateSchema,
  dealUpdateSchema,
  leadUpdateSchema,
  type Permission,
  taskUpdateSchema,
  type WorkflowAction,
  type z,
} from '@dealflow/types';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { assertPublicUrl } from '../common/net-guard';
import { PrismaService } from '../common/prisma.service';
import { ActivitiesService } from '../crm/activities.service';
import { CompaniesService } from '../crm/companies.service';
import { ContactsService } from '../crm/contacts.service';
import { DealsService } from '../crm/deals.service';
import { LeadsService } from '../crm/leads.service';
import { TasksService } from '../crm/tasks.service';
import { CommunicationService } from '../integrations/communication.service';
import { NotificationsService } from '../notifications/notifications.service';
import { describeAction, type EvalContext, nextRoundRobin } from './engine';
import { relatedLinks, renderTemplate } from './records';

export interface RunInfo {
  workflowId: string;
  executionId: string;
  nodeId: string;
  entityType: string | null;
  entityId: string | null;
}

const WRITE_PERMISSION: Record<string, Permission> = {
  lead: 'leads:write',
  contact: 'contacts:write',
  company: 'companies:write',
  deal: 'deals:write',
  task: 'activities:write',
  activity: 'activities:write',
};

/** Thrown for problems a person must fix (permissions, missing data); the run fails with this message. */
export class ActionError extends Error {}

/**
 * Executes workflow actions through the same services the API uses, acting as the workflow's owner.
 * Every write therefore passes the usual validation, tenant checks and audit logging, and the owner's
 * current role decides what the workflow may do.
 */
@Injectable()
export class WorkflowActions {
  constructor(
    private readonly prisma: PrismaService,
    private readonly leads: LeadsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly deals: DealsService,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly notifications: NotificationsService,
    private readonly communication: CommunicationService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async run(actor: AuthContext, run: RunInfo, action: WorkflowAction, ctx: EvalContext): Promise<Record<string, unknown>> {
    const meta: RequestMeta = { requestId: `wf-${run.executionId}`, ipAddress: null, userAgent: 'dealflow-automation' };
    const need = (p: Permission) => {
      if (!actor.permissions.includes(p)) throw new ActionError(`The workflow owner's role does not allow this step (${p}).`);
    };
    const entity = run.entityType ?? '';
    const id = run.entityId;
    const text = (s: string) => renderTemplate(s, ctx);

    switch (action.type) {
      case 'create_task': {
        need('activities:write');
        const dueAt = action.dueInDays !== undefined ? new Date(Date.now() + action.dueInDays * 86_400_000).toISOString() : undefined;
        const task = await this.tasks.create(
          actor,
          { title: text(action.title).slice(0, 200), assigneeId: this.resolveUser(action.assignTo, actor, ctx), dueAt, ...relatedLinks(entity, id, ctx.record) },
          meta,
        );
        return { taskId: task.id, assigneeId: task.assignee?.id ?? null };
      }
      case 'assign_owner': {
        if (!id) throw new ActionError('This trigger has no record to assign.');
        need(WRITE_PERMISSION[entity] ?? 'leads:write');
        const ownerId = action.mode === 'user' ? action.userIds[0]! : nextRoundRobin(action.userIds, await this.lastAssignee(actor, run));
        await this.updateRecord(actor, entity, id, { ownerId }, meta);
        return { assignedTo: ownerId };
      }
      case 'update_field': {
        if (!id) throw new ActionError('This trigger has no record to update.');
        need(WRITE_PERMISSION[entity] ?? 'leads:write');
        await this.updateRecord(actor, entity, id, { [action.field]: action.value }, meta);
        return { field: action.field, value: action.value };
      }
      case 'add_tag': {
        if (entity !== 'lead' || !id) throw new ActionError('Tags can only be added to leads.');
        need('leads:write');
        const lead = await this.leads.get(actor, id);
        if (lead.tags.some((t) => t.toLowerCase() === action.tag.toLowerCase())) return { tag: action.tag, alreadyPresent: true };
        if (lead.tags.length >= 20) throw new ActionError('The lead already has the maximum of 20 tags.');
        await this.leads.update(actor, id, { tags: [...lead.tags, action.tag] }, meta);
        return { tag: action.tag };
      }
      case 'notify': {
        const userId = this.resolveUser(action.to, actor, ctx);
        await this.prisma.run(actor, async (tx) => {
          const member = await tx.membership.findFirst({ where: { tenantId: actor.tenantId, userId, status: 'ACTIVE' }, select: { id: true } });
          if (!member) throw new ActionError('The person to notify is no longer a member of this workspace.');
          await this.notifications.send(tx, actor.tenantId, [userId], {
            type: 'workflow.notify',
            title: text(action.title),
            body: action.body ? text(action.body) : null,
            link: recordLink(entity, id),
          });
        });
        return { notified: userId };
      }
      case 'log_note': {
        need('activities:write');
        const links = relatedLinks(entity, id, ctx.record);
        if (!Object.values(links).some(Boolean)) throw new ActionError('There is no record to log the note on.');
        const note = await this.activities.create(actor, { type: 'NOTE', subject: text(action.subject).slice(0, 200), body: action.body ? text(action.body) : undefined, ...links }, meta);
        return { activityId: note.id };
      }
      case 'send_webhook': {
        // Reached only after a person approved this exact step.
        const url = await assertPublicUrl(action.url, this.env.ALLOW_PRIVATE_NETWORK_TARGETS);
        const body = JSON.stringify({ workflowId: run.workflowId, executionId: run.executionId, entityType: entity, entityId: id, record: ctx.record, sentAt: new Date().toISOString() });
        const t = Math.floor(Date.now() / 1000);
        const sig = createHmac('sha256', run.workflowId).update(`${t}.${body}`).digest('hex');
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'user-agent': 'DealFlow-Automation/1.0', 'X-DealFlow-Workflow-Signature': `t=${t},v1=${sig}` },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status < 200 || res.status >= 300) throw new ActionError(`The endpoint answered ${res.status}.`);
        return { status: res.status, host: url.host };
      }
      case 'send_email': {
        need('activities:write');
        const to = typeof ctx.record?.email === 'string' ? ctx.record.email : null;
        if (!to) throw new ActionError('The record has no email address.');
        const links = entity === 'lead' ? { leadId: id ?? undefined } : entity === 'contact' ? { contactId: id ?? undefined } : {};
        const email = await this.communication.send(actor, { to, subject: text(action.subject).slice(0, 200), body: text(action.body), ...links }, meta);
        return { emailId: email.id, to };
      }
    }
  }

  /** Human-readable description used in simulations, approvals and run history. */
  describe(action: WorkflowAction, ctx: EvalContext): string {
    // Show text as it would be sent, with {{record.*}} placeholders filled in.
    const rendered = Object.fromEntries(Object.entries(action).map(([k, v]) => [k, typeof v === 'string' && k !== 'type' ? renderTemplate(v, ctx) : v])) as WorkflowAction;
    const base = describeAction(rendered);
    return action.type === 'send_email' && typeof ctx.record?.email === 'string' ? `${base} to ${ctx.record.email}` : base;
  }

  private resolveUser(who: string, actor: AuthContext, ctx: EvalContext): string {
    if (who === 'trigger_actor') return typeof ctx.event.actorUserId === 'string' ? ctx.event.actorUserId : actor.userId;
    if (who === 'record_owner') {
      const r = ctx.record as { owner?: { id?: string } | null; assignee?: { id?: string } | null } | null;
      return r?.owner?.id ?? r?.assignee?.id ?? actor.userId;
    }
    return who;
  }

  /** Validates the change with the same schema the API uses for that record type. */
  private async updateRecord(actor: AuthContext, entity: string, id: string, patch: Record<string, unknown>, meta: RequestMeta): Promise<void> {
    const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
      const r = schema.safeParse(value);
      if (!r.success) throw new ActionError(`Invalid value: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
      return r.data;
    };
    switch (entity) {
      case 'lead':
        await this.leads.update(actor, id, parse(leadUpdateSchema, patch), meta);
        return;
      case 'deal':
        await this.deals.update(actor, id, parse(dealUpdateSchema, patch), meta);
        return;
      case 'contact':
        await this.contacts.update(actor, id, parse(contactUpdateSchema, patch), meta);
        return;
      case 'company':
        await this.companies.update(actor, id, parse(companyUpdateSchema, patch), meta);
        return;
      case 'task':
        await this.tasks.update(actor, id, parse(taskUpdateSchema, 'ownerId' in patch ? { assigneeId: patch.ownerId } : patch), meta);
        return;
      default:
        throw new ActionError(`Records of type "${entity}" cannot be changed by a workflow.`);
    }
  }

  /** The user this workflow step assigned most recently, for round robin. */
  private async lastAssignee(actor: AuthContext, run: RunInfo): Promise<string | null> {
    const step = await this.prisma.run(actor, (tx) =>
      tx.workflowStep.findFirst({
        where: { tenantId: actor.tenantId, nodeId: run.nodeId, status: 'succeeded', execution: { workflowId: run.workflowId } },
        orderBy: { startedAt: 'desc' },
        select: { output: true },
      }),
    );
    const out = step?.output as { assignedTo?: unknown } | undefined;
    return typeof out?.assignedTo === 'string' ? out.assignedTo : null;
  }
}

export function recordLink(entity: string | null, id: string | null): string | null {
  if (!id) return null;
  switch (entity) {
    case 'lead':
      return `/app/leads/${id}`;
    case 'contact':
      return `/app/contacts/${id}`;
    case 'company':
      return `/app/companies/${id}`;
    case 'deal':
      return `/app/deals/${id}`;
    case 'task':
    case 'activity':
      return '/app/activities';
    default:
      return null;
  }
}
