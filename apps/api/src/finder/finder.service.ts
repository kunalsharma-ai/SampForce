import { HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  applyPattern,
  detectPattern,
  type DomainSource,
  domainGuesses,
  type EmailPattern,
  type ExtensionCaptureResult,
  type FinderEmail,
  type FinderHistoryRow,
  type FinderResult,
  type FinderSaveInput,
  type FinderSearchInput,
  type FinderUsage,
  isPersonalEmail,
  siteDomain,
  splitName,
} from '@dealflow/types';
import type { Prisma } from '@dealflow/database';
import type { AuthContext, RequestMeta } from '../common/auth-context';
import { API_ENV, type ApiEnv } from '../common/env';
import { PrismaService } from '../common/prisma.service';
import { ExtensionService } from '../extension/extension.service';
import { belongsTo, extractEmails, interestingLinks, nameFromEmail, pageText, siteName } from './extract';
import { HunterClient, type ProviderEmail } from './hunter';
import { FinderNet } from './net';

const DAY = 86_400_000;
const MAX_PAGES = 8;
const DEFAULT_PATHS = ['/contact', '/contact-us', '/about', '/about-us', '/team', '/our-team', '/people', '/impressum'];
/** Common patterns, most used first, offered as unchecked guesses when nothing better is known. */
const COMMON: EmailPattern[] = ['{first}.{last}', '{first}', '{f}{last}'];

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Every significant word of the company name appears on the page. */
function pageMatchesCompany(html: string, company: string): boolean {
  const text = fold(pageText(html));
  const words = fold(company)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !/^(inc|llc|ltd|limited|gmbh|plc|corp|the|and|company)$/.test(w));
  return words.length > 0 && words.every((w) => text.includes(w));
}

/**
 * Email finder. For a company it finds the website (from what was typed, the company record, a provider, or by
 * checking likely domains), reads up to eight public contact/about/team pages that robots.txt allows, keeps the
 * addresses at that domain, and works out the address pattern from the named ones. For a person it returns the
 * published address when there is one, else the provider's, else one built from the pattern, else plain guesses.
 */
@Injectable()
export class FinderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly net: FinderNet,
    private readonly hunter: HunterClient,
    private readonly extension: ExtensionService,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async usage(auth: AuthContext): Promise<FinderUsage> {
    const used = await this.prisma.run(auth, (tx) => tx.finderLookup.count({ where: { tenantId: auth.tenantId, userId: auth.userId, createdAt: { gt: new Date(Date.now() - DAY) } } }));
    return { used, limit: this.env.FINDER_DAILY_LIMIT, provider: this.hunter.configured };
  }

  history(auth: AuthContext): Promise<FinderHistoryRow[]> {
    return this.prisma.run(auth, async (tx) => {
      const rows = await tx.finderLookup.findMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, orderBy: { createdAt: 'desc' }, take: 20 });
      return rows.map((r) => ({ id: r.id, companyName: r.companyName, domain: r.domain, person: r.person, found: r.found, createdAt: r.createdAt.toISOString() }));
    });
  }

  get(auth: AuthContext, id: string): Promise<FinderResult> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.finderLookup.findFirst({ where: { id, tenantId: auth.tenantId, userId: auth.userId } });
      if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Lookup not found.' });
      const result = row.result as unknown as FinderResult;
      // Refresh "already in SampForce" so saved people show as saved.
      const all = [...result.emails, ...result.person];
      const { out, suppressed } = await this.extension.matches(tx, auth.tenantId, [...new Set(all.map((e) => e.email))]);
      for (const e of all) {
        e.match = out.get(e.email) ?? null;
        e.suppressed = suppressed.has(e.email);
      }
      return result;
    });
  }

  async search(auth: AuthContext, input: FinderSearchInput): Promise<FinderResult> {
    const { used, limit } = await this.usage(auth);
    if (used >= limit) {
      throw new HttpException({ code: 'FINDER_LIMIT', message: `You have used today's ${limit} lookups. The limit resets 24 hours after each lookup.` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const notes: string[] = [];
    const typed = input.company.trim();
    const looksLikeSite = /\.[a-z]{2,}(\/|$)/i.test(typed) && !/\s/.test(typed);

    // 1. The company's domain.
    let domain: string | null = null;
    let domainSource: DomainSource | null = null;
    let companyName = typed;
    const company = await this.prisma.run(auth, (tx) =>
      looksLikeSite
        ? tx.company.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, domain: { in: [siteDomain(typed)!, `www.${siteDomain(typed)}`], mode: 'insensitive' } }, select: { id: true, name: true, domain: true } })
        : tx.company.findFirst({ where: { tenantId: auth.tenantId, deletedAt: null, name: { equals: typed, mode: 'insensitive' } }, select: { id: true, name: true, domain: true } }),
    );
    if (looksLikeSite) {
      domain = siteDomain(typed);
      domainSource = 'given';
    } else if (company?.domain) {
      domain = siteDomain(company.domain);
      domainSource = 'dealflow';
    }

    let provider: FinderResult['provider'] = this.hunter.configured ? 'used' : 'not_configured';
    let providerEmails: ProviderEmail[] = [];
    if (this.hunter.configured) {
      try {
        const r = await this.hunter.domainSearch(domain ? { domain } : { company: typed });
        providerEmails = r.emails;
        if (!domain && r.domain) {
          domain = siteDomain(r.domain);
          domainSource = 'provider';
        }
      } catch {
        provider = 'failed';
        notes.push('The data provider did not answer, so these results come from SampForce’s own finder only.');
      }
    }

    let home: { url: string; html: string } | null = null;
    if (domain) {
      home = (await this.net.page(`https://${domain}/`)) ?? (await this.net.page(`https://www.${domain}/`));
    } else {
      for (const guess of domainGuesses(typed)) {
        const page = await this.net.page(`https://${guess}/`);
        if (page && pageMatchesCompany(page.html, typed)) {
          domain = guess;
          domainSource = 'website';
          home = page;
          break;
        }
      }
    }
    if (home) companyName = company?.name ?? (looksLikeSite ? siteName(home.html) ?? typed : typed);
    if (company) companyName = company.name;

    // 2. Its public pages.
    const found = new Map<string, { email: string; name: string | null; sourceUrl: string }>();
    let pagesRead = 0;
    if (domain && home) {
      const base = new URL(home.url);
      const blocked = await this.net.disallowed(base.origin);
      const allowed = (path: string) => !blocked.some((b) => path.startsWith(b));
      const queue = [...new Set(['/', ...interestingLinks(home.html, base), ...DEFAULT_PATHS])].filter(allowed);
      for (const path of queue) {
        if (pagesRead >= MAX_PAGES) break;
        const page = path === '/' ? home : await this.net.page(new URL(path, base).toString());
        if (!page) continue;
        pagesRead++;
        for (const f of extractEmails(page.html)) {
          if (!belongsTo(f.email, domain)) continue;
          const prev = found.get(f.email);
          if (!prev) found.set(f.email, { email: f.email, name: f.name, sourceUrl: page.url });
          else if (!prev.name && f.name) prev.name = f.name;
        }
      }
      if (blocked.includes('/')) notes.push(`${domain} asks crawlers not to read its pages, so SampForce did not.`);
    } else if (domain) {
      notes.push(`Could not open ${domain}. It may be down or only reachable another way.`);
    } else {
      notes.push(`No website found for “${typed}”. Enter the company’s website instead, for example ${domainGuesses(typed)[0] ?? 'company.com'}.`);
    }

    const mailServer = domain ? await this.net.mailServer(domain) : null;
    if (mailServer === false) notes.push(`${domain} has no mail server, so addresses there are unlikely to receive email.`);

    // 3. The address pattern, from published addresses with a name.
    const counts = new Map<EmailPattern, number>();
    for (const f of found.values()) {
      const n = splitName(f.name ?? nameFromEmail(f.email));
      const p = n && detectPattern(f.email.slice(0, f.email.indexOf('@')), n.first, n.last);
      if (p) counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    const [pattern, patternBasis] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

    const blank = (email: string): Omit<FinderEmail, 'status'> => ({ email, name: null, position: null, sourceUrl: null, confidence: null, match: null, suppressed: false });
    const emails: FinderEmail[] = [...found.values()].map((f) => ({ ...blank(f.email), name: f.name ?? nameFromEmail(f.email), sourceUrl: f.sourceUrl, status: 'found' }));
    for (const p of providerEmails) {
      if (domain && !belongsTo(p.email, domain)) continue;
      if (emails.some((e) => e.email === p.email)) continue;
      emails.push({ ...blank(p.email), name: p.name, position: p.position, confidence: p.confidence, status: 'provider' });
    }

    // 4. The person asked about.
    const person: FinderEmail[] = [];
    if (input.firstName && input.lastName && domain) {
      const full = fold(`${input.firstName} ${input.lastName}`);
      const known = emails.find((e) => e.name && fold(e.name) === full);
      if (known) person.push(known);
      if (this.hunter.configured && provider === 'used') {
        try {
          const p = await this.hunter.emailFinder(domain, input.firstName, input.lastName);
          if (p && !person.some((x) => x.email === p.email)) person.push({ ...blank(p.email), name: p.name, position: p.position, confidence: p.confidence, status: 'provider' });
        } catch {
          provider = 'failed';
        }
      }
      const name = `${input.firstName} ${input.lastName}`;
      if (pattern) {
        const local = applyPattern(pattern, input.firstName, input.lastName);
        if (local && !person.some((x) => x.email === `${local}@${domain}`)) person.push({ ...blank(`${local}@${domain}`), name, status: 'pattern' });
      }
      if (!person.length) {
        for (const p of COMMON) {
          const local = applyPattern(p, input.firstName, input.lastName);
          if (local) person.push({ ...blank(`${local}@${domain}`), name, status: 'guess' });
        }
        notes.push('No published address or pattern for this company, so the addresses for this person are common patterns, not checked. Sending to a wrong guess can bounce and hurt your mailbox’s reputation.');
      }
    }

    const all = [...emails, ...person].filter((e) => !isPersonalEmail(e.email));
    const result = await this.prisma.run(auth, async (tx) => {
      const { out, suppressed } = await this.extension.matches(tx, auth.tenantId, [...new Set(all.map((e) => e.email))]);
      for (const e of all) {
        e.match = out.get(e.email) ?? null;
        e.suppressed = suppressed.has(e.email);
      }
      const draft: Omit<FinderResult, 'id' | 'createdAt'> = {
        query: input,
        companyName,
        domain,
        domainSource,
        company: company ? { id: company.id, name: company.name } : null,
        mailServer,
        pattern,
        patternBasis,
        pagesRead,
        emails,
        person,
        provider,
        notes,
      };
      const row = await tx.finderLookup.create({
        data: {
          tenantId: auth.tenantId,
          userId: auth.userId,
          companyName,
          domain,
          person: input.firstName ? `${input.firstName} ${input.lastName}` : null,
          found: emails.length,
          result: draft as unknown as Prisma.InputJsonValue,
        },
      });
      const full: FinderResult = { ...draft, id: row.id, createdAt: row.createdAt.toISOString() };
      await tx.finderLookup.update({ where: { id: row.id }, data: { result: full as unknown as Prisma.InputJsonValue } });
      return full;
    });
    return result;
  }

  /** Saves chosen people from a lookup as leads (source "Email finder"), optionally enrolling them. */
  async save(auth: AuthContext, id: string, input: FinderSaveInput, meta: RequestMeta): Promise<ExtensionCaptureResult> {
    const lookup = await this.get(auth, id);
    return this.extension.capture(
      auth,
      {
        people: input.people,
        companyName: lookup.companyName,
        website: lookup.domain ?? undefined,
        sourceUrl: lookup.domain ? `https://${lookup.domain}/` : 'https://sampforce.invalid/finder',
        sequenceId: input.sequenceId,
        auto: false,
      },
      meta,
      { source: 'Email finder', tag: 'email-finder', action: 'finder.saved' },
    );
  }
}
