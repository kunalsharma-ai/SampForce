import { describe, expect, it } from 'vitest';
import { VIDEO_FRAME_HOSTS, VIDEO_IMAGE_HOSTS } from '@dealflow/types';
import { contentSecurityPolicy, LEARNING_FRAME_HOSTS, LEARNING_IMAGE_HOSTS, newNonce } from './csp';

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

  it('frames only the app itself and the video players learning lessons embed', () => {
    expect(LEARNING_FRAME_HOSTS).toEqual([...VIDEO_FRAME_HOSTS]);
    expect(LEARNING_IMAGE_HOSTS).toEqual([...VIDEO_IMAGE_HOSTS]);
    const p = contentSecurityPolicy('n');
    expect(p).toContain(`frame-src 'self' ${VIDEO_FRAME_HOSTS.join(' ')}`);
    expect(p).toContain('https://i.ytimg.com');
    expect(p).toContain("frame-ancestors 'none'");
  });

  it('makes a fresh 128-bit nonce each time', () => {
    const a = newNonce();
    expect(atob(a)).toHaveLength(16);
    expect(newNonce()).not.toBe(a);
  });
});
