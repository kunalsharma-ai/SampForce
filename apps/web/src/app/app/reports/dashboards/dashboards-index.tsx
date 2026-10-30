'use client';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import type { DashboardRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { useDashboards } from '@/lib/reports';
import { useCan } from '@/lib/session';

export function DashboardsIndex() {
  const boards = useDashboards();
  const canWrite = useCan('reports:write');
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => api<DashboardRow>('/dashboards', { method: 'POST', json: { name, widgets: [] } }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
      router.push(`/app/reports/dashboards/${d.id}`);
    },
  });
  return (
    <div className="space-y-6">
      {canWrite && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <Field id="d-name" label="New dashboard" className="w-72">
            <Input id="d-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly pipeline review" maxLength={120} />
          </Field>
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            <Plus aria-hidden /> Create
          </Button>
          <ErrorText error={create.error} />
        </form>
      )}
      {boards.isPending ? (
        <Skeleton className="h-32" />
      ) : boards.error ? (
        <ErrorText error={boards.error} />
      ) : boards.data.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">No dashboards yet.{canWrite ? ' Name one above, then add saved reports to it.' : ''}</CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {boards.data.map((d) => (
            <li key={d.id}>
              <Link href={`/app/reports/dashboards/${d.id}`} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <Card className="h-full transition-colors hover:border-primary/50">
                  <CardHeader className="space-y-2">
                    <CardTitle className="text-base">{d.name}</CardTitle>
                    <CardDescription>
                      {d.widgets.length} widget{d.widgets.length === 1 ? '' : 's'} · {d.createdBy?.name ?? 'Former member'} · updated {formatDate(d.updatedAt)}
                    </CardDescription>
                    <div>
                      <Badge tone={d.visibility === 'WORKSPACE' ? 'primary' : 'neutral'}>{d.visibility === 'WORKSPACE' ? 'Shared' : 'Private'}</Badge>
                    </div>
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
