'use client';

import { type LeadTransferRow, TRANSFER_REASONS } from '@dealflow/types';
import {
  Badge,
  Button,
  Card,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Field,
  Input,
  Skeleton,
} from '@dealflow/ui';
import { ArrowRightLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';
import { REASON_LABELS } from '@/components/crm/company-parts';
import { PersonSelect } from '@/components/crm/lead-fields';
import { Select, Textarea } from '@/components/crm/select';
import { useLeadTransfers, useTransferMutations } from '@/lib/command-center';
import { formatDate } from '@/lib/crm';
import { useT } from '@/lib/i18n';
import { TRANSFER_STATUS_LABEL, TRANSFER_STATUS_TONE } from './cc-labels';
import { money } from './tier-parts';

/**
 * Lead transfer requests (ADR 0063, master spec section 10.6): the ones the person sent, and the ones waiting for
 * their decision. A decision moves the lead; the creator never changes.
 */
export function TransferRequests() {
  const t = useT();
  const params = useSearchParams();
  const focus = params.get('transfer');
  const toDecide = useLeadTransfers('toDecide', { status: 'PENDING' });
  const mine = useLeadTransfers('mine');
  const [box, setBox] = React.useState<'toDecide' | 'mine'>('mine');
  const [deciding, setDeciding] = React.useState<LeadTransferRow | null>(null);
  const waiting = toDecide.data?.length ?? 0;
  React.useEffect(() => {
    if (waiting) setBox('toDecide');
  }, [waiting]);
  React.useEffect(() => {
    const row = focus && toDecide.data?.find((r) => r.id === focus);
    if (row) setDeciding(row);
  }, [focus, toDecide.data]);
  const list = box === 'toDecide' ? toDecide : mine;
  return (
    <Card className="p-0">
      <div
        role="tablist"
        aria-label={t('Company transfer requests')}
        className="flex gap-1 border-b border-border px-3 pt-2"
      >
        {(
          [
            ['mine', t('Sent by you')],
            ['toDecide', t('Waiting for your decision')],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={box === id}
            onClick={() => setBox(id)}
            className={cn(
              '-mb-px rounded-t-md border-b-2 px-3 py-2 text-sm',
              box === id
                ? 'border-primary font-medium text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {id === 'toDecide' && waiting > 0 && (
              <Badge tone="warning" className="ms-2">
                {waiting}
              </Badge>
            )}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="p-3">
        {list.isPending ? (
          <Skeleton className="h-24" />
        ) : !list.data?.length ? (
          <p className="p-3 text-sm text-muted-foreground">
            {box === 'toDecide'
              ? t('No requests are waiting for you.')
              : t('You have not asked to transfer a company. Use Request transfer on a company page.')}
          </p>
        ) : (
          <ul className="divide-y divide-border" data-testid={`transfers-${box}`}>
            {list.data.map((r) => (
              <TransferItem key={r.id} row={r} onDecide={() => setDeciding(r)} />
            ))}
          </ul>
        )}
      </div>
      {deciding && <DecisionDialog row={deciding} onClose={() => setDeciding(null)} />}
    </Card>
  );
}

function TransferItem({ row: r, onDecide }: { row: LeadTransferRow; onDecide: () => void }) {
  const t = useT();
  const { cancel } = useTransferMutations();
  const [editing, setEditing] = React.useState(false);
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-2 py-3">
      <div className="min-w-0">
        <Link href={`/app/companies/${r.company.id}`} className="font-medium hover:underline">
          {[r.company.leadNumber, r.company.name].filter(Boolean).join(' ')}
        </Link>
        <p className="text-xs text-muted-foreground">
          {[
            t(REASON_LABELS[r.reason as keyof typeof REASON_LABELS] ?? 'Other'),
            r.requestedBy && t('Asked by {name}', { name: r.requestedBy.name }),
            r.proposed ? t('to {name}', { name: r.proposed.name }) : t('to their manager’s choice'),
            r.opportunityValue !== null && money(r.opportunityValue, r.currency ?? 'USD'),
            formatDate(r.createdAt),
            r.editedAt && t('(edited)'),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {r.remarks && <p className="mt-1 text-sm">“{r.remarks}”</p>}
        {r.decisionNote && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('{name}: {note}', { name: r.decidedBy?.name ?? '', note: r.decisionNote })}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={TRANSFER_STATUS_TONE[r.status]}>{t(TRANSFER_STATUS_LABEL[r.status])}</Badge>
        {r.canDecide && (
          <Button size="sm" onClick={onDecide}>
            {t('Decide')}
          </Button>
        )}
        {r.canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={t('Edit “{subject}”', { subject: r.company.name })}>
            <Pencil aria-hidden />
          </Button>
        )}
        {r.status === 'PENDING' && !r.canDecide && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => cancel.mutate(r.id)}
            disabled={cancel.isPending}
          >
            {t('Withdraw')}
          </Button>
        )}
      </div>
      {editing && <RequestTransferDialog company={r.company} editing={r} open={editing} onClose={() => setEditing(false)} />}
    </li>
  );
}

function DecisionDialog({ row: r, onClose }: { row: LeadTransferRow; onClose: () => void }) {
  const t = useT();
  const { decide } = useTransferMutations();
  const [action, setAction] = React.useState<'APPROVE' | 'REJECT' | 'REASSIGN'>('APPROVE');
  const [toUserId, setToUserId] = React.useState('');
  const [note, setNote] = React.useState('');
  const [instructions, setInstructions] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (action === 'REASSIGN' && !toUserId) return setError(t('Choose who takes the company.'));
    try {
      await decide.mutateAsync({
        id: r.id,
        input: {
          action,
          toUserId: action === 'REASSIGN' ? toUserId : null,
          note: note || null,
          instructions: action === 'REJECT' ? null : instructions || null,
        },
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">
          {t('Decide on the transfer of {name}', { name: r.company.name })}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {r.proposed
            ? t('{from} asks to give this company to {to}.', {
                from: r.requestedBy?.name ?? '',
                to: r.proposed.name,
              })
            : t('{from} asks you to choose who takes this company.', {
                from: r.requestedBy?.name ?? '',
              })}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t('Decision')}</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {(
                [
                  ['APPROVE', r.proposed ? t('Approve') : t('Approve and take it myself')],
                  ['REASSIGN', t('Give it to someone else')],
                  ['REJECT', t('Reject')],
                ] as const
              ).map(([v, label]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="decision"
                    value={v}
                    checked={action === v}
                    onChange={() => setAction(v)}
                  />{' '}
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          {action === 'REASSIGN' && (
            <Field id="transfer-to" label={t('Who takes the company')} error={error ?? undefined}>
              <PersonSelect assignableOnly value={toUserId} onChange={setToUserId} />
            </Field>
          )}
          <Field id="transfer-note" label={t('Note to the requester')}>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {action !== 'REJECT' && (
            <Field id="transfer-instructions" label={t('Instructions for the new owner')}>
              <Textarea
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
          )}
          {error && action !== 'REASSIGN' && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={decide.isPending}>
              {decide.isPending ? t('Saving…') : t('Save decision')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Request transfer" on a company page: asks a manager or senior person to take the lead. With `editing`, the
 * requester changes that pending request instead.
 */
export function RequestTransferDialog({
  company,
  open,
  onClose,
  editing,
}: {
  company: { id: string; name: string; currency?: string | null };
  open: boolean;
  onClose: () => void;
  editing?: LeadTransferRow;
}) {
  const t = useT();
  const { request, update } = useTransferMutations();
  const [toUserId, setToUserId] = React.useState('');
  const [reason, setReason] =
    React.useState<(typeof TRANSFER_REASONS)[number]>('SENIOR_DISCUSSION');
  const [value, setValue] = React.useState('');
  const [currency, setCurrency] = React.useState(company.currency ?? 'USD');
  const [remarks, setRemarks] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setToUserId(editing?.proposed?.id ?? '');
      setReason((editing?.reason as (typeof TRANSFER_REASONS)[number] | undefined) ?? 'SENIOR_DISCUSSION');
      setValue(editing?.opportunityValue != null ? String(editing.opportunityValue) : '');
      if (editing?.currency) setCurrency(editing.currency);
      setRemarks(editing?.remarks ?? '');
      setError(null);
    }
  }, [open, editing]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          input: { toUserId: toUserId || null, reason, opportunityValue: value ? Number(value) : null, currency: value ? currency : null, remarks: remarks || null },
        });
        onClose();
        return;
      }
      await request.mutateAsync({
        companyId: company.id,
        toUserId: toUserId || null,
        reason,
        opportunityValue: value ? Number(value) : null,
        currency: value ? currency : null,
        remarks: remarks || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
          <ArrowRightLeft className="size-5" aria-hidden /> {editing ? t('Edit transfer request') : t('Request a company transfer')}
        </DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">
          {t('Your manager decides. You stay recorded as the person who created {name}.', {
            name: company.name,
          })}
        </DialogDescription>
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field
            id="tr-to"
            label={t('Proposed new owner')}
            hint={t('Leave empty to let your manager choose.')}
          >
            <PersonSelect value={toUserId} onChange={setToUserId} />
          </Field>
          <Field id="tr-reason" label={t('Reason')}>
            <Select
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof TRANSFER_REASONS)[number])}
            >
              {TRANSFER_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(REASON_LABELS[r])}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_7rem] gap-2">
            <Field id="tr-value" label={t('Opportunity value')}>
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
            <Field id="tr-currency" label={t('Currency')}>
              <Input
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </Field>
          </div>
          <Field id="tr-remarks" label={t('Remarks')}>
            <Textarea rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={request.isPending || update.isPending}>
              {editing ? (update.isPending ? t('Saving…') : t('Save changes')) : request.isPending ? t('Sending…') : t('Send request')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
