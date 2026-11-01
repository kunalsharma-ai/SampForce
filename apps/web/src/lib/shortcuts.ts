import type { QuickCreateKind } from '@/stores/quick-create';

/** Two-key "go to" shortcuts: press g, then the letter. */
export const GO_TO: { key: string; label: string; href: string }[] = [
  { key: 'h', label: 'Command Center', href: '/app' },
  { key: 'l', label: 'Leads', href: '/app/leads' },
  { key: 'c', label: 'Contacts', href: '/app/contacts' },
  { key: 'o', label: 'Companies', href: '/app/companies' },
  { key: 'd', label: 'Deals', href: '/app/deals' },
  { key: 'q', label: 'Quotes', href: '/app/quotes' },
  { key: 't', label: 'Tasks and activities', href: '/app/activities' },
  { key: 'm', label: 'Meetings', href: '/app/meetings' },
  { key: 'r', label: 'Reports', href: '/app/reports' },
  { key: 's', label: 'Settings', href: '/app/settings' },
];

/** Two-key "create" shortcuts: press n, then the letter. */
export const CREATE: { key: string; label: string; kind: QuickCreateKind }[] = [
  { key: 'l', label: 'New lead', kind: 'leads' },
  { key: 'c', label: 'New contact', kind: 'contacts' },
  { key: 'o', label: 'New company', kind: 'companies' },
  { key: 'd', label: 'New deal', kind: 'deals' },
  { key: 't', label: 'New task', kind: 'task' },
];

export const SINGLE: { keys: string; label: string }[] = [
  { keys: 'Ctrl K', label: 'Search and commands' },
  { keys: 'Ctrl .', label: 'Turn Focus Workspace on or off' },
  { keys: '[', label: 'Collapse or expand the sidebar' },
  { keys: '?', label: 'Show keyboard shortcuts' },
  { keys: 'Esc', label: 'Close a dialog or panel' },
];

/** True when a key press belongs to a text field or a widget that handles its own keys. */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t.closest('[role="dialog"], [role="menu"], [role="listbox"], [cmdk-root]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export type ShortcutAction =
  | { type: 'go'; href: string }
  | { type: 'create'; kind: QuickCreateKind }
  | { type: 'search' }
  | { type: 'focus' }
  | { type: 'sidebar' }
  | { type: 'help' }
  | { type: 'prefix'; prefix: 'g' | 'n' }
  | null;

/**
 * Decides what a key press does, given the pending prefix ("g" or "n" pressed within the last second).
 * Kept pure so it is unit tested without a browser.
 */
export function resolveShortcut(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'altKey'>,
  prefix: 'g' | 'n' | null,
  typing: boolean,
): ShortcutAction {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'k') return { type: 'search' };
  if (mod && e.key === '.') return { type: 'focus' };
  if (typing || mod || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (prefix === 'g') {
    const hit = GO_TO.find((g) => g.key === k);
    return hit ? { type: 'go', href: hit.href } : null;
  }
  if (prefix === 'n') {
    const hit = CREATE.find((c) => c.key === k);
    return hit ? { type: 'create', kind: hit.kind } : null;
  }
  if (e.key === '?') return { type: 'help' };
  if (e.key === '[') return { type: 'sidebar' };
  if (k === 'g' || k === 'n') return { type: 'prefix', prefix: k };
  return null;
}
