'use client';

import type { MenuSections } from '@dealflow/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton } from '@dealflow/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building, EyeOff, UserPlus } from 'lucide-react';
import { ErrorText } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useCan, useSession } from '@/lib/session';

/**
 * The Super Workspace shows or hides the Leads and Accounts pages for the whole organisation (redesign, menu). Both
 * are hidden until switched on: Companies and their contacts hold the leads, and Companies is the account list.
 */
export function MenuSectionsSettings() {
  const t = useT();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const canManage = useCan('tenant:manage');
  const isSuper = !session?.workspace || session.workspace.level === 'SUPER';
  const sections = useQuery({ queryKey: ['menu-sections'], queryFn: () => api<MenuSections>('/tenants/current/menu-sections'), enabled: canManage && isSuper });
  const save = useMutation({
    mutationFn: (next: MenuSections) => api<MenuSections>('/tenants/current/menu-sections', { method: 'PUT', json: next }),
    // The switch moves at once; it goes back if saving fails.
    onMutate: (next) => {
      const before = qc.getQueryData<MenuSections>(['menu-sections']);
      qc.setQueryData(['menu-sections'], next);
      return { before };
    },
    onError: (_e, _n, ctx) => qc.setQueryData(['menu-sections'], ctx?.before),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
    // One save at a time, in the order the switches were moved.
    scope: { id: 'menu-sections' },
  });
  if (!canManage || !isSuper) return null;
  const rows = [
    { key: 'leads', icon: UserPlus, label: t('Show the Leads page'), text: t('A separate list for inbound leads. Off: leads live with their companies and contacts.') },
    { key: 'accounts', icon: Building, label: t('Show the Accounts page'), text: t('A separate list of accounts. Off: Companies is the account list.') },
  ] as const;
  return (
    <Card data-menu-sections="">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <EyeOff className="size-4 text-primary" aria-hidden />
          {t('Hidden sections')}
        </CardTitle>
        <CardDescription>{t('Leads and Accounts are hidden everywhere until you show them here. The change applies to every workspace in your organisation.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!sections.data ? (
          <Skeleton className="h-20" />
        ) : (
          rows.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/40">
              <input
                type="checkbox"
                role="switch"
                className="mt-1 size-4 accent-[hsl(var(--primary))]"
                checked={sections.data[r.key]}
                onChange={(e) => save.mutate({ ...(qc.getQueryData<MenuSections>(['menu-sections']) ?? sections.data!), [r.key]: e.target.checked })}
                data-section-switch={r.key}
              />
              <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block text-xs text-muted-foreground">{r.text}</span>
              </span>
            </label>
          ))
        )}
        <ErrorText error={save.error} />
      </CardContent>
    </Card>
  );
}
