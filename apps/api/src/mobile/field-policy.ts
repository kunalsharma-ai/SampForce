import { ForbiddenException } from '@nestjs/common';
import type { MobileRecordModule, MobileResolvedConfig } from '@dealflow/types';

/**
 * Field rules for phone requests (ADR 0072, M2). The phone hides what the person may not see, but that is only
 * presentation: every record a phone route sends goes through `mobileReadable`, and every write through
 * `checkMobileWrite`, using the same resolved configuration the phone was given. A hand-made request therefore
 * cannot read a hidden field or change one it may only view.
 *
 * Records name their fields as in MOBILE_FIELDS; custom field values live under `customFields` and are ruled as
 * `cf.<key>`. `aliases` maps a request's own names (for example `companyId`) to the field they set (`company`).
 */

/** Always sent: what the phone needs to address and version a record, never a business value. */
const ALWAYS = new Set(['id', 'updatedAt', 'version']);

type Rec = Record<string, unknown>;
export type FieldAliases = Readonly<Record<string, string>>;

/** The person's settings for a module; refuses a module their mobile app does not have. */
export function moduleOf(config: MobileResolvedConfig, module: MobileRecordModule) {
  const m = config.modules.find((x) => x.key === module);
  if (!m) throw new ForbiddenException({ code: 'MOBILE_MODULE_OFF', message: 'This part of SampForce is not available in your mobile app.' });
  return m;
}

const fieldName = (key: string, aliases: FieldAliases) => aliases[key] ?? key;

/** A copy of the record with only the fields this person may see. */
export function mobileReadable<T extends Rec>(config: MobileResolvedConfig, module: MobileRecordModule, record: T, aliases: FieldAliases = {}): Partial<T> {
  moduleOf(config, module);
  const rules = config.fields[module] ?? {};
  const out: Rec = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'customFields') {
      if (value && typeof value === 'object') {
        const cf = Object.fromEntries(Object.entries(value as Rec).filter(([k]) => `cf.${k}` in rules));
        out.customFields = cf;
      }
      continue;
    }
    if (ALWAYS.has(key) || fieldName(key, aliases) in rules) out[key] = value;
  }
  return out as Partial<T>;
}

const empty = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Refuses a create or edit that touches a field the person may not set. Clearing a field that has a value needs the
 * field's delete rule. `current` is the stored record, for edits.
 */
export function checkMobileWrite(config: MobileResolvedConfig, module: MobileRecordModule, mode: 'create' | 'edit', body: Rec, current: Rec | null = null, aliases: FieldAliases = {}): void {
  const m = moduleOf(config, module);
  if (mode === 'create' ? !m.create : !m.edit) {
    throw new ForbiddenException({ code: 'MOBILE_ACTION_NOT_ALLOWED', message: 'Your workspace does not allow this in the mobile app.' });
  }
  const rules = config.fields[module] ?? {};
  const refused: string[] = [];
  const check = (field: string, value: unknown, before: unknown) => {
    const rule = rules[field];
    if (!rule) return refused.push(field);
    if (mode === 'create') return rule.create || empty(value) || refused.push(field);
    if (empty(value) && !empty(before)) return rule.delete || refused.push(field);
    return rule.edit || refused.push(field);
  };
  for (const [key, value] of Object.entries(body)) {
    if (key === 'customFields' && value && typeof value === 'object') {
      const before = (current?.customFields ?? {}) as Rec;
      for (const [k, v] of Object.entries(value as Rec)) check(`cf.${k}`, v, before[k]);
      continue;
    }
    check(fieldName(key, aliases), value, current?.[key]);
  }
  if (refused.length) {
    throw new ForbiddenException({
      code: 'MOBILE_FIELD_NOT_ALLOWED',
      message: 'You cannot change some of these fields in the mobile app.',
      details: [...new Set(refused)].map((path) => ({ path, message: 'You cannot change some of these fields in the mobile app.' })),
    });
  }
}

export function checkMobileDelete(config: MobileResolvedConfig, module: MobileRecordModule): void {
  if (!moduleOf(config, module).delete) throw new ForbiddenException({ code: 'MOBILE_ACTION_NOT_ALLOWED', message: 'Your workspace does not allow this in the mobile app.' });
}
