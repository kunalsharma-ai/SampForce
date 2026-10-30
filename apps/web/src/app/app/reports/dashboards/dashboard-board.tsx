'use client';

import { Button, Card, CardContent, CardHeader, CardTitle, cn, Input, Skeleton } from '@dealflow/ui';
import { type DashboardRow, MAX_DASHBOARD_WIDGETS, type ReportRow, type ReportVisibility } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ReportView } from '@/components/reports/report-view';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { useDashboard, useReports, useSavedResult } from '@/lib/reports';

type Widget = DashboardRow['widgets'][number];
const SPAN: Record<Widget['size'], string> = { sm: 'lg:col-span-2', md: 'lg:col-span-3', lg: 'lg:col-span-6' };
const SIZE_LABEL: Record<Widget['size'], string> = { sm: 'Small (a third)', md: 'Medium (half)', lg: 'Large (full width)' };

export function DashboardBoard({ id }: { id: string }) {
  const board = useDashboard(id);
  const reports = useReports();
  if (board.isPending || reports.isPending) return <Skeleton className="h-96" />;
  if (board.error) return <ErrorText error={board.error} />;
  if (reports.error) return <ErrorText error={reports.error} />;
  return <Board board={board.data} reports={reports.data} key={board.data.updatedAt} />;
}

function Board({ board, reports }: { board: DashboardRow; reports: ReportRow[] }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(board.editable && board.widgets.length === 0);
  const [name, setName] = useState(board.name);
  const [visibility, setVisibility] = useState<ReportVisibility>(board.visibility);
  const [widgets, setWidgets] = useState<Widget[]>(board.widgets);
  const [adding, setAdding] = useState('');
  const byId = new Map(reports.map((r) => [r.id, r]));
  const shown = editing ? widgets : board.widgets;
  const candidates = reports.filter((r) => !widgets.some((w) => w.reportId === r.id) && (visibility === 'PRIVATE' || r.visibility === 'WORKSPACE'));

  const save = useMutation({
    mutationFn: () => api<DashboardRow>(`/dashboards/${board.id}`, { method: 'PUT', json: { name, description: board.description, visibility, widgets } }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api<void>(`/dashboards/${board.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['dashboards'] });
      router.push('/app/reports/dashboards');
    },
  });
  const move = (i: number, d: -1 | 1) => setWidgets((ws) => {
    const next = [...ws];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {editing ? (
          <div className="flex flex-wrap items-end gap-3">
            <h1 className="w-full text-2xl font-semibold tracking-tight">Edit dashboard</h1>
            <Field id="b-name" label="Dashboard name" className="w-72">
              <Input id="b-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
            </Field>
            <Field id="b-vis" label="Who can see it">
              <Select id="b-vis" value={visibility} onChange={(e) => setVisibility(e.target.value as ReportVisibility)}>
                <option value="PRIVATE">Only me</option>
                <option value="WORKSPACE">Shared with the workspace</option>
              </Select>
            </Field>
          </div>
        ) : (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{board.name}</h1>
            <p className="text-sm text-muted-foreground">
              {board.visibility === 'WORKSPACE' ? 'Shared with the workspace' : 'Private'} · {board.createdBy?.name ?? 'Former member'}
            </p>
          </div>
        )}
        {board.editable && (
          <div className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
                  <Save aria-hidden /> Save dashboard
                </Button>
                <Button variant="outline" onClick={() => { setEditing(false); setWidgets(board.widgets); setName(board.name); setVisibility(board.visibility); }}>
                  Cancel
                </Button>
                <Button variant="ghost" className="text-critical" onClick={() => window.confirm(`Delete the dashboard “${board.name}”? Its reports are kept.`) && remove.mutate()}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> Edit
              </Button>
            )}
          </div>
        )}
      </div>
      <ErrorText error={save.error ?? remove.error} />
      {editing && (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 p-4">
            <Field id="b-add" label="Add a saved report" className="min-w-64 flex-1" hint={visibility === 'WORKSPACE' ? 'A shared dashboard can only hold shared reports.' : undefined}>
              <Select id="b-add" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Choose a report</option>
                {candidates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            </Field>
            <Button
              variant="outline"
              disabled={!adding || widgets.length >= MAX_DASHBOARD_WIDGETS}
              onClick={() => { setWidgets([...widgets, { reportId: adding, size: 'md' }]); setAdding(''); }}
            >
              <Plus aria-hidden /> Add
            </Button>
            {reports.length === 0 && (
              <p className="w-full text-sm text-muted-foreground">
                No saved reports yet. <Link className="text-primary underline" href="/app/reports/new">Build one</Link> first.
              </p>
            )}
          </CardContent>
        </Card>
      )}
      {shown.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">This dashboard has no widgets yet.</CardContent>
        </Card>
      ) : (
        <ol className="grid gap-4 lg:grid-cols-6" aria-label="Dashboard widgets">
          {shown.map((w, i) => {
            const report = byId.get(w.reportId);
            return (
              <li key={w.reportId} className={cn('min-w-0', SPAN[w.size])}>
                <Card className="h-full">
                  <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
                    <CardTitle className="text-base">
                      {report ? <Link href={`/app/reports/${report.id}`} className="hover:underline">{report.name}</Link> : 'Report no longer available'}
                    </CardTitle>
                    {editing && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Select aria-label={`Size of ${report?.name ?? 'widget'}`} value={w.size} onChange={(e) => setWidgets(widgets.map((x, j) => (j === i ? { ...x, size: e.target.value as Widget['size'] } : x)))} className="h-8 w-40 text-xs">
                          {(['sm', 'md', 'lg'] as const).map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
                        </Select>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${report?.name ?? 'widget'} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                          <ArrowUp aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Move ${report?.name ?? 'widget'} later`} disabled={i === widgets.length - 1} onClick={() => move(i, 1)}>
                          <ArrowDown aria-hidden />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${report?.name ?? 'widget'}`} onClick={() => setWidgets(widgets.filter((_, j) => j !== i))}>
                          <X aria-hidden />
                        </Button>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent>{report ? <WidgetBody report={report} /> : <p className="text-sm text-muted-foreground">It was deleted or is no longer shared with you.</p>}</CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function WidgetBody({ report }: { report: ReportRow }) {
  const result = useSavedResult(report.id);
  if (result.isPending) return <Skeleton className="h-48" />;
  if (result.error) return <ErrorText error={result.error} />;
  return <ReportView result={result.data} chart={report.definition.chart} height={220} compact />;
}
