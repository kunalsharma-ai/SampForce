import { defaultMobileConfig, MOBILE_MODULE_DEFS, resolveMobileConfig } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { buildBody, datePresets, FormError, formFields, localDateTime, missingRequired, parseLocalDateTime, toFormValue, valueOf, visibleFields } from '../src/lib/records';

const ALL = { view: true, edit: true, create: true, delete: true };
const configFor = (level: 'SUPER' | 'EXECUTIVE', change: (c: ReturnType<typeof defaultMobileConfig>) => void = () => {}) => {
  const c = defaultMobileConfig();
  change(c);
  const features = MOBILE_MODULE_DEFS.flatMap((d) => (d.feature ? [d.feature] : []));
  const permissions = MOBILE_MODULE_DEFS.flatMap((d) => (d.permission ? [d.permission.read, d.permission.write] : []));
  return resolveMobileConfig(c, { level, features, permissions });
};

describe('record fields on the phone', () => {
  it('shows only the fields the configuration lets the level see, read-only ones outside forms', () => {
    const cfg = configFor('EXECUTIVE', (c) => {
      c.fields.companies.website!.EXECUTIVE = { view: false, edit: false, create: false, delete: false };
      c.fields.companies.city!.EXECUTIVE = { view: true, edit: false, create: false, delete: false };
    });
    const fields = visibleFields(cfg, 'companies');
    const keys = fields.map((f) => f.key);
    expect(keys).not.toContain('website');
    expect(keys).toContain('city');
    expect(keys).toContain('leadNumber');
    const create = formFields(fields, 'create').map((f) => f.key);
    expect(create).not.toContain('city');
    expect(create).not.toContain('leadNumber');
    expect(create).toContain('name');
  });

  it('adds custom fields the configuration shows, read-only when the web does not let the person edit them', () => {
    const cfg = configFor('SUPER', (c) => {
      c.fields.companies['cf.visit_notes'] = { SUPER: ALL, MANAGER: ALL, EXECUTIVE: ALL };
      c.fields.companies['cf.score'] = { SUPER: ALL, MANAGER: ALL, EXECUTIVE: ALL };
    });
    const fields = visibleFields(cfg, 'companies', [
      { key: 'visit_notes', label: 'Visit notes', type: 'TEXT', options: [], edit: true },
      { key: 'score', label: 'Score', type: 'FORMULA', options: [], edit: false },
      { key: 'not_configured', label: 'Hidden', type: 'TEXT', options: [], edit: true },
    ]);
    expect(fields.filter((f) => f.key.startsWith('cf.')).map((f) => [f.key, f.kind])).toEqual([
      ['cf.visit_notes', 'text'],
      ['cf.score', 'readonly'],
    ]);
  });
});

describe('dates typed on the phone', () => {
  it('reads dates with or without a time, in the phone’s own time', () => {
    expect(parseLocalDateTime('2026-12-01 14:30')?.getTime()).toBe(new Date(2026, 11, 1, 14, 30).getTime());
    expect(parseLocalDateTime('2026-12-01')?.getHours()).toBe(9);
    expect(parseLocalDateTime('2026-02-30 10:00')).toBeNull();
    expect(parseLocalDateTime('tomorrow')).toBeNull();
    expect(parseLocalDateTime('2026-12-01 24:00')).toBeNull();
    expect(localDateTime(new Date(2026, 0, 5, 7, 3))).toBe('2026-01-05 07:03');
  });

  it('offers later today only before four o’clock', () => {
    expect(datePresets(new Date(2026, 10, 23, 10, 0)).map((p) => p.label)).toEqual(['Later today', 'Tomorrow', 'Next week']);
    expect(datePresets(new Date(2026, 10, 23, 18, 0)).map((p) => [p.label, p.value])).toEqual([
      ['Tomorrow', '2026-11-24 09:00'],
      ['Next week', '2026-11-30 09:00'],
    ]);
  });
});

describe('what a form sends', () => {
  const cfg = configFor('SUPER', (c) => {
    c.fields.companies['cf.visit_notes'] = { SUPER: ALL, MANAGER: ALL, EXECUTIVE: ALL };
  });
  const fields = formFields(visibleFields(cfg, 'companies', [{ key: 'visit_notes', label: 'Visit notes', type: 'TEXT', options: [], edit: true }]), 'create');

  it('sends filled-in fields of a new record, custom fields under customFields', () => {
    expect(buildBody(fields, { name: ' Harbour ', city: '', 'cf.visit_notes': 'Gate 4' }, null)).toEqual({ name: 'Harbour', customFields: { visit_notes: 'Gate 4' } });
  });

  it('sends only changes on an edit, and null to clear a field', () => {
    const original = { name: 'Harbour', city: 'Leeds', industry: 'Labs' };
    expect(buildBody(fields, { ...original, city: 'York', industry: '' }, original)).toEqual({ city: 'York', industry: null });
    expect(buildBody(fields, original, original)).toEqual({});
  });

  it('refuses to clear a required field or send a bad date', () => {
    expect(() => buildBody(fields, { name: '' }, { name: 'Harbour' })).toThrow(FormError);
    const task = formFields(visibleFields(configFor('SUPER'), 'tasks'), 'create');
    expect(buildBody(task, { title: 'Call', dueAt: '2026-12-01 14:30' }, null)).toEqual({ title: 'Call', dueAt: new Date(2026, 11, 1, 14, 30).toISOString() });
    try {
      buildBody(task, { title: 'Call', dueAt: 'soon' }, null);
      expect.unreachable();
    } catch (e) {
      expect((e as FormError).field).toBe('dueAt');
    }
  });

  it('knows what a new follow-up still needs', () => {
    const f = formFields(visibleFields(configFor('SUPER'), 'follow_ups'), 'create');
    expect(missingRequired('follow_ups', f, { title: 'Visit' })).toEqual(['company', 'followUpType', 'dueAt']);
    expect(missingRequired('follow_ups', f, { title: 'Visit', company: 'c1', followUpType: 'CALL', dueAt: '2026-12-01' })).toEqual([]);
  });

  it('turns stored values into form values', () => {
    expect(toFormValue({ id: 'u1', name: 'Ana' }, 'person')).toBe('u1');
    expect(toFormValue(null, 'text')).toBe('');
    expect(toFormValue(true, 'boolean')).toBe('true');
    expect(valueOf({ id: 'x', customFields: { a: 1 } }, 'cf.a')).toBe(1);
  });
});
