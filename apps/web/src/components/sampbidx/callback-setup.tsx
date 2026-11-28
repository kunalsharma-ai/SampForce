'use client';

import { Button, Input, Label } from '@dealflow/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link2 } from 'lucide-react';
import * as React from 'react';
import { CopyButton } from '@/components/my-organization/parts';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

/**
 * The status callback URL and signing secret before there is an API key (ADR 0099). SampBidx's Integration Hub asks
 * for both before it will save, and only then creates the key, so SampForce hands them out first. They stay the
 * same when the key is saved later. Admins only (the server checks integrations:manage).
 */
export function SampbidxCallbackSetup({ idPrefix = 'sbx-setup' }: { idPrefix?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const setup = useMutation({
    mutationFn: () => api<{ callbackUrl: string; secret: string }>('/apps/sampbidx/callback-setup', { method: 'POST', json: {} }),
    onSuccess: (d) => qc.setQueryData(['apps', 'sampbidx', 'secret'], d),
  });
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3" data-testid="sampbidx-callback-setup">
      <p className="font-medium">{t('Step 1: give SampBidx the callback URL and signing secret')}</p>
      <p className="text-xs text-muted-foreground">{t('SampBidx asks for these before it saves and creates the API key. Paste them into SampBidx’s Status callback URL and Callback signing secret, save there, create the key, then paste the key below. They stay the same when the key is saved.')}</p>
      {setup.data ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-url`}>{t('Status callback URL')}</Label>
            <div className="flex items-center gap-1.5">
              <Input id={`${idPrefix}-url`} readOnly value={setup.data.callbackUrl} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={setup.data.callbackUrl} label={t('Copy the callback URL')} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${idPrefix}-secret`}>{t('Callback signing secret')}</Label>
            <div className="flex items-center gap-1.5">
              <Input id={`${idPrefix}-secret`} readOnly value={setup.data.secret} onFocus={(e) => e.currentTarget.select()} />
              <CopyButton value={setup.data.secret} label={t('Copy the signing secret')} />
            </div>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={setup.isPending} onClick={() => setup.mutate()}>
          <Link2 aria-hidden className="size-4" /> {setup.isPending ? t('Preparing…') : t('Show the callback URL and signing secret')}
        </Button>
      )}
      {setup.error && (
        <p role="alert" className="break-words text-xs text-critical">
          {setup.error.message}
        </p>
      )}
    </div>
  );
}
