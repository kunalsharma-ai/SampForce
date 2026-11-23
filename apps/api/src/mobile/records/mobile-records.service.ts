import { BadRequestException, Injectable } from '@nestjs/common';
import {
  type CompanyRow,
  companyInputSchema,
  companyUpdateSchema,
  type ContactRow,
  contactInputSchema,
  contactUpdateSchema,
  type FollowUpRow,
  followUpInputSchema,
  followUpUpdateSchema,
  type ListQuery,
  type MobileLiveRecordModule,
  type MobileRecord,
  type MobileRecordListQuery,
  type MobileRecordOptions,
  type MobileRecordPage,
  type MobileRecordWrite,
  type MobileResolvedConfig,
  type TaskRow,
  taskInputSchema,
  taskUpdateSchema,
} from '@dealflow/types';
import type { ZodTypeAny } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';
import { CompaniesService } from '../../crm/companies.service';
import { CompanyLeadsService } from '../../crm/company-leads.service';
import { CompanyWorkService } from '../../crm/company-work.service';
import { ContactsService } from '../../crm/contacts.service';
import { CrmAdminService } from '../../crm/crm-admin.service';
import { CrmConfigService } from '../../crm/crm-config.service';
import { CustomFieldsService } from '../../crm/custom-fields.service';
import { TasksService } from '../../crm/tasks.service';
import { checkMobileDelete, checkMobileWrite, mobileReadable, moduleOf } from '../field-policy';
import { MobileConfigService } from '../mobile-config.service';

/*
 * Records on the phone (ADR 0072, M4). Each module is the web's own service, so visibility, ownership, audit and
 * notifications are exactly the web's. This layer only translates between the phone's field names (MOBILE_FIELDS)
 * and the services', and applies the person's field rules in both directions.
 */

const PAGE_SIZE = 25;
/** The custom field entity behind each module (tasks have none). */
const CUSTOM_FIELD_ENTITY: Partial<Record<MobileLiveRecordModule, string>> = { companies: 'COMPANY', contacts: 'CONTACT', follow_ups: 'FOLLOW_UP' };
const ref = (x: { id: string; name: string } | null | undefined) => (x ? { id: x.id, name: x.name } : null);

/** Phone field name → the service's input name, where they differ. */
const INPUT_NAMES: Record<MobileLiveRecordModule, Record<string, string>> = {
  companies: { status: 'statusId', owner: 'ownerId' },
  contacts: { company: 'companyId', owner: 'ownerId' },
  follow_ups: { followUpType: 'type', company: 'companyId', contact: 'contactId', assignee: 'assigneeId' },
  tasks: { assignee: 'assigneeId' },
};

const SCHEMAS: Record<MobileLiveRecordModule, { create: ZodTypeAny; edit: ZodTypeAny }> = {
  companies: { create: companyInputSchema, edit: companyUpdateSchema },
  contacts: { create: contactInputSchema, edit: contactUpdateSchema },
  follow_ups: { create: followUpInputSchema, edit: followUpUpdateSchema },
  tasks: { create: taskInputSchema, edit: taskUpdateSchema },
};

export function companyToMobile(r: CompanyRow): MobileRecord {
  return {
    id: r.id,
    updatedAt: r.updatedAt,
    name: r.name,
    leadNumber: r.leadNumber,
    status: r.status ? { id: r.status.id, name: r.status.name, color: r.status.color } : null,
    owner: ref(r.ownerPerson ?? r.owner),
    primaryEmail: r.primaryEmail,
    primaryPhone: r.primaryPhone,
    website: r.website,
    industry: r.industry,
    country: r.country,
    city: r.city,
    address: r.address,
    companySize: r.companySize,
    nextFollowUpAt: (r as CompanyRow & { nextFollowUpAt?: string | null }).nextFollowUpAt ?? null,
    notes: r.notes,
    createdAt: r.createdAt,
    customFields: r.customFields ?? {},
  };
}

export function contactToMobile(r: ContactRow): MobileRecord {
  return {
    id: r.id,
    updatedAt: r.updatedAt,
    firstName: r.firstName,
    lastName: r.lastName,
    jobTitle: r.jobTitle,
    company: ref(r.company),
    email: r.email,
    phone: r.phone,
    department: r.department,
    city: r.city,
    owner: ref(r.owner),
    nextFollowUpAt: r.nextFollowUpAt,
    remarks: r.remarks,
    customFields: r.customFields ?? {},
  };
}

export function followUpToMobile(r: FollowUpRow): MobileRecord {
  return {
    id: r.id,
    title: r.title,
    dueAt: r.dueAt,
    followUpType: r.type,
    company: ref(r.company),
    contact: ref(r.contact),
    assignee: ref(r.assignee),
    status: r.status,
    priority: r.priority,
    outcome: r.outcome,
    remarks: r.remarks,
    customFields: r.customFields ?? {},
  };
}

export function taskToMobile(r: TaskRow): MobileRecord {
  return { id: r.id, title: r.title, description: r.description, dueAt: r.dueAt, priority: r.priority, status: r.status, assignee: ref(r.assignee) };
}

/** Maps the phone's names to the service's and validates with the CRM's own schema; errors come back in phone names. */
export function toServiceInput(module: MobileLiveRecordModule, mode: 'create' | 'edit', body: MobileRecordWrite): Record<string, unknown> {
  const names = INPUT_NAMES[module];
  const back = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]));
  const input = Object.fromEntries(Object.entries(body).map(([k, v]) => [names[k] ?? k, v]));
  const parsed = SCHEMAS[module][mode].safeParse(input);
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request contains invalid fields.',
      details: parsed.error.issues.map((i) => {
        const [first, ...rest] = i.path.map(String);
        return { path: [back[first ?? ''] ?? first, ...rest].join('.'), message: i.message };
      }),
    });
  }
  return parsed.data as Record<string, unknown>;
}

@Injectable()
export class MobileRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configs: MobileConfigService,
    private readonly companies: CompaniesService,
    private readonly contacts: ContactsService,
    private readonly work: CompanyWorkService,
    private readonly tasks: TasksService,
    private readonly crmConfig: CrmConfigService,
    private readonly crmAdmin: CrmAdminService,
    private readonly leads: CompanyLeadsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  private config(auth: AuthContext): Promise<MobileResolvedConfig> {
    return this.prisma.run(auth, (tx) => this.configs.resolvedFor(tx, auth));
  }

  private readable(config: MobileResolvedConfig, module: MobileLiveRecordModule, r: MobileRecord): MobileRecord {
    return mobileReadable(config, module, r) as MobileRecord;
  }

  async list(auth: AuthContext, module: MobileLiveRecordModule, q: MobileRecordListQuery): Promise<MobileRecordPage> {
    const config = await this.config(auth);
    moduleOf(config, module);
    const page = q.page;
    let rows: MobileRecord[];
    let hasMore: boolean;
    if (module === 'companies' || module === 'contacts') {
      const lq = { page, pageSize: PAGE_SIZE, q: q.q, order: 'desc' } as ListQuery;
      if (module === 'companies') {
        const res = await this.companies.list(auth, lq);
        rows = res.items.map(companyToMobile);
        hasMore = res.page * res.pageSize < res.total;
      } else {
        const res = await this.contacts.list(auth, { ...lq, companyId: q.companyId });
        rows = res.items.map(contactToMobile);
        hasMore = res.page * res.pageSize < res.total;
      }
    } else {
      // Follow-ups and tasks come as one list from the services; the phone gets them a page at a time.
      const all =
        module === 'follow_ups'
          ? (await this.work.followUps(auth, { bucket: q.bucket ?? 'today', scope: 'mine', tz: q.tz ?? 'UTC', companyId: q.companyId })).map(followUpToMobile)
          : (await this.tasks.list(auth, { scope: 'mine', status: q.status ?? 'OPEN' }, { withoutFollowUps: true })).map(taskToMobile);
      const needle = q.q?.toLowerCase();
      const found = needle ? all.filter((r) => String(r.title ?? '').toLowerCase().includes(needle)) : all;
      rows = found.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      hasMore = found.length > page * PAGE_SIZE;
    }
    return { items: rows.map((r) => this.readable(config, module, r)), page, hasMore };
  }

  private async current(auth: AuthContext, module: MobileLiveRecordModule, id: string, tz?: string): Promise<MobileRecord> {
    switch (module) {
      case 'companies':
        return companyToMobile(await this.companies.get(auth, id));
      case 'contacts':
        return contactToMobile(await this.contacts.get(auth, id));
      case 'follow_ups':
        return followUpToMobile(await this.work.followUp(auth, id, tz));
      case 'tasks':
        return taskToMobile(await this.tasks.get(auth, id));
    }
  }

  async get(auth: AuthContext, module: MobileLiveRecordModule, id: string, tz?: string): Promise<MobileRecord> {
    const config = await this.config(auth);
    moduleOf(config, module);
    return this.readable(config, module, await this.current(auth, module, id, tz));
  }

  async create(auth: AuthContext, module: MobileLiveRecordModule, body: MobileRecordWrite, meta: RequestMeta): Promise<MobileRecord> {
    const config = await this.config(auth);
    checkMobileWrite(config, module, 'create', body);
    const input = toServiceInput(module, 'create', body);
    let row: MobileRecord;
    switch (module) {
      case 'companies':
        row = companyToMobile(await this.companies.create(auth, input as never, meta));
        break;
      case 'contacts':
        row = contactToMobile(await this.contacts.create(auth, input as never, meta));
        break;
      case 'follow_ups':
        row = followUpToMobile(await this.work.createFollowUp(auth, input as never, meta));
        break;
      case 'tasks':
        row = taskToMobile(await this.tasks.create(auth, input as never, meta));
        break;
    }
    return this.readable(config, module, row);
  }

  async update(auth: AuthContext, module: MobileLiveRecordModule, id: string, body: MobileRecordWrite, meta: RequestMeta): Promise<MobileRecord> {
    const config = await this.config(auth);
    moduleOf(config, module);
    // The stored record decides whether a change clears a value (which needs the field's delete rule).
    const before = await this.current(auth, module, id);
    checkMobileWrite(config, module, 'edit', body, before);
    let row: MobileRecord;
    switch (module) {
      case 'companies':
        row = companyToMobile(await this.companies.update(auth, id, toServiceInput(module, 'edit', body) as never, meta));
        break;
      case 'contacts':
        row = contactToMobile(await this.contacts.update(auth, id, toServiceInput(module, 'edit', body) as never, meta));
        break;
      case 'follow_ups': {
        // Status and outcome change through completing or cancelling, as on the web.
        const { status, outcome, ...rest } = body;
        let r: FollowUpRow | null = null;
        if (Object.keys(rest).length) r = await this.work.updateFollowUp(auth, id, toServiceInput(module, 'edit', rest) as never, meta);
        if (status === 'DONE') r = await this.work.completeFollowUp(auth, id, typeof outcome === 'string' ? outcome : null, meta);
        else if (status === 'CANCELED') r = await this.work.cancelFollowUp(auth, id, meta);
        else if (status !== undefined || outcome !== undefined) throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The request contains invalid fields.', details: [{ path: status !== undefined ? 'status' : 'outcome', message: 'Mark the follow-up done or cancel it.' }] });
        row = followUpToMobile(r ?? (await this.work.followUp(auth, id)));
        break;
      }
      case 'tasks':
        row = taskToMobile(await this.tasks.update(auth, id, toServiceInput(module, 'edit', body) as never, meta));
        break;
    }
    return this.readable(config, module, row);
  }

  async remove(auth: AuthContext, module: MobileLiveRecordModule, id: string, meta: RequestMeta): Promise<void> {
    checkMobileDelete(await this.config(auth), module);
    switch (module) {
      case 'companies':
        return this.companies.remove(auth, id, meta);
      case 'contacts':
        return this.contacts.remove(auth, id, meta);
      case 'follow_ups':
        await this.work.cancelFollowUp(auth, id, meta);
        return;
      case 'tasks':
        return this.tasks.remove(auth, id, meta);
    }
  }

  async options(auth: AuthContext): Promise<MobileRecordOptions> {
    const [config, companyStatuses, contactStatuses, types, people, defs] = await Promise.all([
      this.config(auth),
      this.crmConfig.statuses(auth, 'COMPANY'),
      this.crmConfig.statuses(auth, 'EMPLOYEE'),
      this.crmAdmin.options(auth, 'FOLLOW_UP_TYPE'),
      this.leads.people(auth),
      this.customFields.list(auth),
    ]);
    const customFields: MobileRecordOptions['customFields'] = {};
    for (const [module, entity] of Object.entries(CUSTOM_FIELD_ENTITY) as [MobileLiveRecordModule, string][]) {
      const shown = config.fields[module];
      if (!shown) continue;
      customFields[module] = defs
        .filter((d) => d.entity === entity && d.active && d.access.view && shown[`cf.${d.key}`])
        .map((d) => ({ key: d.key, label: d.label, type: d.type, options: d.options, edit: d.access.edit && d.type !== 'FORMULA' && d.type !== 'FILE' }));
    }
    const status = (s: { id: string; name: string; color: string; active?: boolean }) => ({ id: s.id, name: s.name, color: s.color });
    return {
      companyStatuses: companyStatuses.filter((s) => (s as { active?: boolean }).active !== false).map(status),
      contactStatuses: contactStatuses.filter((s) => (s as { active?: boolean }).active !== false).map(status),
      followUpTypes: types.filter((t) => t.active).map((t) => ({ key: t.value, label: t.label })),
      people: people.filter((p) => p.assignable).map((p) => ({ id: p.id, name: p.name })),
      customFields,
    };
  }
}
