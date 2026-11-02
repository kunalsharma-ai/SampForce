'use client';

import { Button, Card, CardContent, Input, Skeleton } from '@dealflow/ui';
import type { PublicFormView } from '@dealflow/types';
import { useEffect, useState } from 'react';
import { Textarea } from '@/components/crm/select';
import { useT } from '@/lib/i18n';

type State = { kind: 'loading' } | { kind: 'missing' } | { kind: 'ready'; form: PublicFormView } | { kind: 'done'; message: string };

/** The hosted lead form. It talks only to the public form endpoints and works inside an iframe. */
export function PublicForm({ token }: { token: string }) {
  const t = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/public/forms/${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setState({ kind: 'ready', form: (await r.json()) as PublicFormView }) : setState({ kind: 'missing' })))
      .catch(() => setState({ kind: 'missing' }));
  }, [token]);

  if (state.kind === 'loading') return <Skeleton className="h-96 w-full" />;
  if (state.kind === 'missing')
    return (
      <Card className="w-full">
        <CardContent className="p-6 text-sm">{t('This form is not available.')}</CardContent>
      </Card>
    );
  if (state.kind === 'done')
    return (
      <Card className="w-full">
        <CardContent className="p-6" role="status">
          <p className="text-base font-medium">{state.message}</p>
        </CardContent>
      </Card>
    );

  const { form } = state;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setError('');
    setErrors({});
    try {
      const r = await fetch(`/api/v1/public/forms/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, consent, website }),
      });
      const body = (await r.json().catch(() => null)) as { message?: string; error?: { message: string; details?: { path: string; message: string }[] } } | null;
      if (r.ok) return setState({ kind: 'done', message: body?.message ?? t('Thank you.') });
      if (body?.error?.details?.length) setErrors(Object.fromEntries(body.error.details.map((d) => [d.path, t.maybe(d.message)])));
      setError(body?.error?.message ? t.maybe(body.error.message) : t('Something went wrong. Please try again.'));
    } catch {
      setError(t('Something went wrong. Please try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="w-full">
      <CardContent className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">{form.title}</h1>
        {form.intro && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{form.intro}</p>}
        <form className="space-y-4" onSubmit={submit} noValidate>
          {form.fields.map((f) => {
            const id = `ff-${f.key}`;
            const err = errors[f.key];
            const common = {
              id,
              name: f.key,
              required: f.required,
              'aria-invalid': !!err || undefined,
              'aria-describedby': err ? `${id}-err` : undefined,
              value: values[f.key] ?? '',
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [f.key]: e.target.value })),
            };
            return (
              <div key={f.key} className="space-y-1">
                <label htmlFor={id} className="text-sm font-medium">
                  {t.maybe(f.label)}
                  {f.required ? ' *' : ` ${t('(optional)')}`}
                </label>
                {f.key === 'message' ? (
                  <Textarea {...common} maxLength={2000} />
                ) : (
                  <Input
                    {...common}
                    type={f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : 'text'}
                    autoComplete={{ fullName: 'name', email: 'email', phone: 'tel', companyName: 'organization', jobTitle: 'organization-title', country: 'country' }[f.key]}
                    maxLength={f.key === 'country' ? 2 : 200}
                    placeholder={f.key === 'country' ? t('Two-letter code, e.g. DE') : undefined}
                  />
                )}
                {err && (
                  <p id={`${id}-err`} className="text-xs text-critical">
                    {err}
                  </p>
                )}
              </div>
            );
          })}
          {/* Honeypot for bots: hidden from people and assistive technology. */}
          <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="ff-website">{t('Website')}</label>
            <input id="ff-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          {form.consentText && (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{form.consentText}</span>
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={sending}>
            {sending ? t('Sending…') : t('Submit')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
