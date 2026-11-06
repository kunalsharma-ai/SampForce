import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHRASES } from '../i18n/phrases';
import { HELP_TABLES, HELP_TOPICS, type HelpId, PAGE_HELP, helpForPath, helpText } from './index';

const SRC = join(__dirname, '..', '..');
function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) files(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}
const SOURCES = files(SRC).filter((f) => !f.includes(`${join('lib', 'help')}`));

describe('help topics', () => {
  it('defines each topic id once', () => {
    const seen = new Map<string, string>();
    for (const [table, topics] of Object.entries(HELP_TABLES))
      for (const id of Object.keys(topics)) {
        expect(seen.get(id), `"${id}" is in both ${seen.get(id)} and ${table}`).toBeUndefined();
        seen.set(id, table);
      }
  });

  it('writes every part of every topic in all five languages', () => {
    for (const [id, topic] of Object.entries(HELP_TOPICS))
      for (const part of ['what', 'how', 'where'] as const) {
        const row = topic[part];
        expect(row, `${id}.${part}`).toHaveLength(5);
        for (const text of row) expect(text.trim(), `${id}.${part}`).not.toBe('');
        // A translation left in English would read as a copy of the first column.
        for (const text of row.slice(1)) expect(text, `${id}.${part} is untranslated`).not.toBe(row[0]);
        // The Arabic column is written in Arabic script.
        expect(row[4], `${id}.${part} Arabic`).toMatch(/[؀-ۿ]/);
      }
  });

  it('keeps each explanation short enough for a popover', () => {
    for (const [id, topic] of Object.entries(HELP_TOPICS))
      for (const part of ['what', 'how', 'where'] as const)
        for (const text of topic[part]) expect(text.length, `${id}.${part}: ${text}`).toBeLessThanOrEqual(240);
  });

  it('has a translated title for every topic', () => {
    expect(Object.values(HELP_TOPICS).map((h) => h.title).filter((title) => !(title in PHRASES))).toEqual([]);
  });

  it('picks the reader’s language and falls back to English', () => {
    const row = HELP_TOPICS['page.deals'].what;
    expect(helpText(row, 'en')).toBe(row[0]);
    expect(helpText(row, 'de')).toBe(row[3]);
    expect(helpText(row, 'ar')).toBe(row[4]);
  });
});

describe('page help', () => {
  it('matches routes, preferring static segments over dynamic ones', () => {
    expect(helpForPath('/app')).toBe('page.commandCenter');
    expect(helpForPath('/app/deals')).toBe('page.deals');
    expect(helpForPath('/app/deals/health')).toBe('page.dealHealth');
    expect(helpForPath('/app/deals/3f2a')).toBe('page.dealRecord');
    expect(helpForPath('/app/reports/new')).toBe('page.reportEditor');
    expect(helpForPath('/app/quotes/quick')).toBe('page.quickBid');
    expect(helpForPath('/app/quotes/abc')).toBe('page.quoteEditor');
    expect(helpForPath('/app/meetings/records/x')).toBe('page.meetingRecord');
    expect(helpForPath('/app/deals?view=kanban')).toBe('page.deals');
    expect(helpForPath('/app/nope/at/all')).toBeUndefined();
  });

  it('points every route at a topic that exists', () => {
    for (const [route, id] of Object.entries(PAGE_HELP)) expect(HELP_TOPICS[id], route).toBeDefined();
  });

  // Every signed-in page and operator page gets an "i" next to its title: a new page fails here until it has help.
  it('covers every signed-in and operator page', () => {
    const pages = files(join(SRC, 'app'))
      .filter((f) => f.endsWith('page.tsx'))
      .map((f) => `/${relative(join(SRC, 'app'), f).replace(/\/?page\.tsx$/, '')}`)
      .filter((r) => (r === '/app' || r.startsWith('/app/') || r === '/operator' || r.startsWith('/operator/')) && r !== '/operator/login');
    const missing = pages.filter((r) => r !== '/app/[module]' && !(r in PAGE_HELP));
    expect(missing).toEqual([]);
  });

  it('shows the page button on pages that do not use PageHeader', () => {
    // These pages draw their own title; each must render <PageHelp />.
    for (const file of [
      'components/crm/record-detail.tsx',
      'components/prospects/prospects.tsx',
      'app/app/quotes/[id]/quote-editor.tsx',
      'app/app/contracts/[id]/contract-detail.tsx',
      'app/app/sequences/[id]/sequence-editor.tsx',
      'app/app/meetings/records/[id]/meeting-record.tsx',
      'app/app/reports/report-editor.tsx',
      'app/app/reports/dashboards/dashboard-board.tsx',
    ])
      expect(readFileSync(join(SRC, file), 'utf8'), file).toContain('<PageHelp');
  });

  it('uses every section topic somewhere in the app', () => {
    const used = new Set<string>();
    for (const f of SOURCES) for (const m of readFileSync(f, 'utf8').matchAll(/topic="([\w.]+)"/g)) used.add(m[1]!);
    const pageTopics = new Set<string>(Object.values(PAGE_HELP));
    const unused = (Object.keys(HELP_TOPICS) as HelpId[]).filter((id) => !pageTopics.has(id) && !used.has(id));
    expect(unused).toEqual([]);
    expect([...used].filter((id) => !(id in HELP_TOPICS))).toEqual([]);
  });
});
