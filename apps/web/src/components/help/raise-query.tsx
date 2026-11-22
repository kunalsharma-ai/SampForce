'use client';

import { faqsFor, guidesFor, type HelpCategory, type HelpReader, helpText, searchHelp } from '@dealflow/help';
import { FEATURE_BY_KEY, SUPPORT_BODY_MAX, SUPPORT_SUBJECT_MAX, type SupportAttachmentRow, type SupportContactMethod, type SupportTicketDetail, type SupportTicketPriority } from '@dealflow/types';
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Input, Label } from '@dealflow/ui';
import { CheckCircle2, LifeBuoy, Lightbulb, Link2, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Select, Textarea } from '@/components/crm/select';
import { Segmented } from '@/components/forms/segmented';
import { useT } from '@/lib/i18n';
import { useRaiseQuery } from '@/lib/support';
import { usePriorityLabel } from './help-ui';
import { AttachmentPicker, recordFromPath, useRecordTypeLabel } from './support-files';

const APP_VERSION = `web ${process.env.NEXT_PUBLIC_APP_VERSION ?? ''}`.trim();

/**
 * "Other: raise a query": a short form that files a support ticket (ADR 0073). While the person types, the answers
 * that match their words appear above the form, so a question the Help Center already answers is solved at once.
 */
export function RaiseQueryDialog({
  open,
  onOpenChange,
  reader,
  categories,
  initialQuery,
  fromPath,
  queriesHref,
  defaultCategory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reader: HelpReader;
  categories: readonly HelpCategory[];
  initialQuery?: string;
  fromPath?: string | null;
  queriesHref: string;
  defaultCategory?: string | null;
}) {
  const t = useT();
  const priority = usePriorityLabel();
  const raise = useRaiseQuery();
  const [category, setCategory] = useState(defaultCategory ?? 'other');
  const [feature, setFeature] = useState('');
  const [level, setLevel] = useState<SupportTicketPriority>('NORMAL');
  const [subject, setSubject] = useState(initialQuery?.trim().slice(0, SUPPORT_SUBJECT_MAX) ?? '');
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<SupportTicketDetail | null>(null);
  const [touched, setTouched] = useState(false);
  const [categoryOther, setCategoryOther] = useState('');
  const [files, setFiles] = useState<SupportAttachmentRow[]>([]);
  const [contact, setContact] = useState<SupportContactMethod>('IN_APP');
  const [phone, setPhone] = useState('');
  const record = useMemo(() => recordFromPath(fromPath), [fromPath]);
  const [linkRecord, setLinkRecord] = useState(true);
  const recordLabel = useRecordTypeLabel();

  const content = useMemo(() => ({ faqs: faqsFor(reader), guides: guidesFor(reader) }), [reader]);
  const suggestions = useMemo(
    () => (subject.trim().length >= 3 ? searchHelp(subject, t.language, { faqs: content.faqs, guides: [] }, undefined, { partial: true }).slice(0, 3) : []),
    [subject, content, t.language],
  );
  const features = (reader.features ?? []).map((k) => FEATURE_BY_KEY[k]).filter(Boolean).sort((a, b) => t.maybe(a.label).localeCompare(t.maybe(b.label), t.language));
  const subjectOk = subject.trim().length >= 3;
  const bodyOk = body.trim().length >= 5;
  const phoneOk = contact !== 'PHONE' || /^[+\d][\d\s\-().]{5,}$/.test(phone.trim());

  const reset = () => {
    setSent(null);
    setSubject('');
    setBody('');
    setFeature('');
    setLevel('NORMAL');
    setCategoryOther('');
    setFiles([]);
    setContact('IN_APP');
    setPhone('');
    setTouched(false);
    raise.reset();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!subjectOk || !bodyOk || !phoneOk) return;
    const ticket = await raise.mutateAsync({
      subject: subject.trim(),
      body: body.trim(),
      category,
      categoryOther: category === 'other' ? categoryOther.trim() || null : null,
      relatedRecord: record && linkRecord ? record : null,
      contactMethod: contact,
      contactPhone: contact === 'PHONE' ? phone.trim() : null,
      appVersion: APP_VERSION,
      attachmentIds: files.map((f) => f.id),
      featureKey: feature ? (feature as (typeof features)[number]['key']) : null,
      priority: level,
      pagePath: fromPath && /^\/[\w\-/.[\]]*$/.test(fromPath) ? fromPath : null,
    });
    setSent(ticket);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o && sent) reset();
      }}
    >
      <DialogContent className="top-[6%] max-h-[88vh] max-w-2xl overflow-y-auto p-0" data-raise-query-dialog>
        <div className="border-b border-border bg-gradient-to-br from-accent/15 via-primary/10 to-transparent px-6 pb-5 pt-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground" aria-hidden>
              <LifeBuoy className="size-5" />
            </span>
            <div>
              <DialogTitle className="text-lg font-semibold">{t('Raise a query')}</DialogTitle>
              <DialogDescription className="text-sm text-muted-foreground">{t('The SampForce support team answers in My queries and sends you a notification.')}</DialogDescription>
            </div>
          </div>
        </div>

        {sent ? (
          <div className="space-y-4 px-6 py-8 text-center" data-query-sent={sent.number}>
            <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
            <p className="text-lg font-semibold">{t('Query #{number} sent', { number: sent.number })}</p>
            <p className="text-sm text-muted-foreground">{t('We will notify you as soon as support replies. You can add details at any time.')}</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href={`${queriesHref}?ticket=${sent.id}`}>{t('Open my query')}</Link>
              </Button>
              <Button variant="outline" onClick={reset}>
                {t('Raise another query')}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-6 py-5" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="query-subject">{t('What do you need help with?')}</Label>
              <Input
                id="query-subject"
                value={subject}
                maxLength={SUPPORT_SUBJECT_MAX}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t('For example: how do I share a proposal?')}
                aria-invalid={touched && !subjectOk}
                aria-describedby={touched && !subjectOk ? 'query-subject-error' : undefined}
              />
              {touched && !subjectOk && (
                <p id="query-subject-error" className="text-xs text-critical">
                  {t('Write at least 3 characters.')}
                </p>
              )}
            </div>

            {suggestions.length > 0 && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3" data-query-suggestions>
                <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
                  <Lightbulb className="size-4" aria-hidden /> {t('These answers may help')}
                </p>
                <ul className="mt-2 space-y-2">
                  {suggestions.map((h) =>
                    h.kind === 'faq' ? (
                      <li key={h.faq.id}>
                        <details>
                          <summary className="cursor-pointer text-sm font-medium">{helpText(h.faq.q, t.language)}</summary>
                          <p className="mt-1 text-sm text-muted-foreground">{helpText(h.faq.a, t.language)}</p>
                        </details>
                      </li>
                    ) : null,
                  )}
                </ul>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="query-topic">{t('Topic')}</Label>
                <Select id="query-topic" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {helpText(c.title, t.language)}
                    </option>
                  ))}
                  <option value="other">{t('Other')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="query-feature">{t('Feature (optional)')}</Label>
                <Select id="query-feature" value={feature} onChange={(e) => setFeature(e.target.value)}>
                  <option value="">{t('Not about one feature')}</option>
                  {features.map((f) => (
                    <option key={f.key} value={f.key}>
                      {t.maybe(f.label)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {category === 'other' && (
              <div className="space-y-1.5">
                <Label htmlFor="query-category-other">{t('What kind of problem is it? (optional)')}</Label>
                <Input id="query-category-other" value={categoryOther} maxLength={80} onChange={(e) => setCategoryOther(e.target.value)} placeholder={t('For example: printing, a client’s data, training')} />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="query-body">{t('Details')}</Label>
              <Textarea
                id="query-body"
                value={body}
                rows={5}
                maxLength={SUPPORT_BODY_MAX}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('What were you trying to do, what happened, and what did you expect?')}
                aria-invalid={touched && !bodyOk}
                aria-describedby={touched && !bodyOk ? 'query-body-error' : undefined}
              />
              {touched && !bodyOk && (
                <p id="query-body-error" className="text-xs text-critical">
                  {t('Write at least 5 characters.')}
                </p>
              )}
            </div>

            <Segmented
              legend={t('How urgent is it?')}
              name="query-priority"
              value={level}
              onChange={setLevel}
              options={(['LOW', 'NORMAL', 'HIGH'] as const).map((p) => ({ value: p, label: priority(p) }))}
            />

            <div className="space-y-1.5">
              <Label htmlFor="query-files">{t('Screenshots or files (optional)')}</Label>
              <AttachmentPicker files={files} onChange={setFiles} id="query-files" />
            </div>

            <Segmented
              legend={t('How should we reach you?')}
              name="query-contact"
              value={contact}
              onChange={setContact}
              options={[
                { value: 'IN_APP', label: t('In the app') },
                { value: 'EMAIL', label: t('Email') },
                { value: 'PHONE', label: t('Phone') },
              ]}
            />
            {contact === 'PHONE' && (
              <div className="space-y-1.5">
                <Label htmlFor="query-phone">{t('Phone number')}</Label>
                <Input
                  id="query-phone"
                  type="tel"
                  value={phone}
                  maxLength={40}
                  onChange={(e) => setPhone(e.target.value)}
                  aria-invalid={touched && !phoneOk}
                  aria-describedby={touched && !phoneOk ? 'query-phone-error' : undefined}
                />
                {touched && !phoneOk && (
                  <p id="query-phone-error" className="text-xs text-critical">
                    {t('Give a phone number to be called on.')}
                  </p>
                )}
              </div>
            )}

            {record && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-query-record={record.type}>
                <span className="flex items-center gap-2">
                  <Link2 className="size-4 text-primary" aria-hidden />
                  {linkRecord ? t('About the {record} you came from', { record: recordLabel(record.type).toLowerCase() }) : t('Not linked to a record')}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setLinkRecord(!linkRecord)}>
                  {linkRecord ? <X aria-hidden /> : null} {linkRecord ? t('Unlink') : t('Link it again')}
                </Button>
              </div>
            )}
            <p className="flex items-start gap-2 text-xs text-muted-foreground" data-query-context>
              <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {t('Sent for you: your workspace, role, email and app version.')} {fromPath && t('Sent with the page you came from: {path}', { path: fromPath })}
              </span>
            </p>
            {raise.error && (
              <p role="alert" className="text-sm text-critical">
                {raise.error.message}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('Not now')}
              </Button>
              <Button type="submit" disabled={raise.isPending} data-send-query>
                {raise.isPending ? t('Sending…') : t('Send query')}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
