'use client';

import { Button, Card, Dialog, DialogContent, DialogDescription, DialogTitle, Input } from '@dealflow/ui';
import { type ConsoleClientDetail, type ConsoleClientProfileInput, geoCountry } from '@dealflow/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ImageUp, Pencil, Trash2 } from 'lucide-react';
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { CountryFlag } from '@/components/crm/status-chip';
import { ErrorText, Field } from '@/components/revenue/tabs';
import { api, ApiError } from '@/lib/api';
import { ClientAvatar } from './client-avatar';
import { LocationPicker, type LocationValue, useConsoleRegions } from './location-picker';

const KEY = (id: string) => ['operator', 'client', id];

/** "Pune, Maharashtra, India" from the parts the client has. */
export function placeLine(countryCode: string | null, regionName: string | null | undefined, city: string | null): string | null {
  const parts = [city, regionName, countryCode ? (geoCountry(countryCode)?.name ?? countryCode) : null].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm">{children ?? <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

/** The client's company details on its page, with Edit for operators who may change them (ADR 0074, C4). */
export function CompanyCard({ client, canEdit }: { client: ConsoleClientDetail; canEdit: boolean }) {
  const p = client.profile;
  const regions = useConsoleRegions(p.countryCode);
  const region = regions.data?.find((r) => r.code === p.regionCode)?.name;
  const [open, setOpen] = useState(false);
  const address = [p.addressLine1, p.addressLine2, p.postalCode].filter(Boolean).join(', ');
  return (
    <Card className="p-5" aria-labelledby="company-h" data-client-company>
      <div className="flex items-center justify-between gap-2">
        <h2 id="company-h" className="font-medium">
          Company information
        </h2>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            <Pencil className="size-4" aria-hidden /> Edit details
          </Button>
        )}
      </div>
      <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Row label="Customer ID">{client.customerId && <span className="font-mono tabular">{client.customerId}</span>}</Row>
        <Row label="Legal name">{p.legalName}</Row>
        <Row label="Industry">{p.industry}</Row>
        <Row label="Website">
          {p.website && (
            <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
              {p.website.replace(/^https?:\/\//, '')}
            </a>
          )}
        </Row>
        <Row label="Location">
          {p.countryCode && (
            <span className="inline-flex items-center gap-1.5">
              <CountryFlag code={p.countryCode} />
              {placeLine(p.countryCode, region, p.city)}
            </span>
          )}
        </Row>
        <Row label="Address">{address || null}</Row>
        <Row label="Primary contact">{p.contactName}</Row>
        <Row label="Contact email">
          {p.contactEmail && (
            <a href={`mailto:${p.contactEmail}`} className="text-primary underline-offset-2 hover:underline">
              {p.contactEmail}
            </a>
          )}
        </Row>
        <Row label="Contact phone">{p.contactPhone}</Row>
      </dl>
      {open && <ProfileDialog client={client} onClose={() => setOpen(false)} />}
    </Card>
  );
}

type Form = { [K in keyof ConsoleClientProfileInput]: string };

function ProfileDialog({ client, onClose }: { client: ConsoleClientDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const p = client.profile;
  const [f, setF] = useState<Form>({
    name: client.name,
    legalName: p.legalName ?? '',
    website: p.website ?? '',
    industry: p.industry ?? '',
    countryCode: p.countryCode ?? '',
    regionCode: p.regionCode ?? '',
    city: p.city ?? '',
    addressLine1: p.addressLine1 ?? '',
    addressLine2: p.addressLine2 ?? '',
    postalCode: p.postalCode ?? '',
    contactName: p.contactName ?? '',
    contactEmail: p.contactEmail ?? '',
    contactPhone: p.contactPhone ?? '',
  });
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => api<ConsoleClientDetail>(`/operator/clients/${client.id}/profile`, { method: 'PATCH', json: f }),
    onSuccess: (d) => {
      qc.setQueryData(KEY(client.id), d);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      onClose();
    },
  });
  const details = save.error instanceof ApiError ? (save.error.details ?? []) : [];
  const err = (k: string) => details.find((d) => d.path === k || d.path.split('.')[0] === k)?.message;
  const text = (k: keyof Form, label: string, type = 'text', autoComplete = 'off') => (
    <Field id={`profile-${k}`} label={label} error={err(k)}>
      <Input id={`profile-${k}`} type={type} autoComplete={autoComplete} value={f[k]} onChange={set(k)} aria-invalid={!!err(k)} />
    </Field>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto p-6">
        <DialogTitle className="text-lg font-semibold">Company information</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">How SampForce knows this client. Every change is kept in the audit log with its old value.</DialogDescription>
        <form
          className="mt-2 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium text-muted-foreground">Company</legend>
            {text('name', 'Display name')}
            {text('legalName', 'Legal name')}
            {text('website', 'Website', 'text', 'url')}
            {text('industry', 'Industry')}
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-muted-foreground">Location</legend>
            <LocationPicker
              idPrefix="profile"
              value={{ countryCode: f.countryCode, regionCode: f.regionCode, city: f.city }}
              onChange={(v: LocationValue) => setF((cur) => ({ ...cur, ...v }))}
            />
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {text('addressLine1', 'Address line 1')}
              {text('addressLine2', 'Address line 2')}
              {text('postalCode', 'Postal code')}
            </div>
          </fieldset>
          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium text-muted-foreground">Primary contact</legend>
            {text('contactName', 'Contact name', 'text', 'off')}
            {text('contactEmail', 'Contact email', 'email', 'off')}
            {text('contactPhone', 'Contact phone', 'tel', 'off')}
          </fieldset>
          <ErrorText error={save.error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const OUT = 512;

/**
 * The client's logo beside its name; operators who may edit open a cropper: pick a PNG, JPEG, WebP or SVG, zoom and
 * position it in the square, and the browser sends a 512 px PNG (an SVG is drawn to pixels first, so none reaches us).
 */
export function ClientLogo({ client, canEdit }: { client: ConsoleClientDetail; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {canEdit ? (
        <button type="button" onClick={() => setOpen(true)} className="group relative rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={client.logoUrl ? 'Change the logo' : 'Add a logo'}>
          <ClientAvatar name={client.name} logoUrl={client.logoUrl} size="lg" />
          <span className="absolute -bottom-1 -end-1 grid size-6 place-items-center rounded-full border border-border bg-surface text-muted-foreground shadow-sm group-hover:text-foreground">
            <ImageUp className="size-3.5" aria-hidden />
          </span>
        </button>
      ) : (
        <ClientAvatar name={client.name} logoUrl={client.logoUrl} size="lg" />
      )}
      {open && <LogoDialog client={client} onClose={() => setOpen(false)} />}
    </>
  );
}

function LogoDialog({ client, onClose }: { client: ConsoleClientDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  // Draw the crop: the image covers the square at zoom 1, and the sliders move it within what overflows.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    const ctx = c.getContext('2d')!;
    const scale = Math.max(OUT / img.naturalWidth, OUT / img.naturalHeight) * zoom;
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.clearRect(0, 0, OUT, OUT);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, OUT, OUT);
    ctx.drawImage(img, ((OUT - w) * x) / 100, ((OUT - h) * y) / 100, w, h);
  }, [img, zoom, x, y]);

  const pick = (file: File | undefined) => {
    setFileError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return setFileError('Choose a PNG, JPEG, WebP or SVG image.');
    if (file.size > 5_000_000) return setFileError('Choose an image under 5 MB.');
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => {
      // An SVG without a size draws at 0 × 0; give it one.
      if (!el.naturalWidth) {
        el.width = OUT;
        el.height = OUT;
      }
      setImg(el);
      setZoom(1);
      setX(50);
      setY(50);
    };
    el.onerror = () => setFileError('That image could not be read.');
    el.src = url;
  };

  const save = useMutation({
    mutationFn: async () => {
      const blob = await new Promise<Blob>((ok, fail) => canvas.current!.toBlob((b) => (b ? ok(b) : fail(new Error('The image could not be prepared.'))), 'image/png'));
      return api<ConsoleClientDetail>(`/operator/clients/${client.id}/logo`, { method: 'PUT', body: blob, headers: { 'content-type': 'image/png' } });
    },
    onSuccess: (d) => {
      qc.setQueryData(KEY(client.id), d);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api<ConsoleClientDetail>(`/operator/clients/${client.id}/logo`, { method: 'DELETE' }),
    onSuccess: (d) => {
      qc.setQueryData(KEY(client.id), d);
      void qc.invalidateQueries({ queryKey: ['operator', 'clients'] });
      onClose();
    },
  });
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x, y };
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const size = e.currentTarget.getBoundingClientRect().width || 1;
    // Dragging right shows more of the left side.
    setX(Math.min(100, Math.max(0, d.x - ((e.clientX - d.px) / size) * 100)));
    setY(Math.min(100, Math.max(0, d.y - ((e.clientY - d.py) / size) * 100)));
  };
  const slider = (label: string, value: number, set: (v: number) => void, min: number, max: number, step: number) => (
    <label className="block text-sm">
      <span className="flex justify-between">
        <span>{label}</span>
        <span className="tabular text-muted-foreground">{label === 'Zoom' ? `${Math.round(value * 100)}%` : `${Math.round(value)}%`}</span>
      </span>
      <input type="range" className="mt-1 w-full accent-primary" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
    </label>
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-6">
        <DialogTitle className="text-lg font-semibold">Client logo</DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">Shown beside the client’s name across the Console. Zoom and drag to fit it in the square.</DialogDescription>
        <div className="mt-2 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Image</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="mt-1 block w-full text-sm file:me-3 file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm" onChange={(e) => pick(e.target.files?.[0])} />
          </label>
          {fileError && (
            <p role="alert" className="text-sm text-critical">
              {fileError}
            </p>
          )}
          {img ? (
            <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-center">
              <canvas
                ref={canvas}
                width={OUT}
                height={OUT}
                className="size-48 cursor-grab touch-none rounded-2xl border border-border active:cursor-grabbing"
                aria-label="Logo preview: drag to move the image"
                role="img"
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={() => (drag.current = null)}
                data-logo-preview
              />
              <div className="space-y-3">
                {slider('Zoom', zoom, setZoom, 1, 4, 0.05)}
                {slider('Left to right', x, setX, 0, 100, 1)}
                {slider('Top to bottom', y, setY, 0, 100, 1)}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              <ClientAvatar name={client.name} logoUrl={client.logoUrl} size="lg" />
              {client.logoUrl ? 'Choose an image to replace the logo.' : 'No logo yet. Choose an image to add one.'}
            </div>
          )}
          <ErrorText error={save.error ?? remove.error} />
          <div className="flex flex-wrap justify-between gap-2">
            {client.logoUrl ? (
              <Button type="button" variant="ghost" className="text-critical" onClick={() => remove.mutate()} disabled={remove.isPending}>
                <Trash2 className="size-4" aria-hidden /> Remove logo
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" onClick={() => save.mutate()} disabled={!img || save.isPending}>
                {save.isPending ? 'Saving…' : 'Save logo'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
