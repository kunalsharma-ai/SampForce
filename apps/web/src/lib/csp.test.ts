import { describe, expect, it } from 'vitest';
import { contentSecurityPolicy, newNonce } from './csp';

describe('content security policy', () => {
  it('requires the nonce for scripts and forbids framing and plugins', () => {
    const p = contentSecurityPolicy('abc', { https: true });
    expect(p).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(p).not.toContain('unsafe-eval');
    expect(p).toContain("frame-ancestors 'none'");
    expect(p).toContain("object-src 'none'");
    expect(p).toContain('upgrade-insecure-requests');
  });

  it('lets hosted forms be embedded, and relaxes only what the dev server needs', () => {
    expect(contentSecurityPolicy('n', { embeddable: true })).toContain('frame-ancestors *');
    const dev = contentSecurityPolicy('n', { dev: true });
    expect(dev).toContain("'unsafe-eval'");
    expect(dev).not.toContain('upgrade-insecure-requests');
    expect(contentSecurityPolicy('n')).not.toContain('upgrade-insecure-requests');
  });

  it('makes a fresh 128-bit nonce each time', () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
