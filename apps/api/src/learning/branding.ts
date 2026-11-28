import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import type { TenantTx } from '@dealflow/database';
import { type LearningBrand, normaliseHex, secondaryFor } from '@dealflow/types';

/*
 * The organisation's branding on learning certificates (ADR 0103). It is read when a certificate is drawn, so a new
 * logo or new brand colours show on every certificate, old and new:
 *
 *  - name: the learning settings' issuer name, else My Organization's brand name, else the workspace name;
 *  - tagline: My Organization's tagline;
 *  - logo: My Organization's logo (PNG, JPEG, WebP or SVG), else the logo from the commercial settings (quotes and
 *    invoices). It is turned into a trimmed PNG so the PDF can embed it and it never stretches;
 *  - colours: My Organization's first two brand colours when the settings say so (the default), else the accent colour.
 */

const log = new Logger('LearningBranding');

export interface ResolvedBrand {
  brand: LearningBrand;
  /** The logo as PNG, ready for the PDF, or null. */
  logoPng: Buffer | null;
}

interface LogoSource {
  key: string;
  read: () => Promise<Buffer | null>;
}

/** Converted logos, by organisation and logo version, so a busy certificate page does not redo the work. */
const cache = new Map<string, { png: Buffer; ratio: number } | null>();
const CACHE_MAX = 200;

async function toPng(data: Buffer): Promise<{ png: Buffer; ratio: number } | null> {
  const resize = { width: 1200, height: 600, fit: 'inside' as const, withoutEnlargement: true };
  const convert = async (trim: boolean) => {
    let img = sharp(data, { density: 300, limitInputPixels: 40_000_000 });
    if (trim) img = img.trim({ threshold: 10 });
    const out = await img.resize(resize).png().toBuffer({ resolveWithObject: true });
    return { png: out.data, ratio: out.info.width / Math.max(1, out.info.height) };
  };
  try {
    return await convert(true);
  } catch {
    try {
      // A logo that is all one colour cannot be trimmed; use it as it is.
      return await convert(false);
    } catch (e) {
      log.warn(`A logo could not be read and is left off the certificate: ${(e as Error).message}`);
      return null;
    }
  }
}

async function logoOf(src: LogoSource | null): Promise<{ png: Buffer; ratio: number } | null> {
  if (!src) return null;
  if (cache.has(src.key)) return cache.get(src.key) ?? null;
  const data = await src.read();
  const out = data ? await toPng(data) : null;
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(src.key, out);
  return out;
}

const dataUrlBytes = (url: string): Buffer | null => {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(url);
  return m ? Buffer.from(m[1]!, 'base64') : null;
};

/**
 * The branding for an organisation's certificates. `logoUrl` says where the app loads the logo from: the signed-in
 * route, or the public one of a certificate's check page.
 */
export async function learningBrand(tx: TenantTx, tenantId: string, logoUrl: (version: string) => string): Promise<ResolvedBrand> {
  // One after another: a transaction runs one query at a time.
  const settings = await tx.learningSettings.findUnique({ where: { tenantId }, select: { issuerName: true, accentColor: true, useBrandColors: true } });
  const profile = await tx.orgProfile.findUnique({ where: { tenantId }, select: { brandName: true, tagline: true, brandColors: true, logoUpdatedAt: true } });
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true, brandColor: true } });
  const commercial = profile?.logoUpdatedAt ? null : await tx.commercialSettings.findUnique({ where: { tenantId }, select: { logoDataUrl: true, updatedAt: true } });


  const brandColors = (profile?.brandColors ?? []).map(normaliseHex).filter((c): c is string => !!c);
  const useBrand = settings?.useBrandColors !== false;
  const accent = normaliseHex(settings?.accentColor) ?? normaliseHex(tenant?.brandColor) ?? '#2563eb';
  const fromOrg = useBrand && brandColors.length > 0;
  const primary = fromOrg ? brandColors[0]! : accent;
  const secondary = fromOrg && brandColors[1] && brandColors[1] !== primary ? brandColors[1] : secondaryFor(primary);

  let src: LogoSource | null = null;
  if (profile?.logoUpdatedAt) {
    const stamp = profile.logoUpdatedAt.getTime().toString(36);
    src = {
      key: `${tenantId}:org:${stamp}`,
      read: async () => {
        const r = await tx.orgProfile.findUnique({ where: { tenantId }, select: { logoData: true } });
        return r?.logoData ? Buffer.from(r.logoData) : null;
      },
    };
  } else if (commercial?.logoDataUrl) {
    const url = commercial.logoDataUrl;
    src = { key: `${tenantId}:commercial:${commercial.updatedAt.getTime().toString(36)}`, read: async () => dataUrlBytes(url) };
  }
  const logo = await logoOf(src);
  const version = src ? src.key.split(':').slice(1).join('-') : '';

  return {
    brand: {
      name: settings?.issuerName?.trim() || profile?.brandName?.trim() || tenant?.name || 'SampForce',
      tagline: profile?.tagline?.trim() || null,
      logoUrl: logo ? logoUrl(version) : null,
      logoRatio: logo ? Math.round(logo.ratio * 1000) / 1000 : null,
      primary,
      secondary,
      colorSource: fromOrg ? 'ORGANIZATION' : 'SETTINGS',
      brandColors,
    },
    logoPng: logo?.png ?? null,
  };
}

export const LEARNING_LOGO_URL = (v: string) => `/api/v1/learning/brand/logo?v=${encodeURIComponent(v)}`;
export const VERIFY_LOGO_URL = (code: string) => (v: string) => `/api/v1/learning/verify/${encodeURIComponent(code)}/logo?v=${encodeURIComponent(v)}`;
