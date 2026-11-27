'use client';

import { DIALER_PLACEHOLDERS, DIALER_PRESETS, type DialerInput, dialerInputSchema, type DialerKind, type DialerRow } from '@dealflow/types';
import { Badge, Button, cn, Dialog, DialogContent, DialogDescription, DialogTitle, Field, Input } from '@dealflow/ui';
import { Check, Copy, KeyRound, Pencil, Phone, Plus, Trash2, Webhook } from 'lucide-react';
import * as React from 'react';
import { useDialerMutations, useDialers } from '@/lib/calls';
import { useT } from '@/lib/i18n';

/** "My dialer": the person's own dialers, the default one, and adding another (ADR 0088). */
export function MyDialers({ dialerId, onChoose }: { dialerId: string | null; onChoose: (id: string | null) => void }) {
  const t = useT();
  const settings = useDialers();
  const m = useDialerMutations();
  const [editing, setEditing] = React.useState<DialerRow | 'new' | null>(null);
  const [secret, setSecret] = React.useState<{ name: string; value: string } | null>(null);
  const dialers = settings.data?.dialers ?? [];
  const current = dialerId ?? dialers.find((d) => d.isDefault)?.id ?? null;
  return (
    <section aria-labelledby="my-dialers" className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id="my-dialers" className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex size-7 items-center justify-center rounded-full bg-violet-500 text-white"><Phone aria-hidden className="size-3.5" /></span>
          {t('My dialer')}
        </h2>
        <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
          <Plus aria-hidden /> {t('Add my dialer')}
        </Button>
      </div>
      <div role="radiogroup" aria-label={t('Dialer for the next call')} className="space-y-1.5">
        <DialerOption checked={!current} onSelect={() => onChoose(null)} name={t('Phone app')} detail={t('This device’s phone app or softphone (tel: link)')} />
        {dialers.map((d) => (
          <DialerOption
            key={d.id}
            checked={current === d.id}
            onSelect={() => onChoose(d.id)}
            name={d.name}
            detail={d.kind === 'TWILIO' ? t('Twilio rings {phone} first', { phone: d.agentPhone ?? '' }) : (d.urlTemplate ?? '')}
            badges={
              <>
                {d.isDefault && <Badge tone="primary">{t('Default')}</Badge>}
                {d.webhookUrl && (
                  <Badge tone="accent">
                    <Webhook aria-hidden className="size-3" /> {t('Webhook')}
                  </Badge>
                )}
              </>
            }
            actions={
              <>
                <Button size="icon" variant="ghost" className="size-8" aria-label={t('Edit {name}', { name: d.name })} onClick={() => setEditing(d)}>
                  <Pencil aria-hidden className="size-3.5" />
                </Button>
                <Button size="icon" variant="ghost" className="size-8 text-critical" aria-label={t('Remove {name}', { name: d.name })} onClick={() => window.confirm(t('Remove the dialer “{name}”? Calls placed with it stay in the history.', { name: d.name })) && m.remove.mutate(d.id)}>
                  <Trash2 aria-hidden className="size-3.5" />
                </Button>
              </>
            }
          />
        ))}
      </div>
      {secret && <SecretNotice secret={secret} onClose={() => setSecret(null)} />}
      <DialerDialog
        open={!!editing}
        editing={editing === 'new' ? null : editing}
        twilio={settings.data?.twilio ?? { connected: false, fromNumber: null }}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={(d) => {
          setEditing(null);
          if (d.webhookSecret) setSecret({ name: d.name, value: d.webhookSecret });
          onChoose(d.id);
        }}
      />
    </section>
  );
}

function DialerOption({ checked, onSelect, name, detail, badges, actions }: { checked: boolean; onSelect: () => void; name: string; detail: string; badges?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn('flex items-center gap-2 rounded-xl border p-2 transition', checked ? 'border-violet-500 bg-violet-500/5 ring-1 ring-violet-500/40' : 'border-border hover:border-violet-400/60')}>
      <button type="button" role="radio" aria-checked={checked} onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-start">
        <span aria-hidden className={cn('flex size-4 shrink-0 items-center justify-center rounded-full border-2', checked ? 'border-violet-500 bg-violet-500 text-white' : 'border-muted-foreground/40')}>
          {checked && <Check className="size-2.5" />}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
            {name} {badges}
          </span>
          <span className="block truncate font-mono text-[0.7rem] text-muted-foreground" title={detail}>
            {detail}
          </span>
        </span>
      </button>
      {actions}
    </div>
  );
}

function SecretNotice({ secret, onClose }: { secret: { name: string; value: string }; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  return (
    <div role="status" className="mt-3 space-y-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs">
      <p className="flex items-center gap-1.5 font-semibold">
        <KeyRound aria-hidden className="size-3.5" /> {t('Webhook secret for {name}', { name: secret.name })}
      </p>
      <p>{t('Your dialer checks the X-SampForce-Signature header with this secret. It is shown only now.')}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1 font-mono">{secret.value}</code>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard?.writeText(secret.value);
            setCopied(true);
          }}
        >
          <Copy aria-hidden /> {copied ? t('Copied') : t('Copy')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t('Done')}
        </Button>
      </div>
    </div>
  );
}

type Draft = { name: string; kind: DialerKind; urlTemplate: string; webhookUrl: string; agentPhone: string; isDefault: boolean };

/** Adds or edits a dialer: a preset (phone app, callto:, sip:), a custom link with placeholders, or Twilio. */
export function DialerDialog({
  open,
  editing,
  twilio,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  editing: DialerRow | null;
  twilio: { connected: boolean; fromNumber: string | null };
  onOpenChange: (o: boolean) => void;
  onSaved: (d: DialerRow) => void;
}) {
  const t = useT();
  const m = useDialerMutations();
  const blank = (): Draft =>
    editing
      ? { name: editing.name, kind: editing.kind, urlTemplate: editing.urlTemplate ?? '', webhookUrl: editing.webhookUrl ?? '', agentPhone: editing.agentPhone ?? '', isDefault: editing.isDefault }
      : { name: DIALER_PRESETS[3].name, kind: 'LINK', urlTemplate: DIALER_PRESETS[3].urlTemplate, webhookUrl: '', agentPhone: '', isDefault: true };
  const [v, setV] = React.useState<Draft>(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (open) {
      setV(blank());
      setErrors({});
      setFormError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);
  const set = (p: Partial<Draft>) => setV((x) => ({ ...x, ...p }));
  const template = React.useRef<HTMLInputElement>(null);
  const insert = (key: string) => {
    const el = template.current;
    const at = el?.selectionStart ?? v.urlTemplate.length;
    set({ urlTemplate: `${v.urlTemplate.slice(0, at)}{${key}}${v.urlTemplate.slice(el?.selectionEnd ?? at)}` });
    requestAnimationFrame(() => el?.focus());
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = dialerInputSchema.safeParse({ name: v.name, kind: v.kind, urlTemplate: v.kind === 'LINK' ? v.urlTemplate : null, webhookUrl: v.webhookUrl || null, agentPhone: v.kind === 'TWILIO' ? v.agentPhone : null, isDefault: v.isDefault });
    if (!parsed.success) {
      const out: Record<string, string> = {};
      for (const i of parsed.error.issues) out[String(i.path[0])] ??= t.maybe(i.message);
      setErrors(out);
      return;
    }
    setErrors({});
    try {
      const input = parsed.data as DialerInput;
      const saved = editing ? await m.update.mutateAsync({ id: editing.id, input }) : await m.create.mutateAsync(input);
      onSaved(saved);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t('Could not save.'));
    }
  };
  const busy = m.create.isPending || m.update.isPending;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>{editing ? t('Edit dialer') : t('Add my dialer')}</DialogTitle>
        <DialogDescription>{t('Calls open in this dialer, with the company and employee details filled in.')}</DialogDescription>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {!editing && (
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('Start from')}>
              {DIALER_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => set({ kind: 'LINK', name: t.maybe(p.name), urlTemplate: p.urlTemplate })}
                  className={cn('rounded-xl border p-2 text-start text-xs transition hover:border-primary/60', v.kind === 'LINK' && v.urlTemplate === p.urlTemplate ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border')}
                >
                  <span className="block font-semibold">{t.maybe(p.name)}</span>
                  <span className="text-muted-foreground">{t.maybe(p.description)}</span>
                </button>
              ))}
              <button
                type="button"
                disabled={!twilio.connected}
                onClick={() => set({ kind: 'TWILIO', name: 'Twilio', urlTemplate: '' })}
                className={cn('col-span-2 rounded-xl border p-2 text-start text-xs transition enabled:hover:border-primary/60 disabled:opacity-60', v.kind === 'TWILIO' ? 'border-primary bg-primary/5 ring-1 ring-primary/40' : 'border-border')}
              >
                <span className="block font-semibold">{t('Twilio click-to-call')}</span>
                <span className="text-muted-foreground">
                  {twilio.connected ? t('Twilio rings your phone first, then connects the call from {number}.', { number: twilio.fromNumber ?? '' }) : t('Needs Twilio connected in Integrations by a workspace admin.')}
                </span>
              </button>
            </div>
          )}
          <Field id="dialer-name" label={t('Dialer name')} error={errors.name}>
            <Input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={80} />
          </Field>
          {v.kind === 'LINK' ? (
            <div className="space-y-2">
              <Field id="dialer-template" label={t('Link your dialer opens')} error={errors.urlTemplate} hint={t('tel:, callto:, sip:, your dialer app’s own link, or a web address.')}>
                <Input ref={template} value={v.urlTemplate} onChange={(e) => set({ urlTemplate: e.target.value })} className="font-mono text-xs" spellCheck={false} />
              </Field>
              <div className="flex flex-wrap gap-1" role="group" aria-label={t('Insert a call detail')}>
                {Object.entries(DIALER_PLACEHOLDERS).map(([key, label]) => (
                  <button key={key} type="button" title={t.maybe(label)} onClick={() => insert(key)} className="rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-[0.68rem] hover:border-primary hover:text-primary">
                    {`{${key}}`}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <Field id="dialer-agent" label={t('Your phone number')} error={errors.agentPhone} hint={t('Twilio rings this phone first. Answer it and Twilio dials the person you are calling.')}>
              <Input value={v.agentPhone} onChange={(e) => set({ agentPhone: e.target.value })} placeholder="+44 7700 900123" inputMode="tel" />
            </Field>
          )}
          <Field id="dialer-webhook" label={t('Webhook (optional)')} error={errors.webhookUrl} hint={t('Every call’s company and employee details are also posted here, signed, so your dialer can show them.')}>
            <Input value={v.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} placeholder="https://dialer.example.com/sampforce" inputMode="url" />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={v.isDefault} onChange={(e) => set({ isDefault: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" />
            {t('Use for my calls by default')}
          </label>
          {formError && (
            <p role="alert" className="text-sm text-critical">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? t('Saving…') : t('Save dialer')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
