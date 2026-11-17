import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  completeLayout,
  DASHBOARD_WIDGETS,
  type DashboardWidget,
  type DashboardLayout,
  dashboardLayoutSchema,
  type NavigationState,
  type NavItem,
  navItemSchema,
  pushRecent,
  type UpdateNavigationInput,
} from '@dealflow/types';
import { Prisma } from '@dealflow/database';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../common/prisma.service';
import { dashboardPolicyOfMember } from '../crm/crm-admin.service';

const EMPTY: NavigationState = { pinned: [], recent: [], moduleOrder: [], hiddenModules: [] };

/** Reads stored JSON defensively: anything that no longer validates is dropped rather than sent to the browser. */
function items(v: Prisma.JsonValue): NavItem[] {
  return Array.isArray(v) ? v.flatMap((x) => (navItemSchema.safeParse(x).success ? [navItemSchema.parse(x)] : [])) : [];
}
function recentItems(v: Prisma.JsonValue): NavigationState['recent'] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((x) => {
    const r = x as Record<string, unknown>;
    const parsed = navItemSchema.safeParse({ href: r?.href, label: r?.label, kind: r?.kind });
    return parsed.success && typeof r.visitedAt === 'string' ? [{ ...parsed.data, visitedAt: r.visitedAt }] : [];
  });
}

/**
 * Personal navigation in the current workspace. The document is held by the workspace guard to both the workspace and the person,
 * so one member can never read or change another's pins or history.
 */
@Injectable()
export class NavigationService {
  constructor(private readonly prisma: PrismaService) {}

  async get(auth: AuthContext): Promise<NavigationState> {
    const row = await this.prisma.run(auth, (tx) =>
      tx.workspaceNavigation.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } } }),
    );
    if (!row) return EMPTY;
    return { pinned: items(row.pinned), recent: recentItems(row.recent), moduleOrder: row.moduleOrder, hiddenModules: row.hiddenModules };
  }

  async update(auth: AuthContext, input: UpdateNavigationInput): Promise<NavigationState> {
    const data = {
      ...(input.pinned ? { pinned: dedupe(input.pinned) as unknown as Prisma.InputJsonValue } : {}),
      ...(input.moduleOrder ? { moduleOrder: [...new Set(input.moduleOrder)] } : {}),
      ...(input.hiddenModules ? { hiddenModules: [...new Set(input.hiddenModules)].filter((s) => s !== 'settings') } : {}),
    };
    await this.prisma.run(auth, (tx) =>
      tx.workspaceNavigation.upsert({
        where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } },
        create: { tenantId: auth.tenantId, userId: auth.userId, ...data },
        update: data,
      }),
    );
    return this.get(auth);
  }

  /** Records a page visit at the front of the recent list. */
  async visit(auth: AuthContext, item: NavItem): Promise<NavigationState> {
    await this.prisma.run(auth, async (tx) => {
      const key = { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } };
      const row = await tx.workspaceNavigation.findUnique({ where: key });
      const recent = pushRecent(row ? recentItems(row.recent) : [], item, new Date()) as unknown as Prisma.InputJsonValue;
      await tx.workspaceNavigation.upsert({ where: key, create: { tenantId: auth.tenantId, userId: auth.userId, recent }, update: { recent } });
    });
    return this.get(auth);
  }

  /**
   * The person's layout under their tier's dashboard policy (ADR 0062): widgets the tier may not have are left out,
   * and when the tier may not customise, the saved layout is ignored. `policy` tells the page what applies.
   */
  async getDashboardLayout(auth: AuthContext): Promise<{ layout: DashboardLayout | null; policy: { tier: string; allowed: string[]; locked: boolean } | null }> {
    return this.prisma.run(auth, async (tx) => {
      const row = await tx.workspaceNavigation.findUnique({ where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } }, select: { dashboardLayout: true } });
      const layout = readLayout(row?.dashboardLayout);
      const { tier, policy } = await dashboardPolicyOfMember(tx, auth);
      if (!tier || !policy) return { layout, policy: null };
      const allowed = (policy.allowedWidgets ?? [...DASHBOARD_WIDGETS]).filter((id): id is DashboardWidget => (DASHBOARD_WIDGETS as readonly string[]).includes(id));
      const ok = new Set<string>(allowed);
      const base = !policy.canCustomize ? null : layout;
      return { layout: base ? { ...base, widgets: base.widgets.filter((w) => ok.has(w.id)) } : null, policy: { tier, allowed, locked: !policy.canCustomize } };
    });
  }

  /** Saves the layout; null returns to the default. Refused when the person's tier may not customise. */
  async saveDashboardLayout(auth: AuthContext, layout: DashboardLayout | null): Promise<{ layout: DashboardLayout | null; policy: { tier: string; allowed: string[]; locked: boolean } | null }> {
    const locked = await this.prisma.run(auth, async (tx) => (await dashboardPolicyOfMember(tx, auth)).policy?.canCustomize === false);
    if (locked) throw new ForbiddenException({ code: 'LAYOUT_LOCKED', message: 'Your administrator has fixed the dashboard layout for your designation.' });
    const value = layout ? (completeLayout(layout) as unknown as Prisma.InputJsonValue) : null;
    await this.prisma.run(auth, (tx) =>
      tx.workspaceNavigation.upsert({
        where: { tenantId_userId: { tenantId: auth.tenantId, userId: auth.userId } },
        create: { tenantId: auth.tenantId, userId: auth.userId, dashboardLayout: value },
        update: { dashboardLayout: value },
      }),
    );
    return this.getDashboardLayout(auth);
  }

  async clearRecent(auth: AuthContext): Promise<NavigationState> {
    await this.prisma.run(auth, (tx) =>
      tx.workspaceNavigation.updateMany({ where: { tenantId: auth.tenantId, userId: auth.userId }, data: { recent: [] } }),
    );
    return this.get(auth);
  }
}

/** The stored Command Center layout, or null for the default. Invalid stored layouts are treated as unset. */
export function readLayout(v: Prisma.JsonValue | null | undefined): DashboardLayout | null {
  const parsed = dashboardLayoutSchema.safeParse(v);
  return parsed.success ? completeLayout(parsed.data) : null;
}

function dedupe(list: NavItem[]): NavItem[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.href) ? false : (seen.add(i.href), true)));
}
