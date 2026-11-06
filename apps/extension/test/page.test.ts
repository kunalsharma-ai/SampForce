import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Page = {
  cleanEmail(e: string): string | null;
  findEmails(t: string): string[];
  isPersonal(e: string): boolean;
  belongsTo(e: string, site: string): boolean;
  nameFromEmail(e: string): string;
  looksLikeName(t: string): boolean;
};

// The page reader is a plain script injected into tabs; load it the same way, without a document.
const ctx: { SampForcePage?: Page } = {};
createContext(ctx);
const ret = runInContext(readFileSync(join(import.meta.dirname, '../src/lib/page.js'), 'utf8'), ctx);
const P = ctx.SampForcePage!;

describe('page reader', () => {
  it('returns nothing when there is no page to read', () => {
    expect(ret).toBeNull();
  });

  it('finds addresses in text, including spelled-out ones, without duplicates', () => {
    expect(P.findEmails('Write to Jane.Doe@Acme.com, or sales [at] acme [dot] io. Again: jane.doe@acme.com.')).toEqual(['jane.doe@acme.com', 'sales@acme.io']);
  });

  it('ignores things that only look like addresses', () => {
    expect(P.findEmails('logo@2x.png icon@3x.webp 0123456789abcdef0123456789abcdef@o1.ingest.sentry.io you@example.com name@domain.com')).toEqual([]);
    expect(P.cleanEmail('mailto:Ana@Acme.com')).toBe('ana@acme.com');
  });

  it('knows personal mailboxes and the site’s own people', () => {
    expect(P.isPersonal('x@gmail.com')).toBe(true);
    expect(P.isPersonal('x@acme.com')).toBe(false);
    expect(P.belongsTo('x@acme.com', 'acme.com')).toBe(true);
    expect(P.belongsTo('x@uk.acme.com', 'acme.com')).toBe(true);
    expect(P.belongsTo('x@acme.com', 'careers.acme.com')).toBe(true);
    expect(P.belongsTo('x@vendor.com', 'acme.com')).toBe(false);
    expect(P.belongsTo('x@notacme.com', 'acme.com')).toBe(false);
  });

  it('reads names from link text and addresses, but not from shared mailboxes or calls to action', () => {
    expect(P.looksLikeName('Jane Doe')).toBe(true);
    expect(P.looksLikeName('José Álvarez-Ruiz')).toBe(true);
    expect(P.looksLikeName('Email Jane')).toBe(false);
    expect(P.looksLikeName('jane@acme.com')).toBe(false);
    expect(P.nameFromEmail('jane.doe@acme.com')).toBe('Jane Doe');
    expect(P.nameFromEmail('sales@acme.com')).toBe('');
  });
});
