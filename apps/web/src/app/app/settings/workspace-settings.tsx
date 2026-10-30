'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Skeleton } from '@dealflow/ui';
import { type TenantDetails } from '@dealflow/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/session';

const formSchema = z.object({
  name: z.string().trim().min(2, 'At least 2 characters').max(120),
  brandColor: z.union([z.literal(''), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #00D9FF')]),
  defaultCurrency: z.string().trim().length(3, 'Use a 3-letter ISO code such as USD'),
  defaultTimezone: z.string().trim().min(1),
  defaultLocale: z.string().trim().min(2),
});
type FormValues = z.infer<typeof formSchema>;

export function WorkspaceSettings() {
  const canManage = useCan('tenant:manage');
  const qc = useQueryClient();
  const [saved, setSaved] = useState(false);
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api<TenantDetails>('/tenants/current') });
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  useEffect(() => {
    if (tenant.data) {
      const t = tenant.data;
      form.reset({
        name: t.name,
        brandColor: t.brandColor ?? '',
        defaultCurrency: t.defaultCurrency,
        defaultTimezone: t.defaultTimezone,
        defaultLocale: t.defaultLocale,
      });
    }
  }, [tenant.data, form]);

  const save = useMutation({
    mutationFn: (v: FormValues) =>
      api<TenantDetails>('/tenants/current', {
        method: 'PATCH',
        json: { ...v, brandColor: v.brandColor === '' ? null : v.brandColor },
      }),
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries();
    },
    onError: (err) => {
      if (err instanceof ApiError) for (const d of err.details ?? []) form.setError(d.path as keyof FormValues, { message: d.message });
    },
  });
  const e = form.formState.errors;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace</CardTitle>
        <CardDescription>
          {canManage ? 'Changes are recorded in the audit log.' : 'Only owners and administrators can change these settings.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {tenant.isPending ? (
          <Skeleton className="h-48" />
        ) : (
          <form
            noValidate
            onSubmit={form.handleSubmit((v) => {
              setSaved(false);
              save.mutate(v);
            })}
            className="grid gap-4 sm:grid-cols-2"
          >
            <fieldset disabled={!canManage} className="contents">
              <div className="sm:col-span-2">
                <Field id="ws-name" label="Workspace name" error={e.name?.message}>
                  <Input {...form.register('name')} />
                </Field>
              </div>
              <Field id="ws-brand" label="Brand colour" error={e.brandColor?.message} hint="Optional. Replaces the accent colour for everyone.">
                <Input placeholder="#00D9FF" {...form.register('brandColor')} />
              </Field>
              <Field id="ws-currency" label="Default currency" error={e.defaultCurrency?.message}>
                <Input {...form.register('defaultCurrency')} />
              </Field>
              <Field id="ws-tz" label="Default time zone" error={e.defaultTimezone?.message} hint="IANA name, e.g. Asia/Kolkata">
                <Input {...form.register('defaultTimezone')} />
              </Field>
              <Field id="ws-locale" label="Default locale" error={e.defaultLocale?.message}>
                <Input {...form.register('defaultLocale')} />
              </Field>
            </fieldset>
            {canManage && (
              <div className="flex items-center gap-3 sm:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <p role="status" className="text-sm text-muted-foreground">
                  {saved ? 'Saved.' : save.error ? save.error.message : ''}
                </p>
              </div>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
