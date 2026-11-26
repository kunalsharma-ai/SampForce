'use client';

import type { CompanyRow, CompanyWonResult } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trophy } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useCan } from '@/lib/session';

/**
 * Company to Deal (redesign R4, ADR 0084) on the company profile: "Mark as won" makes the company a client and
 * makes its deal (or closes its open deal as won); once won, the button opens that deal.
 */
export function CompanyWonButton({ company }: { company: Pick<CompanyRow, 'id' | 'name' | 'wonDealId' | 'restricted'> }) {
  const t = useT();
  const qc = useQueryClient();
  const canCompanies = useCan('companies:write');
  const canDeals = useCan('deals:write');
  const canWin = canCompanies && canDeals && !company.restricted;
  const [open, setOpen] = React.useState(false);
  const win = useMutation({
    mutationFn: () => api<CompanyWonResult>(`/companies/${company.id}/won`, { method: 'POST', json: {} }),
    onSuccess: () =>
      Promise.all(['companies', 'deals', 'rfqs', 'employee-activity', 'company-dashboard', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] }))),
  });
  const dealId = win.data?.deal?.id ?? company.wonDealId;
  if (dealId && !open) {
    return (
      <Button asChild size="sm" variant="outline" data-won-deal>
        <Link href={`/app/deals/${dealId}`}>
          <Trophy aria-hidden className="size-4 text-success" /> {t('Won deal')}
        </Link>
      </Button>
    );
  }
  if (!canWin) return null;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Trophy aria-hidden className="size-4" /> {t('Mark as won')}
      </Button>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) win.reset(); }}>
        <DialogContent className="max-w-md p-6">
          <DialogTitle className="text-lg font-semibold">{t('Mark {company} as won?', { company: company.name })}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {t('The company becomes a client and moves to Deals: its open deal is closed as won, or a won deal is made from its RFQs and contact. The RFQs are linked to the deal.')}
          </DialogDescription>
          {win.data ? (
            <div role="status" className="space-y-3 text-sm">
              <p>
                {win.data.deal
                  ? win.data.created
                    ? t('Deal {deal} was made and marked won.', { deal: win.data.deal.dealNumber ?? win.data.deal.name })
                    : t('Deal {deal} is marked won.', { deal: win.data.deal.dealNumber ?? win.data.deal.name })
                  : t('The company is now a client. No deal was made because the workspace has no deal pipeline with a won stage.')}
              </p>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>{t('Close')}</Button>
                {win.data.deal && (
                  <Button asChild size="sm">
                    <Link href={`/app/deals/${win.data.deal.id}`}>{t('Open the deal')}</Link>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {win.error && <p role="alert" className="text-sm text-critical">{win.error.message}</p>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setOpen(false)}>{t('Cancel')}</Button>
                <Button size="sm" disabled={win.isPending} onClick={() => win.mutate()}>
                  <Trophy aria-hidden className="size-4" /> {win.isPending ? t('Saving…') : t('Mark as won')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
