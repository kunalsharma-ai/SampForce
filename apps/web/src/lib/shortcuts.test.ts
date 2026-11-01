import { describe, expect, it } from 'vitest';
import { isTypingTarget, resolveShortcut } from './shortcuts';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('resolveShortcut', () => {
  it('opens search and toggles focus with Ctrl or Cmd, even while typing', () => {
    expect(resolveShortcut(key('k', { ctrlKey: true }), null, true)).toEqual({ type: 'search' });
    expect(resolveShortcut(key('K', { metaKey: true }), null, false)).toEqual({ type: 'search' });
    expect(resolveShortcut(key('.', { ctrlKey: true }), null, true)).toEqual({ type: 'focus' });
  });
  it('ignores plain letters while typing in a field', () => {
    expect(resolveShortcut(key('g'), null, true)).toBeNull();
    expect(resolveShortcut(key('?'), null, true)).toBeNull();
  });
  it('handles g then a letter to go somewhere, and n then a letter to create', () => {
    expect(resolveShortcut(key('g'), null, false)).toEqual({ type: 'prefix', prefix: 'g' });
    expect(resolveShortcut(key('d'), 'g', false)).toEqual({ type: 'go', href: '/app/deals' });
    expect(resolveShortcut(key('l'), 'n', false)).toEqual({ type: 'create', kind: 'leads' });
    expect(resolveShortcut(key('z'), 'g', false)).toBeNull();
  });
  it('maps ? and [', () => {
    expect(resolveShortcut(key('?'), null, false)).toEqual({ type: 'help' });
    expect(resolveShortcut(key('['), null, false)).toEqual({ type: 'sidebar' });
    expect(resolveShortcut(key('g', { altKey: true }), null, false)).toBeNull();
  });
});

describe('isTypingTarget', () => {
  it('is false for non-elements', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
