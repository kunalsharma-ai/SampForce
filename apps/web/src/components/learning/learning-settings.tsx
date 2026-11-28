'use client';

import { CERTIFICATE_TEMPLATE_LABEL, CERTIFICATE_TEMPLATES, type CertificateTemplate, type LearningSettingsView } from '@dealflow/types';
import { Button, Input, Label, Skeleton } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Plus, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { LEARNING_KEY, learningApi, useCategories, useLearningSettings } from '@/lib/learning';
import { ErrorLine } from './bits';
import { CertificateView } from './certificates';

/** Categories, certificate design and the defaults for new modules. */
export function LearningSettings() {
  const t = useT();
  const s = useLearningSettings();
  if (s.isLoading) return <Skeleton className="h-96 rounded-2xl" />;
  if (s.error || !s.data) return <ErrorLine error={s.error ?? new Error()} />;
  return (
    <div className="space-y-6">
      <Link href="/app/learning/manage" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> {t('Learning management')}</Link>
      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <SettingsForm v={s.data} />
        <Categories />
      </div>
    </div>
  );
}

function SettingsForm({ v }: { v: LearningSettingsView }) {
  const t = useT();
  const qc = useQueryClient();
  const [f, setF] = useState({ ...v, signatoryName: v.signatoryName ?? '', signatoryTitle: v.signatoryTitle ?? '', reminders: v.reminderDaysBefore.join(', '), overdue: v.overdueEveryDays ? String(v.overdueEveryDays) : '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const set = <K extends keyof typeof f>(k: K, x: (typeof f)[K]) => {
    setSaved(false);
    setF((s) => ({ ...s, [k]: x }));
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const out = await learningApi.saveSettings({
        issuerName: f.issuerName.trim(),
        signatoryName: f.signatoryName.trim(),
        signatoryTitle: f.signatoryTitle.trim(),
        template: f.template,
        accentColor: f.accentColor,
        defaultPassingScore: Number(f.defaultPassingScore),
        defaultMaxAttempts: Number(f.defaultMaxAttempts),
        reminderDaysBefore: f.reminders.split(/[,\s]+/).map(Number).filter((n) => n >= 1 && n <= 60).slice(0, 5),
        remindOnDueDay: f.remindOnDueDay,
        overdueEveryDays: f.overdue ? Number(f.overdue) : null,
        managersCreate: f.managersCreate,
      });
      qc.setQueryData([...LEARNING_KEY, 'settings'], out);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const sample = {
    id: 'preview',
    number: 'CERT-2026-00001',
    code: 'ABCD-EFGH-JKLM',
    recipientName: t('Alex Morgan'),
    userId: '',
    moduleId: '',
    moduleTitle: t('Sales communication essentials'),
    category: null,
    score: 92,
    completedAt: new Date().toISOString(),
    issuedAt: new Date().toISOString(),
    issuerName: f.issuerName || v.issuerName,
    signatoryName: f.signatoryName || null,
    signatoryTitle: f.signatoryTitle || null,
    template: f.template,
    accentColor: f.accentColor,
    revoked: false,
  };
  return (
    <form onSubmit={save} className="space-y-6" data-learning-settings>
      <section className="lrn-tile space-y-4">
        <h3 className="font-semibold">{t('Certificate design')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="s-issuer">{t('Issued by')}</Label><Input id="s-issuer" value={f.issuerName} onChange={(e) => set('issuerName', e.target.value)} required minLength={2} maxLength={120} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-tpl">{t('Design')}</Label>
            <select id="s-tpl" value={f.template} onChange={(e) => set('template', e.target.value as CertificateTemplate)} className="h-10 w-full rounded-md border bg-surface px-2 text-sm">
              {CERTIFICATE_TEMPLATES.map((x) => <option key={x} value={x}>{t.maybe(CERTIFICATE_TEMPLATE_LABEL[x])}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="s-sig">{t('Signed by')}</Label><Input id="s-sig" value={f.signatoryName} onChange={(e) => set('signatoryName', e.target.value)} maxLength={120} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-sigt">{t('Their title')}</Label><Input id="s-sigt" value={f.signatoryTitle} onChange={(e) => set('signatoryTitle', e.target.value)} maxLength={120} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-color">{t('Accent colour')}</Label>
            <div className="flex gap-2"><input id="s-color" type="color" value={f.accentColor} onChange={(e) => set('accentColor', e.target.value)} className="h-10 w-14 rounded-md border" /><Input value={f.accentColor} onChange={(e) => set('accentColor', e.target.value)} aria-label={t('Accent colour')} pattern="^#[0-9a-fA-F]{6}$" /></div>
          </div>
        </div>
        <CertificateView c={sample} />
        <p className="text-xs text-muted-foreground">{t('The PDF adds your company logo from the quote settings and a QR code that opens the verification page.')}</p>
      </section>
      <section className="lrn-tile space-y-4">
        <h3 className="font-semibold">{t('Defaults for new modules')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="s-pass">{t('Pass mark (%)')}</Label><Input id="s-pass" type="number" min={1} max={100} value={f.defaultPassingScore} onChange={(e) => set('defaultPassingScore', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-att">{t('Attempts allowed')}</Label><Input id="s-att" type="number" min={1} max={20} value={f.defaultMaxAttempts} onChange={(e) => set('defaultMaxAttempts', Number(e.target.value))} /></div>
          <div className="space-y-1.5"><Label htmlFor="s-rem">{t('Reminders, days before the deadline')}</Label><Input id="s-rem" value={f.reminders} onChange={(e) => set('reminders', e.target.value)} placeholder="3, 1" /></div>
          <div className="space-y-1.5"><Label htmlFor="s-over">{t('After the deadline, remind every (days)')}</Label><Input id="s-over" type="number" min={1} max={30} value={f.overdue} onChange={(e) => set('overdue', e.target.value)} placeholder={t('Never')} /></div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.remindOnDueDay} onChange={(e) => set('remindOnDueDay', e.target.checked)} className="size-4" />{t('Remind on the day it is due')}</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={f.managersCreate} onChange={(e) => set('managersCreate', e.target.checked)} className="mt-0.5 size-4" /><span>{t('Managers may create their own modules')}<span className="block text-xs text-muted-foreground">{t('When off, managers assign the Super Workspace’s modules only.')}</span></span></label>
      </section>
      <ErrorLine error={error} />
      <div className="flex items-center justify-end gap-3">
        {saved && <span className="inline-flex items-center gap-1 text-sm text-success" role="status"><Check className="size-4" aria-hidden />{t('Saved')}</span>}
        <Button type="submit" disabled={busy}><Save className="size-4" aria-hidden />{t('Save settings')}</Button>
      </div>
    </form>
  );
}

function Categories() {
  const t = useT();
  const qc = useQueryClient();
  const q = useCategories();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#7c3aed');
  const [error, setError] = useState<unknown>(null);
  const put = (rows: unknown) => qc.setQueryData([...LEARNING_KEY, 'categories'], rows);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      put(await fn());
    } catch (e) {
      setError(e);
    }
  };
  return (
    <section className="lrn-tile h-fit space-y-4" data-learning-categories>
      <h3 className="font-semibold">{t('Categories')}</h3>
      <ul className="space-y-2">
        {q.data?.map((c) => (
          <li key={c.id} className="flex items-center gap-2">
            <input type="color" defaultValue={c.color} aria-label={t('Colour of {name}', { name: c.name })} onBlur={(e) => e.target.value !== c.color && run(() => learningApi.updateCategory(c.id, { name: c.name, color: e.target.value }))} className="h-8 w-9 rounded border" />
            <Input defaultValue={c.name} aria-label={t('Name')} onBlur={(e) => e.target.value.trim() !== c.name && e.target.value.trim().length >= 2 && run(() => learningApi.updateCategory(c.id, { name: e.target.value.trim(), color: c.color }))} className="h-8" />
            <span className="w-8 text-end text-xs text-muted-foreground" title={t('Modules')}>{c.modules}</span>
            <Button size="icon" variant="ghost" onClick={() => run(() => learningApi.removeCategory(c.id))} aria-label={t('Remove {name}', { name: c.name })}><Trash2 className="size-4" aria-hidden /></Button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => learningApi.addCategory({ name: name.trim(), color })).then(() => setName(''));
        }}
      >
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} aria-label={t('Colour')} className="h-9 w-10 rounded border" />
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('New category')} aria-label={t('New category')} minLength={2} maxLength={60} />
        <Button type="submit" size="icon" disabled={name.trim().length < 2} aria-label={t('Add category')}><Plus className="size-4" aria-hidden /></Button>
      </form>
      <ErrorLine error={error} />
    </section>
  );
}
