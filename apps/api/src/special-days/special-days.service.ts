import { randomUUID } from 'node:crypto';
import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, TenantTx } from '@dealflow/database';
import {
  type CompanyEvent,
  companyEventOn,
  type CompanyEventsInput,
  type CompanyEventsSettings,
  companyEventSchema,
  countryOfZone,
  geoCountry,
  holidayEmoji,
  isZoneName,
  type SpecialDay,
  type TodaySpecialDays,
  worldDaysOn,
} from '@dealflow/types';
import Holidays from 'date-holidays';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { requestLanguage } from '../common/request-language';
import { inSuperWorkspace } from '../crm/super-workspace';

/**
 * Festivals the open holiday data leaves out of a country's own calendar but computes for another one, borrowed by
 * name (India's data has no Diwali or Holi; Singapore, Suriname and Malaysia compute them).
 */
const BORROWED: Record<string, readonly { from: string; match: RegExp; name: string }[]> = {
  IN: [
    { from: 'SR', match: /holi/i, name: 'Holi' },
    { from: 'SG', match: /deepavali/i, name: 'Diwali' },
    { from: 'MY', match: /eid al-fitr/i, name: 'Eid al-Fitr' },
    { from: 'MY', match: /eid al-adha/i, name: 'Eid al-Adha' },
    { from: 'MU', match: /ganesh/i, name: 'Ganesh Chaturthi' },
  ],
};

/** Old zone names browsers still report (Chrome says Asia/Calcutta), mapped to the names the zone table uses. */
const ZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Dacca': 'Asia/Dhaka',
  'Asia/Thimbu': 'Asia/Thimphu',
  'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
  'Europe/Kiev': 'Europe/Kyiv',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Pacific/Truk': 'Pacific/Chuuk',
  'Pacific/Ponape': 'Pacific/Pohnpei',
};

/**
 * Today's special days for the home dashboards (Kunal, 2026-11-27): public holidays and observances in the person's
 * country from the open date-holidays data, well-known world days, and the company's own events set by the Super
 * Workspace. The person's browser sends its own date and time zone, so "today" is their today.
 */
@Injectable()
export class SpecialDaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Public holidays, observances and world days on `date` in `country`, without company events (the Console uses this). */
  publicDays(date: string, country: string | null): SpecialDay[] {
    const language = requestLanguage();
    const out: SpecialDay[] = [];
    const seen = new Set<string>();
    const add = (d: SpecialDay) => {
      const key = d.name.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      out.push(d);
    };
    const year = Number(date.slice(0, 4));
    if (country && new Holidays().getCountries()[country]) {
      const types: ('public' | 'observance')[] = ['public', 'observance'];
      const named = (new Holidays(country, '', { languages: [language, 'en'], types }).getHolidays(year) ?? []).filter((h) => h.date.slice(0, 10) === date);
      // The emoji follows the English name, which the patterns know.
      const english = new Map((new Holidays(country, '', { languages: ['en'], types }).getHolidays(year) ?? []).map((h) => [`${h.date}|${h.rule}`, h.name]));
      for (const h of named) {
        add({ kind: h.type === 'public' ? 'HOLIDAY' : 'OBSERVANCE', name: h.name, emoji: holidayEmoji(english.get(`${h.date}|${h.rule}`) ?? h.name), note: null });
      }
      for (const b of BORROWED[country] ?? []) {
        const first = (new Holidays(b.from, '', { languages: ['en'] }).getHolidays(year) ?? []).filter((x) => b.match.test(x.name)).map((x) => x.date.slice(0, 10)).sort()[0];
        if (first === date) add({ kind: 'HOLIDAY', name: b.name, emoji: holidayEmoji(b.name), note: null });
      }
    }
    for (const d of worldDaysOn(date, language)) add(d);
    return out;
  }

  /** The country to check: the person's own time zone first, then the organisation's country. */
  countryFor(zone: string | undefined, fallback: string | null): string | null {
    const fromZone = isZoneName(zone) ? (countryOfZone(zone!) ?? countryOfZone(ZONE_ALIASES[zone!] ?? zone!)) : null;
    const code = fromZone ?? fallback;
    return code ? (geoCountry(code)?.code ?? code.toUpperCase()) : null;
  }

  today(auth: AuthContext, date: string, zone: string | undefined): Promise<TodaySpecialDays> {
    return this.prisma.run(auth, async (tx) => {
      const tenant = await tx.tenant.findUnique({ where: { id: auth.tenantId }, select: { countryCode: true } });
      const country = this.countryFor(zone, tenant?.countryCode ?? null);
      const company = (await this.eventsIn(tx, auth.tenantId))
        .filter((e) => companyEventOn(e, date))
        .map<SpecialDay>((e) => ({ kind: 'COMPANY', name: e.title, emoji: e.emoji || '🎉', note: e.note }));
      return { date, country, days: [...company, ...this.publicDays(date, country)] };
    });
  }

  // ───────────── Company events ─────────────

  private async eventsIn(tx: TenantTx, tenantId: string): Promise<CompanyEvent[]> {
    const row = await tx.crmSettings.findUnique({ where: { tenantId }, select: { companyEvents: true } });
    const raw = Array.isArray(row?.companyEvents) ? (row.companyEvents as unknown[]) : [];
    return raw.flatMap((r) => {
      const { id, ...rest } = (r ?? {}) as { id?: unknown };
      const parsed = companyEventSchema.safeParse(rest);
      return parsed.success && typeof id === 'string' ? [{ ...parsed.data, id }] : [];
    });
  }

  events(auth: AuthContext): Promise<CompanyEventsSettings> {
    return this.prisma.run(auth, async (tx) => ({
      events: (await this.eventsIn(tx, auth.tenantId)).sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || a.title.localeCompare(b.title)),
      canEdit: auth.permissions.includes('crm:configure') && (await inSuperWorkspace(tx, auth)),
    }));
  }

  /** Only the Super Workspace sets the company's events, for everyone in the organisation. */
  setEvents(auth: AuthContext, input: CompanyEventsInput, meta: RequestMeta): Promise<CompanyEventsSettings> {
    return this.prisma.run(auth, async (tx) => {
      if (!(await inSuperWorkspace(tx, auth))) {
        throw new ForbiddenException({ code: 'COMPANY_EVENTS_SUPER_ONLY', message: 'Only the Super Workspace sets company events.' });
      }
      const before = await this.eventsIn(tx, auth.tenantId);
      const events = input.events.map(({ id, ...e }) => ({ ...companyEventSchema.parse(e), id: id && before.some((b) => b.id === id) ? id : randomUUID() }));
      const value = events as unknown as Prisma.InputJsonValue;
      await tx.crmSettings.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, companyEvents: value, updatedById: auth.userId },
        update: { companyEvents: value, updatedById: auth.userId },
      });
      await this.audit.record(tx, {
        tenantId: auth.tenantId, actorUserId: auth.userId, action: 'crm_settings.company_events_updated', entityType: 'tenant', entityId: auth.tenantId,
        metadata: { before: before.length, after: events.length, titles: events.map((e) => e.title).slice(0, 20) }, meta,
      });
      return { events: events.sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || a.title.localeCompare(b.title)), canEdit: true };
    });
  }
}
