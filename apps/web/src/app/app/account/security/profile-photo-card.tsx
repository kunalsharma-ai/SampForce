'use client';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

/** Square, 512 pixels, JPEG: the same size the phone app uploads. */
const SIZE = 512;

/** Crops the centre of a picture square and shrinks it, in the browser, before it is sent. */
async function squareJpeg(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const out = Math.min(SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    canvas.getContext('2d')!.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, out, out);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('unreadable'))), 'image/jpeg', 0.85));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * The person's profile photo (ADR 0072, M6): shown in the account menu, in team chat and in the phone app, to people
 * in the same organisation. The same photo is used in every organisation the person belongs to.
 */
export function ProfilePhotoCard() {
  const t = useT();
  const me = useSession();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoUrl = me.data?.user.photoUrl ?? null;
  const name = me.data?.user.name ?? '';

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('That picture could not be read. Try a PNG or JPEG photo.'));
    } finally {
      setBusy(false);
    }
  };
  const upload = (file: File) => run(async () => api('/me/photo', { method: 'PUT', body: await squareJpeg(file), headers: { 'content-type': 'image/jpeg' } }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('Profile photo')}</CardTitle>
        <CardDescription>{t('People in your organisation see it in the account menu, in team chat and in the SampForce app.')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- a private, signed-in image that Next cannot optimise
          <img src={photoUrl} alt={t('Your photo')} className="size-20 rounded-full object-cover" />
        ) : (
          <span aria-label={t('No photo yet')} role="img" className="grid size-20 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-xl font-semibold text-background">
            {name
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]!.toUpperCase())
              .join('')}
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            aria-label={t('Choose a photo')}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void upload(file);
            }}
          />
          <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
            {photoUrl ? t('Change photo') : t('Add a photo')}
          </Button>
          {photoUrl ? (
            <Button type="button" variant="outline" disabled={busy} onClick={() => void run(() => api('/me/photo', { method: 'DELETE' }))}>
              {t('Remove photo')}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="w-full text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
