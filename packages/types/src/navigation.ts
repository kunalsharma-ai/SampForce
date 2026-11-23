import { z } from 'zod';

/*
 * Personal navigation per workspace (design spec Part 3 and Part 13): pinned pages and records, and the order and
 * visibility of sidebar modules. Kept per workspace because records differ between them. Recently visited pages are
 * not kept (removed 2026-11-22 at the owner's request), so no browsing history is recorded.
 */

/** In-app paths only: "/app" or "/app/…", no scheme, no "//", no backslashes, so a stored link cannot leave SampForce. */
export const appPathSchema = z
  .string()
  .max(300)
  .regex(/^\/app(\/[A-Za-z0-9._~\-/]*)?(\?[A-Za-z0-9._~\-=&%]*)?$/, 'Must be a SampForce page')
  .refine((p) => !p.includes('//') && !p.includes('/../') && !p.endsWith('/..'), 'Must be a SampForce page');

export const NAV_ITEM_KINDS = ['module', 'lead', 'contact', 'company', 'deal', 'quote', 'report', 'page'] as const;
export type NavItemKind = (typeof NAV_ITEM_KINDS)[number];

export const navItemSchema = z
  .object({
    href: appPathSchema,
    label: z.string().trim().min(1).max(120),
    kind: z.enum(NAV_ITEM_KINDS),
  })
  .strict();
export type NavItem = z.infer<typeof navItemSchema>;

export const MAX_PINNED = 20;

const slug = z.string().max(40).regex(/^[a-z-]*$/);

export const updateNavigationSchema = z
  .object({
    pinned: z.array(navItemSchema).max(MAX_PINNED).optional(),
    /** Module slugs in the order the person wants them; modules not listed keep their default position after these. */
    moduleOrder: z.array(slug).max(60).optional(),
    /** Module slugs hidden from the sidebar (still reachable from search). */
    hiddenModules: z.array(slug).max(60).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export type UpdateNavigationInput = z.infer<typeof updateNavigationSchema>;

export interface NavigationState {
  pinned: NavItem[];
  moduleOrder: string[];
  hiddenModules: string[];
}

/** The kind of item a path is, from its first segment. Record pages are /app/<module>/<uuid>. */
export function navKindForPath(path: string): NavItemKind {
  const m = /^\/app\/([a-z-]+)\/([0-9a-f-]{36})(?:[/?]|$)/.exec(path);
  if (m) {
    const map: Record<string, NavItemKind> = { leads: 'lead', contacts: 'contact', companies: 'company', deals: 'deal', quotes: 'quote', reports: 'report' };
    return map[m[1]!] ?? 'page';
  }
  return /^\/app(\/[a-z-]+)?\/?$/.test(path.split('?')[0]!) ? 'module' : 'page';
}
