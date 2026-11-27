import { TEAM_APPROVAL_CATEGORY_LABEL, TEAM_APPROVAL_STATUS_LABEL, type TeamApprovalRow } from '@dealflow/types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../lib/api';
import { currentLanguage, t, tMaybe } from '../lib/i18n';
import { useController, useTheme } from '../lib/session';
import { Body, Button, Card, ErrorNote, Field } from './ui';

/*
 * Team approvals on the phone (ADR 0098): an Executive Workspace's delete goes to its manager first. These are the
 * "ask your manager" card shown where a delete was refused, and one request as the Approvals screen shows it.
 */

/** What the server said when it refused a delete for want of an approval. */
export interface ApprovalNeeded {
  method: 'DELETE' | 'POST' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
  category: 'delete' | 'record_edit';
  pendingId: string | null;
}

/** The refusal, if this error is one (403 APPROVAL_REQUIRED), as something the screen can ask about. */
export function approvalNeededOf(e: unknown, method: ApprovalNeeded['method'], path: string, body?: unknown): ApprovalNeeded | null {
  if (!(e instanceof ApiError) || e.status !== 403 || e.code !== 'APPROVAL_REQUIRED') return null;
  const detail = (key: string) => e.details.find((d) => d.path === key)?.message ?? null;
  return { method, path, ...(body === undefined ? {} : { body }), category: detail('category') === 'record_edit' ? 'record_edit' : 'delete', pendingId: detail('pendingId') || null };
}

/** Asks the manager: a reason, then the request goes with the exact action. */
export function AskManagerCard({ need, onDone }: { need: ApprovalNeeded; onDone: () => void }) {
  const c = useController();
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await c.api.post('/team-approvals', { category: need.category, reason: reason.trim(), action: { method: need.method, path: need.path, ...(need.body === undefined ? {} : { body: need.body }) } });
      setSent(true);
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  if (sent || need.pendingId)
    return (
      <Card accent>
        <Body style={{ fontWeight: '600' }}>{sent ? t('Sent to your manager') : t('Already waiting for your manager')}</Body>
        <Body muted>{sent ? (need.category === 'record_edit' ? t('Nothing is changed yet. You will be told when your manager decides, and you finish it from Approvals.') : t('Nothing is deleted yet. You will be told when your manager decides, and you finish it from Approvals.')) : t('You asked for this already. Your manager has not decided yet.')}</Body>
        <Button label={t('Open Approvals')} onPress={() => router.push(need.pendingId ? `/approvals?request=${need.pendingId}` : '/approvals')} />
        <Button kind="secondary" label={t('Close')} onPress={onDone} />
      </Card>
    );
  return (
    <Card accent>
      <Body style={{ fontWeight: '600' }}>{t('Ask your manager to approve')}</Body>
      <Body muted>{need.category === 'record_edit' ? t('Your workspace needs a manager’s approval to change this record.') : t('Your workspace needs a manager’s approval to delete this.')}</Body>
      <Field label={t('Why? Your manager sees this')} value={reason} onChangeText={setReason} multiline maxLength={1000} placeholder={t('For example: a duplicate of another record')} />
      {error ? <ErrorNote message={error} /> : null}
      <Button label={t('Send for approval')} busy={busy} disabled={reason.trim().length < 3} onPress={() => void send()} />
      <Button kind="secondary" label={t('Cancel')} onPress={onDone} />
    </Card>
  );
}

const when = (iso: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(currentLanguage(), { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const STATUS_COLOUR: Record<TeamApprovalRow['status'], string> = { PENDING: '#B45309', APPROVED: '#047857', REJECTED: '#BE123C', CANCELLED: '#475569', EXPIRED: '#475569', COMPLETED: '#1D4ED8' };

/** One request: what, who, why, the decision, and what this person can do with it now. */
export function ApprovalCard({ row, onChanged }: { row: TeamApprovalRow; onChanged: () => void }) {
  const c = useController();
  const th = useTheme();
  const [note, setNote] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<'reject' | 'finish' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const act = async (kind: string, fn: () => Promise<unknown>, message?: string) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      setStep(null);
      setPassword('');
      if (message) setDone(message);
      onChanged();
    } catch (e) {
      if (!c.report(e)) setError(e instanceof Error ? e.message : t('Something went wrong. Try again.'));
    } finally {
      setBusy(null);
    }
  };

  const what = row.recordName
    ? t('{type}: {name}', { type: tMaybe(row.recordTypeLabel ?? 'Record'), name: row.recordName })
    : row.recordCount && row.recordTypeLabel
      ? t('{count} {type}', { count: row.recordCount, type: tMaybe(row.recordTypeLabel).toLowerCase() })
      : (row.title ?? tMaybe(row.recordTypeLabel ?? 'Record'));
  const deletes = row.category === 'delete';

  return (
    <Card accent={row.status === 'PENDING' && row.canDecide}>
      <View style={styles.top}>
        <Text style={[styles.kind, { color: th.muted }]}>
          {tMaybe(TEAM_APPROVAL_CATEGORY_LABEL[row.category])} · {row.reference}
        </Text>
        <Text style={[styles.badge, { color: STATUS_COLOUR[row.status], borderColor: STATUS_COLOUR[row.status] }]}>{tMaybe(TEAM_APPROVAL_STATUS_LABEL[row.status])}</Text>
      </View>
      <Body style={{ fontWeight: '600' }}>{what}</Body>
      <Body muted>
        {t('Asked by')}: {row.requester.name} · {row.requesterWorkspace.name} · {when(row.createdAt)}
      </Body>
      <Body>{row.reason}</Body>
      {row.decidedBy ? (
        <Body muted>
          {t('Decided by')}: {row.decidedBy.name} · {when(row.decidedAt)}
        </Body>
      ) : row.status === 'PENDING' ? (
        <Body muted>
          {t('Waiting for')}: {row.assignedManagers.map((p) => p.name).join(', ') || row.approverWorkspace.name}
        </Body>
      ) : null}
      {row.decisionNote ? (
        <Body>
          {t('Manager’s comment')}: {row.decisionNote}
        </Body>
      ) : null}
      {row.status === 'APPROVED' && row.approvedUntil && row.canCarryOut ? (
        <Body muted>
          {t('Finish by')}: {when(row.approvedUntil)}
        </Body>
      ) : null}
      {row.recordChanged ? <ErrorNote message={t('This record changed after it was approved. Ask again so your manager sees it as it is now.')} /> : null}
      {error ? <ErrorNote message={error} /> : null}
      {done ? <Body style={{ color: th.primaryText, fontWeight: '600' }}>{done}</Body> : null}

      {row.canDecide && row.status === 'PENDING' ? (
        step === 'reject' ? (
          <>
            <Field label={t('Comment (optional)')} value={note} onChangeText={setNote} multiline maxLength={1000} />
            <Button kind="danger" label={t('Reject')} busy={busy === 'reject'} onPress={() => void act('reject', () => c.api.post(`/team-approvals/${row.id}/decision`, { decision: 'reject', note: note.trim() || undefined }))} />
            <Button kind="secondary" label={t('Back')} onPress={() => setStep(null)} />
          </>
        ) : (
          <>
            <Field label={t('Comment (optional)')} value={note} onChangeText={setNote} multiline maxLength={1000} />
            <Button label={t('Approve')} busy={busy === 'approve'} onPress={() => void act('approve', () => c.api.post(`/team-approvals/${row.id}/decision`, { decision: 'approve', note: note.trim() || undefined }))} />
            <Button kind="danger" label={t('Reject')} onPress={() => setStep('reject')} />
          </>
        )
      ) : null}

      {row.canCarryOut && row.action && !row.recordChanged ? (
        step === 'finish' && deletes ? (
          <>
            <Field label={t('Your password')} hint={t('Deleting needs your password.')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" textContentType="password" />
            <Button
              kind="danger"
              label={t('Yes, delete')}
              busy={busy === 'finish'}
              disabled={!password}
              onPress={() => void act('finish', () => c.api.carryOut(row.action!, row.id, password), t('Deleted. You can restore it from Deleted items.'))}
            />
            <Button kind="secondary" label={t('Back')} onPress={() => setStep(null)} />
          </>
        ) : (
          <Button
            kind={deletes ? 'danger' : 'primary'}
            label={deletes ? t('Delete now') : t('Make the change now')}
            busy={busy === 'finish'}
            onPress={() => (deletes ? setStep('finish') : void act('finish', () => c.api.carryOut(row.action!, row.id)))}
          />
        )
      ) : null}
      {row.canCancel ? <Button kind="secondary" label={t('Cancel request')} busy={busy === 'cancel'} onPress={() => void act('cancel', () => c.api.post(`/team-approvals/${row.id}/cancel`))} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  kind: { fontSize: 13, flexShrink: 1 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
