'use client';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Skeleton } from '@dealflow/ui';
import { CAMPAIGN_CHANNELS, type CampaignRow } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Select } from '@/components/crm/select';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api } from '@/lib/api';
import { formatDate, formatMoney, titleCase } from '@/lib/crm';
import { useCampaigns } from '@/lib/revenue';
import { useCan } from '@/lib/session';
import { useT } from '@/lib/i18n';

const STATUS_TONE = { PLANNED: 'neutral', ACTIVE: 'success', COMPLETED: 'primary' } as const;
const channelLabel = (c: string) => titleCase(c.replace(/_/g, ' '));

export function CampaignsWorkspace() {
  const t = useT();
  const campaigns = useCampaigns();
  const canManage = useCan('marketing:manage');
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);
  return (
    <div className="space-y-4">
      {canManage && !editing && (
        <Button size="sm" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> {t('New campaign')}
        </Button>
      )}
      {editing && <CampaignForm key={editing === 'new' ? 'new' : editing.id} campaign={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {campaigns.isPending ? (
            <Skeleton className="m-4 h-24" />
          ) : campaigns.error ? (
            <div className="p-4">
              <ErrorText error={campaigns.error} />
            </div>
          ) : campaigns.data.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{t('No campaigns yet.')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-border text-start text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('Campaign')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Leads')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Converted')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Open pipeline')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Won')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Budget')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Cost per lead')}</th>
                  <th className="px-4 py-2 text-end font-medium">{t('Won ÷ budget')}</th>
                  {canManage && <th className="sr-only">{t('Edit')}</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {campaigns.data.map((c) => {
                  const r = c.results;
                  const money = (v: number | null) => formatMoney(v, c.currency);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-2">
                        <span className="font-medium">{c.name}</span> <Badge tone={STATUS_TONE[c.status]}>{t.maybe(titleCase(c.status))}</Badge>
                        <span className="block text-xs text-muted-foreground">
                          {t.maybe(channelLabel(c.channel))}
                          {c.startDate && ` · ${c.endDate ? t('{start} to {end}', { start: formatDate(c.startDate), end: formatDate(c.endDate) }) : formatDate(c.startDate)}`}
                          {c.utmCampaign && ` · ${t('UTM {value}', { value: c.utmCampaign })}`}
                        </span>
                        {r.otherCurrencyDeals > 0 && <span className="block text-xs text-warning">{t.plural('count.otherCurrencyDeals', r.otherCurrencyDeals)}</span>}
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">{r.leads}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{r.converted}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{money(r.pipeline)}</td>
                      <td className="px-4 py-2 text-end tabular-nums">
                        {money(r.won)}
                        <span className="block text-xs text-muted-foreground">{t.plural('count.deals', r.wonDeals)}</span>
                      </td>
                      <td className="px-4 py-2 text-end tabular-nums">{money(c.budget)}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{r.costPerLead === null ? '—' : formatMoney(r.costPerLead, c.currency)}</td>
                      <td className="px-4 py-2 text-end tabular-nums">{r.returnOnSpend === null ? '—' : `${r.returnOnSpend}×`}</td>
                      {canManage && (
                        <td className="px-4 py-2">
                          <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                            {t('Edit')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('Spend is the budget you enter; DealFlow does not pull spend from ad platforms.')}</p>
    </div>
  );
}

function CampaignForm({ campaign, onDone }: { campaign: CampaignRow | null; onDone: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = useState({
    name: campaign?.name ?? '',
    channel: campaign?.channel ?? 'webinar',
    status: campaign?.status ?? 'PLANNED',
    startDate: campaign?.startDate ?? '',
    endDate: campaign?.endDate ?? '',
    budget: campaign?.budget === null || campaign?.budget === undefined ? '' : String(campaign.budget),
    utmCampaign: campaign?.utmCampaign ?? '',
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () =>
      api(campaign ? `/campaigns/${campaign.id}` : '/campaigns', {
        method: campaign ? 'PUT' : 'POST',
        json: { ...v, startDate: v.startDate || null, endDate: v.endDate || null, budget: v.budget === '' ? null : Number(v.budget), utmCampaign: v.utmCampaign || null },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      onDone();
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{campaign ? t('Edit {name}', { name: campaign.name }) : t('New campaign')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field id="camp-name" label={t('Name')}>
            <Input id="camp-name" required value={v.name} onChange={set('name')} maxLength={160} />
          </Field>
          <Field id="camp-channel" label={t('Channel')}>
            <Select id="camp-channel" value={v.channel} onChange={set('channel')}>
              {CAMPAIGN_CHANNELS.map((c) => (
                <option key={c} value={c}>
                  {t.maybe(channelLabel(c))}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="camp-status" label={t('Status')}>
            <Select id="camp-status" value={v.status} onChange={set('status')}>
              <option value="PLANNED">{t('Planned')}</option>
              <option value="ACTIVE">{t('Active')}</option>
              <option value="COMPLETED">{t('Completed')}</option>
            </Select>
          </Field>
          <Field id="camp-start" label={t('Start')}>
            <Input id="camp-start" type="date" value={v.startDate} onChange={set('startDate')} />
          </Field>
          <Field id="camp-end" label={t('End')}>
            <Input id="camp-end" type="date" value={v.endDate} onChange={set('endDate')} />
          </Field>
          <Field id="camp-budget" label={t('Budget (workspace currency)')}>
            <Input id="camp-budget" value={v.budget} onChange={set('budget')} inputMode="decimal" />
          </Field>
          <Field id="camp-utm" label={t('UTM campaign value')} hint={t('Leads whose campaign source matches this are attributed here.')}>
            <Input id="camp-utm" value={v.utmCampaign} onChange={set('utmCampaign')} maxLength={120} />
          </Field>
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {t('Save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              {t('Cancel')}
            </Button>
          </div>
          <div className="sm:col-span-3">
            <ErrorText error={save.error} />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
