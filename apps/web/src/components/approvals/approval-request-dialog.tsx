'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { CheckCircle2, Hourglass, Send, ShieldQuestion } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { type ApprovalAsk, setApprovalAsker } from '@/lib/approval-asker';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { IconTile } from './approval-visuals';

/*
 * Ask your manager (ADR 0097). Mounted once by the app shell: any delete (or guarded edit) an Executive Workspace
 * makes anywhere opens this dialog instead of failing. The person says why; the request goes to their manager with
 * the exact action, and the Approvals page carries it out once approved.
 */
export function ApprovalRequestProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const id = useId();
  const [ask, setAsk] = useState<ApprovalAsk | null>(null);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((sent: boolean) => void) | null>(null);

  useEffect(() => {
    setApprovalAsker(
      (next) =>
        new Promise<boolean>((resolve) => {
          resolver.current?.(false);
          resolver.current = resolve;
          setReason('');
          setSent(false);
          setError(null);
          setAsk(next);
        }),
    );
    return () => {
      setApprovalAsker(null);
      resolver.current?.(false);
    };
  }, []);

  const close = () => {
    resolver.current?.(sent);
    resolver.current = null;
    setAsk(null);
  };

  const submit = async () => {
    if (!ask || reason.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('/team-approvals', {
        method: 'POST',
        json: { category: ask.category, reason: reason.trim(), action: { method: ask.method, path: ask.path, ...(ask.body === undefined ? {} : { body: ask.body }) } },
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Could not reach SampForce. Check your connection.'));
    } finally {
      setBusy(false);
    }
  };

  const what = ask
    ? ask.recordName
      ? t('{type}: {name}', { type: t.maybe(ask.recordTypeLabel ?? 'Record'), name: ask.recordName })
      : ask.recordCount && ask.recordTypeLabel
        ? t('{count} {type}', { count: ask.recordCount.toLocaleString(t.formatLocale), type: t.maybe(ask.recordTypeLabel).toLowerCase() })
        : t.maybe(ask.recordTypeLabel ?? 'This record')
    : '';

  return (
    <>
      {children}
      <Dialog open={!!ask} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent className="max-w-md overflow-hidden p-0" data-approval-request>
          <div className="relative bg-gradient-to-br from-primary/15 via-accent/10 to-transparent px-6 pb-4 pt-6">
            <div className="flex items-start gap-3">
              <IconTile icon={sent ? CheckCircle2 : ask?.pendingId ? Hourglass : ShieldQuestion} color={sent ? '#059669' : ask?.pendingId ? '#d97706' : '#4f46e5'} size="lg" />
              <div className="min-w-0">
                <DialogTitle className="text-lg font-semibold">
                  {sent ? t('Sent to your manager') : ask?.pendingId ? t('Already waiting for your manager') : t('Ask your manager to approve')}
                </DialogTitle>
                <DialogDescription className="mt-1 text-sm text-muted-foreground">
                  {sent
                    ? ask?.category === 'record_edit'
                      ? t('Nothing is changed yet. You will be told when your manager decides, and you finish it from Approvals.')
                      : t('Nothing is deleted yet. You will be told when your manager decides, and you finish it from Approvals.')
                    : ask?.pendingId
                      ? t('You asked for this already. Your manager has not decided yet.')
                      : ask?.category === 'record_edit'
                        ? t('Your workspace needs a manager’s approval to change this record.')
                        : t('Your workspace needs a manager’s approval to delete this.')}
                </DialogDescription>
              </div>
            </div>
            {what && (
              <p className="mt-4 rounded-lg border border-border bg-surface/80 px-3 py-2 text-sm font-medium" data-approval-what>
                {what}
              </p>
            )}
          </div>
          <div className="px-6 pb-6 pt-4">
            {sent || ask?.pendingId ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={ask?.pendingId ? `/app/approvals?request=${ask.pendingId}` : '/app/approvals?box=mine'} onClick={close}>
                    {t('Open Approvals')}
                  </Link>
                </Button>
                <Button onClick={close}>{t('Close')}</Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submit();
                }}
              >
                <div className="space-y-1.5 text-sm">
                  <label htmlFor={`${id}-reason`} className="block font-medium">
                    {t('Why? Your manager sees this')}
                  </label>
                  <Textarea id={`${id}-reason`} value={reason} maxLength={1000} autoFocus onChange={(e) => setReason(e.target.value)} placeholder={t('For example: a duplicate of another record')} />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-critical">
                    {error}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={close} disabled={busy}>
                    {t('Cancel')}
                  </Button>
                  <Button type="submit" disabled={reason.trim().length < 3 || busy}>
                    <Send className="size-4" aria-hidden />
                    {busy ? t('Sending…') : t('Send for approval')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
