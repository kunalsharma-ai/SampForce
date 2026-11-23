import { defaultMobileConfig, FEATURE_KEYS, PERMISSIONS, resolveMobileConfig, type MobileAppConfig } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import { checkMobileDelete, checkMobileWrite, mobileReadable } from './field-policy';

const field = (c: MobileAppConfig, key: string) => c.fields.companies[key] as MobileAppConfig['fields']['companies'][string];
const config = (() => {
  const c = JSON.parse(JSON.stringify(defaultMobileConfig())) as MobileAppConfig;
  field(c, 'website').EXECUTIVE = { view: false, edit: false, create: false, delete: false };
  field(c, 'city').EXECUTIVE = { view: true, edit: false, create: true, delete: false };
  field(c, 'notes').EXECUTIVE = { view: true, edit: true, create: true, delete: false };
  c.fields.companies['cf.visit_notes'] = { SUPER: { view: true, edit: true, create: true, delete: true }, MANAGER: { view: true, edit: true, create: true, delete: true }, EXECUTIVE: { view: true, edit: true, create: true, delete: true } };
  return c;
})();
const exec = resolveMobileConfig(config, { level: 'EXECUTIVE', features: [...FEATURE_KEYS], permissions: [...PERMISSIONS] });
const code = (fn: () => void) => {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { getResponse(): { code: string; details?: { path: string }[] } }).getResponse();
  }
};

describe('mobile field rules (ADR 0072)', () => {
  it('sends only the fields the level may see, including custom fields', () => {
    const out = mobileReadable(exec, 'companies', { id: 'c1', name: 'Acme', website: 'acme.test', city: 'Pune', secretScore: 9, customFields: { visit_notes: 'Met CFO', internal_rating: 'A' } });
    expect(out).toEqual({ id: 'c1', name: 'Acme', city: 'Pune', customFields: { visit_notes: 'Met CFO' } });
  });

  it('refuses hidden, unknown or view-only fields however the request is made', () => {
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { website: 'evil.test' }, { website: 'acme.test' }))).toMatchObject({ code: 'MOBILE_FIELD_NOT_ALLOWED', details: [{ path: 'website' }] });
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { secretScore: 1 }))).toMatchObject({ code: 'MOBILE_FIELD_NOT_ALLOWED' });
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { leadNumber: 'L-1' }))).toMatchObject({ details: [{ path: 'leadNumber' }] });
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { customFields: { internal_rating: 'B' } }))).toMatchObject({ details: [{ path: 'cf.internal_rating' }] });
  });

  it('tells create, edit and clear apart', () => {
    // City may be set on a new lead but not changed afterwards.
    expect(code(() => checkMobileWrite(exec, 'companies', 'create', { name: 'New', city: 'Delhi' }))).toBeNull();
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { city: 'Delhi' }, { city: 'Pune' }))).toMatchObject({ details: [{ path: 'city' }] });
    // Notes may be edited but not cleared.
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { notes: 'Called back' }, { notes: 'First call' }))).toBeNull();
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { notes: '' }, { notes: 'First call' }))).toMatchObject({ details: [{ path: 'notes' }] });
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { customFields: { visit_notes: null } }, { customFields: { visit_notes: 'x' } }))).toBeNull();
    // A request's own names map to the field they set.
    expect(code(() => checkMobileWrite(exec, 'companies', 'edit', { ownerId: 'u2' }, null, { ownerId: 'owner' }))).toBeNull();
  });

  it('applies the record rules and refuses modules the person does not have', () => {
    expect(code(() => checkMobileDelete(exec, 'companies'))).toMatchObject({ code: 'MOBILE_ACTION_NOT_ALLOWED' });
    const off = resolveMobileConfig(config, { level: 'EXECUTIVE', features: [...FEATURE_KEYS], permissions: ['dashboard:read'] });
    expect(code(() => mobileReadable(off, 'companies', { id: 'c1' }))).toMatchObject({ code: 'MOBILE_MODULE_OFF' });
    const readOnly = resolveMobileConfig(config, { level: 'SUPER', features: [...FEATURE_KEYS], permissions: ['dashboard:read', 'companies:read'] });
    expect(code(() => checkMobileWrite(readOnly, 'companies', 'create', { name: 'X' }))).toMatchObject({ code: 'MOBILE_ACTION_NOT_ALLOWED' });
  });
});
