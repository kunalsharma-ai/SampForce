import {
  Activity,
  Building2,
  CreditCard,
  HelpCircle,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  MessagesSquare,
  Network,
  PenSquare,
  Plug,
  Settings,
  Smartphone,
  Ticket,
} from 'lucide-react';

/**
 * The Console sidebar (ADR 0074): groups in the order of the spec, each item a page that exists today. Items for the
 * pages still to come (Workspaces, Users, Features, Billing...) are added as each part ships, never as dead links.
 */

export type ConsoleBadge = 'chat' | 'tickets';

export interface ConsoleNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Other paths that belong to this item (old routes, detail pages). */
  also?: string[];
  /** Match only the exact path, not the pages under it. */
  exact?: boolean;
  badge?: ConsoleBadge;
  children?: ConsoleNavItem[];
}

export interface ConsoleNavGroup {
  key: string;
  label: string;
  items: ConsoleNavItem[];
}

export const CONSOLE_NAV: ConsoleNavGroup[] = [
  {
    key: 'command',
    label: 'Command',
    items: [
      { key: 'overview', label: 'Overview', href: '/operator', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    key: 'customers',
    label: 'Customers',
    items: [
      {
        key: 'clients',
        label: 'Clients',
        href: '/operator/clients',
        icon: Building2,
        also: ['/operator/tenants'],
      },
      { key: 'workspace-rules', label: 'Workspace rules', href: '/operator/workspace-rules', icon: Network },
      { key: 'mobile', label: 'Mobile app', href: '/operator/mobile', icon: Smartphone },
    ],
  },
  {
    key: 'commercial',
    label: 'Commercial',
    items: [
      { key: 'plans', label: 'Plans & subscriptions', href: '/operator/plans', icon: CreditCard },
    ],
  },
  {
    key: 'support',
    label: 'Support',
    items: [
      {
        key: 'support',
        label: 'Support',
        href: '/operator/support',
        icon: LifeBuoy,
        children: [
          {
            key: 'tickets',
            label: 'Support tickets',
            href: '/operator/support',
            icon: Ticket,
            badge: 'tickets',
          },
          {
            key: 'chat',
            label: 'Support chat',
            href: '/operator/chat',
            icon: MessagesSquare,
            badge: 'chat',
          },
          {
            key: 'help-manage',
            label: 'Help content',
            href: '/operator/help/manage',
            icon: PenSquare,
          },
        ],
      },
    ],
  },
  {
    key: 'governance',
    label: 'Governance',
    items: [{ key: 'audit', label: 'Audit log', href: '/operator/audit', icon: Activity }],
  },
  {
    key: 'platform',
    label: 'Platform',
    items: [
      { key: 'providers', label: 'Providers', href: '/operator/providers', icon: Plug },
      { key: 'settings', label: 'Settings', href: '/operator/settings', icon: Settings },
      { key: 'help', label: 'Help', href: '/operator/help', icon: HelpCircle, exact: true },
    ],
  },
];

export function navItemActive(item: ConsoleNavItem, path: string): boolean {
  if (item.children) return item.children.some((c) => navItemActive(c, path));
  const paths = [item.href, ...(item.also ?? [])];
  return paths.some((p) => path === p || (!item.exact && path.startsWith(`${p}/`)));
}

/** Every page in the menu, flattened, for breadcrumbs and the command palette. */
export const CONSOLE_PAGES: { label: string; href: string; icon: LucideIcon; group: string }[] =
  CONSOLE_NAV.flatMap((g) =>
    g.items.flatMap((i) =>
      i.children
        ? i.children.map((c) => ({ label: c.label, href: c.href, icon: c.icon, group: g.label }))
        : [{ label: i.label, href: i.href, icon: i.icon, group: g.label }],
    ),
  );

/** Titles for path segments that are not menu items, used by the breadcrumbs. */
const SEGMENT_LABEL: Record<string, string> = { manage: 'Manage', tenants: 'Clients' };

export interface Crumb {
  label: string;
  href: string;
}

/**
 * Breadcrumbs from the path: Console › the menu page › each deeper segment. Ids are shown with the label a page
 * registered for them (the client's name), or "Details" until it loads.
 */
export function crumbsFor(path: string, labels: Record<string, string>): Crumb[] {
  const crumbs: Crumb[] = [{ label: 'Console', href: '/operator' }];
  if (path === '/operator') return [...crumbs, { label: 'Overview', href: '/operator' }];
  const parts = path.split('/').filter(Boolean).slice(1);
  let href = '/operator';
  for (const part of parts) {
    href = `${href}/${part}`;
    const page =
      CONSOLE_PAGES.find((p) => p.href === href) ??
      (href === '/operator/tenants'
        ? CONSOLE_PAGES.find((p) => p.href === '/operator/clients')
        : undefined);
    const label =
      labels[href] ??
      labels[part] ??
      page?.label ??
      SEGMENT_LABEL[part] ??
      (/^[0-9a-f-]{20,}$/i.test(part) ? 'Details' : part.charAt(0).toUpperCase() + part.slice(1));
    crumbs.push({ label, href: page?.href ?? href });
  }
  return crumbs;
}
