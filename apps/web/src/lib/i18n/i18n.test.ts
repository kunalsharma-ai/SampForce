import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ACTIVITY_TYPES,
  BID_TEMPLATES,
  CHURN_RISK,
  DATE_BUCKETS,
  DEAL_PRIORITIES,
  DEAL_RISK_LABELS,
  EMAIL_BLOCK_LABELS,
  EMAIL_INTENT_LABELS,
  EMAIL_NEXT_ACTION_LABELS,
  EMAIL_TONE_LABELS,
  EMAIL_STATUS_LABELS,
  ENROLL_SKIP_LABELS,
  INBOX_CATEGORY_LABELS,
  INBOX_STATUS_LABELS,
  LANGUAGES,
  LEAD_STATUSES,
  MEETING_PLATFORM_LABELS,
  MERGE_FIELDS,
  NEXT_ACTION_LABELS,
  PLAN_CATALOG,
  PROPOSAL_TEMPLATES,
  REPORT_CATALOG,
  REPORT_TEMPLATES,
  RULE_ACTION_LABELS,
  SSO_ERRORS,
  THEMES,
  TIMELINE_KIND_LABELS,
} from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { ENTITY_LABEL, titleCase } from '@/lib/crm';
import { MODULES, moduleKey } from '@/lib/navigation';
import { ENROLLMENT_LABEL } from '@/lib/sequences';
import { en } from './messages/en';
import { PHRASE_TABLES, PHRASES } from './phrases';
import { CATALOGUES, translate, translatePlural } from './translate';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const PLURAL = /_(zero|one|two|few|many|other)$/;

describe('message catalogues', () => {
  it('has a catalogue for every language the API accepts', () => {
    expect(Object.keys(CATALOGUES).sort()).toEqual(LANGUAGES.map((l) => l.code).sort());
  });

  for (const [lang, messages] of Object.entries(CATALOGUES)) {
    it(`${lang}: translates every key, with the same placeholders and no unknown keys`, () => {
      const known = new Set([...Object.keys(en), ...Object.keys(PHRASES)]);
      for (const key of Object.keys(en) as (keyof typeof en)[]) {
        const text = messages[key];
        expect(text, `${lang} ${key}`).toBeTruthy();
        // A plural form may drop {count} ("one day ago"), but may never introduce a placeholder the source lacks.
        if (PLURAL.test(key)) for (const p of placeholders(text)) expect(placeholders(en[key]), `${lang} ${key}`).toContain(p);
        else expect(placeholders(text), `${lang} ${key}`).toEqual(placeholders(en[key]));
      }
      for (const key of Object.keys(messages)) {
        if (!known.has(key)) expect(PLURAL.test(key) && known.has(`${key.replace(PLURAL, '')}_other`), `${lang} has unknown key ${key}`).toBe(true);
      }
    });

    it(`${lang}: has every plural form the language uses`, () => {
      const forms = new Intl.PluralRules(lang).resolvedOptions().pluralCategories;
      const bases = Object.keys(en).filter((k) => k.endsWith('_other')).map((k) => k.replace(/_other$/, ''));
      for (const base of bases) for (const form of forms) expect((messages as Record<string, string>)[`${base}_${form}`], `${lang} ${base}_${form}`).toBeTruthy();
    });
  }

  it('names every sidebar module and group', () => {
    for (const m of MODULES) expect(en).toHaveProperty([moduleKey(m)]);
    for (const g of new Set(MODULES.map((m) => m.group))) expect(en).toHaveProperty([`nav.group.${g}`]);
  });
});

const source = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('page phrases', () => {
  it('keeps each phrase in one table', () => {
    const seen = new Map<string, string>();
    for (const [table, rows] of Object.entries(PHRASE_TABLES))
      for (const key of Object.keys(rows)) {
        expect(seen.get(key), `"${key}" is in both ${seen.get(key)} and ${table}`).toBeUndefined();
        seen.set(key, table);
      }
  });

  it('translates every phrase into every language with the same placeholders', () => {
    for (const [key, row] of Object.entries(PHRASES)) {
      expect(row, key).toHaveLength(4);
      for (const text of row) {
        expect(text.trim(), key).not.toBe('');
        expect(placeholders(text), `${key} -> ${text}`).toEqual(placeholders(key));
      }
    }
  });

  // Labels that reach the pages as data and are shown through t.maybe(): each must have a phrase, or it would
  // silently stay in English.
  const dataLabels: [string, string[]][] = [
    ['shared type labels', [...Object.values(DEAL_RISK_LABELS), ...Object.values(EMAIL_STATUS_LABELS), ...Object.values(TIMELINE_KIND_LABELS), ...Object.values(INBOX_STATUS_LABELS), ...Object.values(ENROLL_SKIP_LABELS), ...Object.values(NEXT_ACTION_LABELS)]],
    ['statuses, priorities and activity types', [...LEAD_STATUSES, 'OPEN', 'WON', 'LOST', ...DEAL_PRIORITIES, ...ACTIVITY_TYPES].map(titleCase)],
    ['activity log buttons', ACTIVITY_TYPES.map((a) => `Log ${a.toLowerCase()}`)],
    [
      'record names in sentences',
      Object.values(ENTITY_LABEL).flatMap(({ one, many }) => {
        const o = one.toLowerCase();
        const m = many.toLowerCase();
        return [many, `New ${o}`, `Edit ${o}`, `Create ${o}`, `Delete ${o}`, `Delete this ${o}?`, `You have an unsaved ${o} from {when}.`, `No ${m} yet.`, o, m];
      }),
    ],
    // Sent by the API: KPI names and onboarding steps (dashboard), buying signals and flags (record intelligence),
    // deal health risk signals (scoring). Read from the API source so a new label fails here until it is translated.
    ['dashboard API labels', [...source('../../../../api/src/dashboard/dashboard.service.ts').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['record intelligence API labels', [...source('../../../../api/src/intelligence/record-intelligence.service.ts').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['deal health signals', [...source('../../../../api/src/ai/scoring.ts').matchAll(/risk\('\w+', '([^']+)'/g)].map((m) => m[1]!)],
    ['fixed forecast columns', ['Overdue', 'Later', 'No close date']],
    // Sign-in errors and the validation messages of the shared auth schemas, shown through t.maybe() on the auth pages.
    ['single sign-on errors', Object.values(SSO_ERRORS)],
    // Theme descriptions and the readability check labels come from the shared appearance module.
    ['theme descriptions', THEMES.map((th) => th.description)],
    ['contrast check labels', [...source('../../../../../packages/types/src/appearance.ts').matchAll(/\['([^']+)', '[\w-]+', '[\w-]+', [\d.]+\]/g)].map((m) => m[1]!)],
    ['custom field validation messages', [...source('../../../../../packages/types/src/crm.ts').matchAll(/customFieldDefSchema[\s\S]*?CustomFieldDefInput/g)].flatMap((m) => [...m[0].matchAll(/(?:regex\([^,]+, |message: )'([^']+)'/g)].map((x) => x[1]!))],
    ['workspace settings validation messages', [...source('../../app/app/settings/workspace-settings.tsx').matchAll(/(?:min|regex|length)\([^,]+, '([^']+)'\)/g)].map((m) => m[1]!)],
    ['territory validation messages', [...source('../../../../../packages/types/src/territories.ts').matchAll(/(?:min|regex)\([^,]+, '([^']+)'\)|refine\([^,]+, '([^']+)'\)/g)].map((m) => (m[1] ?? m[2])!)],
    // Email sequences: shared labels, sequence statuses, the template designer's checks, and AI availability reasons.
    ['email sequence labels', [...Object.values(MERGE_FIELDS), ...Object.values(RULE_ACTION_LABELS), ...Object.values(ENROLLMENT_LABEL), ...Object.values(EMAIL_TONE_LABELS), ...Object.values(EMAIL_BLOCK_LABELS), 'Draft', 'Active', 'Paused', 'Archived']],
    ['sequence analytics template names', [...source('../../../../api/src/sequences/analytics.service.ts').matchAll(/name: id === 'none' \? '([^']+)' : \(templates\.get\(id\) \?\? '([^']+)'\)/g)].flatMap((m) => [m[1]!, m[2]!])],
    ['email design validation messages', [...source('../../../../../packages/types/src/email-design.ts').matchAll(/(?:regex|refine|max|min)\([^,']*, '([^']+)'\)|message: '([^']+)'/g)].map((m) => (m[1] ?? m[2])!)],
    // Inbox and meetings: shared labels, meeting-note stages, Zoom transcript states, and the compose and meeting analysis checks.
    ['inbox and meeting labels', [...Object.values(INBOX_CATEGORY_LABELS), ...Object.values(EMAIL_INTENT_LABELS), ...Object.values(EMAIL_NEXT_ACTION_LABELS), ...Object.values(MEETING_PLATFORM_LABELS)]],
    ['meeting note stages', [...source('../../components/meetings/record-meetings.tsx').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['Zoom transcript states', [...source('../../components/meetings/zoom-meetings.tsx').matchAll(/label: '([^']+)'/g)].map((m) => m[1]!)],
    ['compose and meeting analysis checks', [...source('../../../../../packages/types/src/meetings.ts').matchAll(/min\(1, '([^']+)'\)|message: '([^']+)'/g), ...source('../../../../../packages/types/src/automation.ts').matchAll(/(?:subject|body): z\.string\(\)(?:\.trim\(\))?\.min\(1, '([^']+)'\)/g)].map((m) => (m[1] ?? m[2])!)],
    ['AI availability reasons', [...source('../../../../api/src/ai/gateway.service.ts').matchAll(/\? '([^']+\.)'/g)].map((m) => m[1]!).filter((r) => !r.startsWith('An API key'))],
    // Quotes, contracts, approvals and billing: statuses from lib/revenue and lib/billing, bid and proposal templates,
    // plan audiences, the screens' own label maps, and the Quick Bid Studio's checks.
    ['revenue and billing statuses', (source('../revenue.ts') + source('../billing.ts')).match(/label: '[^']+'/g)!.map((m) => m.slice(8, -1))],
    ['bid and proposal templates', [...BID_TEMPLATES.flatMap((b) => [b.name, b.category, b.description]), ...PROPOSAL_TEMPLATES.map((p) => p.name)]],
    ['plan audiences', PLAN_CATALOG.map((p) => p.audience)],
    [
      'commercial screen labels',
      [
        ['../../app/app/quotes/[id]/proposal-panel.tsx', /label: '([^']+)', tone/g],
        ['../../components/revenue/esignature.tsx', /label: '([^']+)', tone/g],
        ['../../app/app/contracts/[id]/contract-detail.tsx', /(?:wet_ink|email_confirmation|external_esign|docusign): '([^']+)'/g],
        ['../../app/app/billing/billing-workspace.tsx', /OFFLINE: '([^']+)'/g], // Stripe and Razorpay are names.
        ['../../app/app/quotes/quick/quick-bid-studio.tsx', /\] = '([^']+)';/g],
        ['../../app/app/quotes/quick/quick-bid-studio.tsx', /const STEPS = \[([^\]]+)\]/g],
      ].flatMap(([file, re]) => [...source(file as string).matchAll(re as RegExp)].flatMap((m) => m[1]!.split(/', '/).map((x) => x.replace(/^'|'$/g, '')))),
    ],
    ['approval statuses', ['Pending', 'Approved', 'Rejected', 'Expired', 'Canceled']],
    // Reports, forecasting, revenue and customer success: the report catalogue and the labels the reports API builds
    // from it, the editor's option maps, the explorers' label maps, forecast and churn labels, health signals and the
    // retention plan's cadences and steps.
    [
      'report catalogue labels',
      Object.values(REPORT_CATALOG).flatMap((e) => [
        e.label,
        `Number of ${e.label.toLowerCase().replace(/ \(.*\)$/, '')}`,
        ...e.fields.flatMap((f) => [
          f.label,
          ...(f.kind === 'date' ? DATE_BUCKETS.map((b) => `${f.label} (${b})`) : []),
          ...(f.kind === 'number' || f.kind === 'money' ? ['Total', 'Average', 'Lowest', 'Highest'].map((fn) => `${fn} ${f.label.toLowerCase()}`) : []),
          ...(f.options ?? []).map((o) => o.charAt(0) + o.slice(1).toLowerCase().replace(/_/g, ' ')),
        ]),
      ]),
    ],
    ['report templates and buckets', [...REPORT_TEMPLATES.map((r) => r.name), ...DATE_BUCKETS.map((b) => b.charAt(0).toUpperCase() + b.slice(1)), 'All', '(none)', 'Other']],
    ['report definition checks', [...source('../../../../../packages/types/src/reports.ts').matchAll(/issue\(\[[^\]]*\], '([^']+)'\)/g)].map((m) => m[1]!)],
    [
      'report and forecast screen labels',
      [
        // [file, the part of it that holds the labels, the label pattern]
        ['../../app/app/reports/report-editor.tsx', /const METRIC_LABEL[\s\S]*?\n\};\n\n/, /: '([^']+)'/g],
        ['../../app/app/reports/reports-nav.tsx', /const LINKS[\s\S]*?\];/, /label: '([^']+)'/g],
        ['../../app/app/reports/dashboards/dashboard-board.tsx', /const SIZE_LABEL.*/, /: '([^']+)'/g],
        ['../../app/app/reports/galaxy/galaxy-explorer.tsx', /const KIND_LABEL[\s\S]*?const KIND_ONE.*/, /: '([^']+)'/g],
        ['../../app/app/reports/galaxy/galaxy-explorer.tsx', /const items.*/, /'chart-\d', '([^']+)'/g],
        ['../../app/app/reports/globe/globe-explorer.tsx', /const METRICS[\s\S]*?\} as const;/, /: '([^']+)'/g],
        ['../../app/app/forecasting/forecast-workspace.tsx', /const CATEGORY[\s\S]*?\} as const;/, /label: '([^']+)'/g],
        ['../../app/app/forecasting/forecast-workspace.tsx', /const CHANGE_LABEL[\s\S]*?\};/, /: '([^']+)'/g],
        ['../../app/app/forecasting/forecast-workspace.tsx', /const GRANULARITY_LABEL.*/, /: '([^']+)'/g],
        ['../../app/app/forecasting/forecast-plan.tsx', /const TARGET_SOURCE[\s\S]*?\};/, /: '([^']+)'/g],
        ['../../components/revenue/churn.tsx', /const SERIES[\s\S]*?\] as const;/, /label: '([^']+)'/g],
        ['../motion.ts', /[\s\S]*/, /reason: '([^']+)'/g],
      ].flatMap(([file, part, re]) => [...source(file as string).match(part as RegExp)![0].matchAll(re as RegExp)].map((m) => m[1]!)),
    ],
    [
      'churn and retention labels',
      [
        ...Object.values(CHURN_RISK).map((c) => c.label),
        ...[...source('../../../../../packages/types/src/revenue.ts').matchAll(/signals\.push\(\{ key: '\w+', label: '([^']+)'|^\s+label: '([^']+)',$|everyDays: \d+, touches: \d+, label: '([^']+)'|title: '([^']+)'/gm)].map((m) => m.slice(1).find(Boolean)!),
        'No calls, emails, meetings or notes recorded.',
        ...['Low', 'Medium', 'High', 'Critical'],
      ],
    ],
    ['auth validation messages', [...[...source('../../../../../packages/types/src/auth.ts').matchAll(/(?:min|regex)\([^,]+, '([^']+)'\)/g)].map((m) => m[1]!), 'Invalid email']],
  ];
  for (const [name, labels] of dataLabels)
    it(`has a phrase for every ${name}`, () => {
      expect(labels.length).toBeGreaterThan(0);
      expect(labels.filter((l) => !(l in PHRASES))).toEqual([]);
    });
});

describe('translate', () => {
  it('fills placeholders and writes numbers in the format locale', () => {
    expect(translate('de', 'nav.removeFavourite', { label: 'Acme' })).toBe('Acme aus den Favoriten entfernen');
    expect(translate('en', 'regional.formatsAuto', { locale: 'en-GB' })).toBe('Match the language (en-GB)');
    expect(translatePlural('en', 'regional.days', 1234, undefined, 'de-DE')).toBe('1.234 days ago');
  });

  it('looks up page phrases by their English text, and leaves unknown text as it came', () => {
    expect(translate('en', 'Owner')).toBe('Owner');
    expect(translate('es', 'Owner')).toBe('Responsable');
    expect(translate('de', 'Page {page} of {pages}', { page: 2, pages: 1200 }, 'de-DE')).toBe('Seite 2 von 1.200');
    expect(translate('fr', 'Acme pipeline' as never)).toBe('Acme pipeline');
    expect(translatePlural('ar', 'count.deals', 2)).toBe('صفقتان');
  });

  it('picks plural forms with the language’s rules', () => {
    expect(translatePlural('en', 'regional.days', 1)).toBe('1 day ago');
    expect(translatePlural('fr', 'regional.days', 2)).toBe('il y a 2 jours');
    expect(translatePlural('ar', 'regional.days', 0)).toBe('اليوم');
    expect(translatePlural('ar', 'regional.days', 2)).toBe('قبل يومين');
    expect(translatePlural('ar', 'regional.days', 5, undefined, 'en')).toBe('قبل 5 أيام');
    expect(translatePlural('ar', 'regional.days', 11, undefined, 'en')).toBe('قبل 11 يومًا');
  });
});
