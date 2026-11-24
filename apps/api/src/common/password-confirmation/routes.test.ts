import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every route that removes something is a deliberate choice: it needs a password confirmation (@ConfirmPassword) or
 * says why not (@NoPasswordConfirmation('reason')). A new DELETE route, or a POST that deletes, with neither fails
 * here, so no destructive route is added without the check by accident.
 */

const SRC = join(__dirname, '..', '..');
const DESTRUCTIVE = /^\s*@(Delete\(|Post\('[^']*(delete|remove|erase|purge)[^']*'\))/;

function controllers(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return controllers(p);
    return name.endsWith('.controller.ts') ? [p] : [];
  });
}

/** The decorators stacked on the route at `line`: the run of `@...` lines around it. */
function decoratorsAround(lines: string[], line: number): string[] {
  const out: string[] = [];
  for (let i = line - 1; i >= 0 && /^\s*(@|\/\/)/.test(lines[i]!); i--) out.push(lines[i]!);
  for (let i = line + 1; i < lines.length && /^\s*(@|\/\/)/.test(lines[i]!); i++) out.push(lines[i]!);
  return out;
}

describe('password confirmation on destructive routes', () => {
  const routes = controllers(SRC).flatMap((file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.flatMap((l, i) => (DESTRUCTIVE.test(l) ? [{ where: `${relative(SRC, file)}:${i + 1} ${l.trim()}`, decorators: decoratorsAround(lines, i) }] : []));
  });

  it('finds the destructive routes', () => {
    expect(routes.length).toBeGreaterThan(60);
  });

  it('marks every one with @ConfirmPassword or @NoPasswordConfirmation(reason)', () => {
    const unmarked = routes.filter((r) => !r.decorators.some((d) => /@ConfirmPassword\(|@NoPasswordConfirmation\('.{10,}'\)/.test(d))).map((r) => r.where);
    expect(unmarked).toEqual([]);
  });

  it('asks for a password on CRM records, workspaces, roles and integrations', () => {
    const must = ['crm/records.controller.ts', 'crm/deals.controller.ts', 'crm/work.controller.ts', 'crm/company-leads.controller.ts', 'workspaces/workspaces.controller.ts', 'tenants/tenants.controller.ts', 'integrations/integrations.controller.ts', 'mobile/records/mobile-records.controller.ts'];
    for (const file of must) {
      const own = routes.filter((r) => r.where.startsWith(file) && !r.where.includes('drafts/') && !r.where.includes('invitations/'));
      expect(own.length, file).toBeGreaterThan(0);
      for (const r of own) expect(r.decorators.some((d) => d.includes('@ConfirmPassword(')), r.where).toBe(true);
    }
  });
});
