import { describe, expect, it } from 'vitest';
import { extensionCaptureSchema, isPersonalEmail, nameFromEmail, siteDomain } from './extension';

describe('browser extension helpers', () => {
  it('spots personal mailbox providers', () => {
    expect(isPersonalEmail('someone@Gmail.com')).toBe(true);
    expect(isPersonalEmail('ana@buyer.co')).toBe(false);
  });

  it('reduces a site to its host name', () => {
    expect(siteDomain('https://www.Acme.com/about?x=1')).toBe('acme.com');
    expect(siteDomain('acme.io')).toBe('acme.io');
    expect(siteDomain('')).toBeNull();
    expect(siteDomain('http://')).toBeNull();
  });

  it('guesses a name from the address, but not for shared mailboxes', () => {
    expect(nameFromEmail('jane.doe@acme.com')).toBe('Jane Doe');
    expect(nameFromEmail('info@acme.com')).toBe('info@acme.com');
    expect(nameFromEmail('j4@acme.com')).toBe('j4@acme.com');
  });

  it('caps a capture at 25 people and lower-cases addresses', () => {
    const base = { sourceUrl: 'https://acme.com', people: [{ email: 'Ana@Acme.com' }] };
    expect(extensionCaptureSchema.parse(base).people[0]!.email).toBe('ana@acme.com');
    const many = { ...base, people: Array.from({ length: 26 }, (_, i) => ({ email: `p${i}@acme.com` })) };
    expect(extensionCaptureSchema.safeParse(many).success).toBe(false);
  });
});
