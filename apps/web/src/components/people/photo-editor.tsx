'use client';

import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dealflow/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, RotateCw, Trash2, ZoomIn, ZoomOut } from 'lucide-react';
import * as React from 'react';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { PHOTO_SIZE, removePhoto, uploadPhoto } from '@/lib/people';

/** The crop circle's size on screen. */
const VIEW = 256;
const MAX_FILE = 15 * 1024 * 1024;

interface Crop {
  zoom: number;
  x: number;
  y: number;
  rotate: 0 | 90 | 180 | 270;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('unreadable'));
      el.src = url;
    });
  } finally {
    // The element keeps its decoded pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** The picture's size once rotated, and the scale that makes its shorter side fill the circle at zoom 1. */
function fit(img: HTMLImageElement, rotate: number) {
  const w = rotate % 180 ? img.naturalHeight : img.naturalWidth;
  const h = rotate % 180 ? img.naturalWidth : img.naturalHeight;
  return { w, h, base: VIEW / Math.min(w, h) };
}

/** Keeps the picture covering the whole circle, whatever the zoom and drag. */
function clamp(img: HTMLImageElement, c: Crop): Crop {
  const { w, h, base } = fit(img, c.rotate);
  const s = base * c.zoom;
  const maxX = Math.max(0, (w * s - VIEW) / 2);
  const maxY = Math.max(0, (h * s - VIEW) / 2);
  return { ...c, x: Math.min(maxX, Math.max(-maxX, c.x)), y: Math.min(maxY, Math.max(-maxY, c.y)) };
}

/** Draws the crop into a square canvas of `out` pixels: the same maths as the preview, scaled up. */
function draw(canvas: HTMLCanvasElement, img: HTMLImageElement, c: Crop, out: number) {
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d')!;
  const k = out / VIEW;
  const { base } = fit(img, c.rotate);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out, out);
  ctx.translate(out / 2 + c.x * k, out / 2 + c.y * k);
  ctx.rotate((c.rotate * Math.PI) / 180);
  const s = base * c.zoom * k;
  ctx.drawImage(img, (-img.naturalWidth * s) / 2, (-img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
}

/**
 * Choose, crop and save a profile photo (ADR 0072, 0087): drop or pick a picture, drag it into place, zoom and turn
 * it, see it as teammates will, and save a 512-pixel square. Also removes the photo.
 */
export function PhotoEditor({ open, onOpenChange, hasPhoto }: { open: boolean; onOpenChange: (open: boolean) => void; hasPhoto: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const preview = React.useRef<HTMLCanvasElement>(null);
  const small = React.useRef<HTMLCanvasElement>(null);
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  const [crop, setCrop] = React.useState<Crop>({ zoom: 1, x: 0, y: 0, rotate: 0 });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const drag = React.useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  React.useEffect(() => {
    if (!open) {
      setImg(null);
      setError(null);
      setCrop({ zoom: 1, x: 0, y: 0, rotate: 0 });
    }
  }, [open]);

  React.useEffect(() => {
    if (!img) return;
    if (preview.current) draw(preview.current, img, crop, VIEW * 2);
    if (small.current) draw(small.current, img, crop, 96);
  }, [img, crop]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/^image\/(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(file.type)) return setError(t('Use a PNG, JPEG or WebP picture.'));
    if (file.size > MAX_FILE) return setError(t('That picture is too large. Use one under 15 MB.'));
    try {
      const el = await loadImage(file);
      if (Math.min(el.naturalWidth, el.naturalHeight) < 64) return setError(t('That picture is too small. Use one at least 64 pixels across.'));
      setImg(el);
      setCrop({ zoom: 1, x: 0, y: 0, rotate: 0 });
    } catch {
      setError(t('That picture could not be read. Try a PNG or JPEG photo.'));
    }
  };

  const update = (next: Partial<Crop>) => img && setCrop((c) => clamp(img, { ...c, ...next }));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['people'] })]);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('That picture could not be read. Try a PNG or JPEG photo.'));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!img) return;
      const canvas = document.createElement('canvas');
      draw(canvas, img, crop, Math.min(PHOTO_SIZE, Math.max(64, Math.round(Math.min(img.naturalWidth, img.naturalHeight) / crop.zoom))));
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('unreadable'))), 'image/jpeg', 0.88));
      await uploadPhoto(blob);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-2rem,30rem)] p-5">
        <DialogTitle className="text-lg font-semibold">{t('Your profile photo')}</DialogTitle>
        <DialogDescription className="mb-4 text-sm text-muted-foreground">{img ? t('Drag the picture to place it, and zoom in or out.') : t('People in your organisation see it next to your name everywhere in SampForce.')}</DialogDescription>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
          className="sr-only"
          aria-label={t('Choose a photo')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            void pick(file);
          }}
        />
        {img ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center gap-5">
              <div
                data-crop-area
                className="relative cursor-grab touch-none overflow-hidden rounded-full shadow-inner ring-4 ring-primary/30 active:cursor-grabbing"
                style={{ width: VIEW, height: VIEW }}
                onPointerDown={(e) => {
                  (e.target as Element).setPointerCapture?.(e.pointerId);
                  drag.current = { px: e.clientX, py: e.clientY, x: crop.x, y: crop.y };
                }}
                onPointerMove={(e) => drag.current && update({ x: drag.current.x + e.clientX - drag.current.px, y: drag.current.y + e.clientY - drag.current.py })}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
                onWheel={(e) => update({ zoom: Math.min(4, Math.max(1, crop.zoom - e.deltaY / 500)) })}
                onKeyDown={(e) => {
                  const step = 8;
                  const moves: Record<string, Partial<Crop>> = { ArrowLeft: { x: crop.x + step }, ArrowRight: { x: crop.x - step }, ArrowUp: { y: crop.y + step }, ArrowDown: { y: crop.y - step } };
                  if (moves[e.key]) {
                    e.preventDefault();
                    update(moves[e.key]!);
                  }
                }}
                tabIndex={0}
                role="img"
                aria-label={t('Photo crop. Use the arrow keys to move the picture.')}
              >
                <canvas ref={preview} className="size-full" />
              </div>
              <div className="hidden flex-col items-center gap-2 sm:flex">
                <canvas ref={small} className="size-12 rounded-full shadow ring-2 ring-surface" />
                <span className="text-[11px] text-muted-foreground">{t('Preview')}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="ghost" size="icon" aria-label={t('Zoom out')} onClick={() => update({ zoom: Math.max(1, crop.zoom - 0.25) })}>
                <ZoomOut aria-hidden />
              </Button>
              <input type="range" min={1} max={4} step={0.01} value={crop.zoom} aria-label={t('Zoom')} onChange={(e) => update({ zoom: Number(e.target.value) })} className="flex-1 accent-primary" />
              <Button type="button" variant="ghost" size="icon" aria-label={t('Zoom in')} onClick={() => update({ zoom: Math.min(4, crop.zoom + 0.25) })}>
                <ZoomIn aria-hidden />
              </Button>
              <Button type="button" variant="ghost" size="icon" aria-label={t('Turn the picture')} onClick={() => update({ rotate: (((crop.rotate + 90) % 360) as Crop['rotate']), x: 0, y: 0 })}>
                <RotateCw aria-hidden />
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            data-drop-zone
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void pick(e.dataTransfer.files[0]);
            }}
            className={`flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${dragOver ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/60 hover:bg-muted/50'}`}
          >
            <span className="grid size-14 place-items-center rounded-full bg-gradient-to-br from-primary to-accent text-white shadow-lg">
              <ImagePlus className="size-6" aria-hidden />
            </span>
            <span className="text-sm font-medium">{t('Drop a picture here, or choose one')}</span>
            <span className="text-xs text-muted-foreground">{t('PNG, JPEG or WebP. You can crop it next.')}</span>
          </button>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            {hasPhoto && (
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => void run(removePhoto)}>
                <Trash2 aria-hidden /> {t('Remove photo')}
              </Button>
            )}
            {img && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>
                {t('Choose another')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="button" disabled={!img || busy} onClick={() => void save()}>
              {busy ? t('Saving…') : t('Save photo')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
