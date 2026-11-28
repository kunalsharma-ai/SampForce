'use client';

import { type CertElement, type CertFont, CERT_H, CERT_W, type CertificateRow, type CertificateTemplate, certificateDesign, estimateWidth, type LearningBrand } from '@dealflow/types';
import QRCode from 'qrcode';
import { useEffect, useId, useMemo, useState } from 'react';

/*
 * The certificate on screen (ADR 0103): the same design the PDF is drawn from (certificateDesign in @dealflow/types),
 * drawn as SVG in the same typefaces, with the organisation's logo, name and colours. What people see is what they
 * download.
 */

const FONT: Record<CertFont, { family: string; weight: number; style: 'normal' | 'italic' }> = {
  serif: { family: 'SF Cert Serif, Georgia, serif', weight: 400, style: 'normal' },
  serifBold: { family: 'SF Cert Serif, Georgia, serif', weight: 700, style: 'normal' },
  serifItalic: { family: 'SF Cert Serif, Georgia, serif', weight: 400, style: 'italic' },
  serifBoldItalic: { family: 'SF Cert Serif, Georgia, serif', weight: 700, style: 'italic' },
  sans: { family: 'SF Cert Sans, system-ui, sans-serif', weight: 400, style: 'normal' },
  sansSemi: { family: 'SF Cert Sans, system-ui, sans-serif', weight: 600, style: 'normal' },
  sansBold: { family: 'SF Cert Sans, system-ui, sans-serif', weight: 700, style: 'normal' },
};

export interface CertificateArtProps {
  c: Pick<CertificateRow, 'number' | 'code' | 'recipientName' | 'moduleTitle' | 'category' | 'score' | 'completedAt' | 'issuedAt' | 'issuerName' | 'signatoryName' | 'signatoryTitle' | 'revoked'> & { template: CertificateTemplate };
  brand: LearningBrand;
  /** The public check page; the QR code on the certificate opens it. */
  verifyUrl?: string | null;
}

export function CertificateArt({ c, brand, verifyUrl }: CertificateArtProps) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const url = verifyUrl ?? (typeof window === 'undefined' ? `/verify/certificate/${c.code}` : `${window.location.origin}/verify/certificate/${c.code}`);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 0, width: 360, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
      .then((d) => live && setQr(d))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [url]);

  const elements = useMemo(
    () =>
      certificateDesign({
        template: c.template,
        primary: brand.primary,
        secondary: brand.secondary,
        organisation: c.issuerName,
        tagline: brand.tagline,
        hasLogo: !!brand.logoUrl,
        logoRatio: brand.logoRatio,
        recipientName: c.recipientName,
        moduleTitle: c.moduleTitle,
        category: c.category,
        score: c.score,
        completedAt: c.completedAt,
        issuedAt: c.issuedAt,
        number: c.number,
        code: c.code,
        signatoryName: c.signatoryName,
        signatoryTitle: c.signatoryTitle,
        verifyUrl: url,
        revoked: c.revoked,
      }),
    [c, brand, url],
  );

  return (
    <svg viewBox={`0 0 ${CERT_W} ${CERT_H}`} role="img" aria-label={`${c.issuerName}: certificate ${c.number} for ${c.recipientName}, ${c.moduleTitle}`} data-certificate-art={c.template}>
      {elements.map((el, i) => (
        <Shape key={i} el={el} id={`${id}-${i}`} logo={brand.logoUrl} qr={qr} />
      ))}
    </svg>
  );
}

function Shape({ el, id, logo, qr }: { el: CertElement; id: string; logo: string | null; qr: string | null }) {
  const opacity = el.opacity ?? 1;
  switch (el.kind) {
    case 'rect':
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={el.radius} fill={el.fill ?? 'none'} stroke={el.stroke} strokeWidth={el.lw} opacity={opacity} />;
    case 'gradient':
      return (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2={el.vertical ? 0 : 1} y2={el.vertical ? 1 : 0}>
              <stop offset="0" stopColor={el.from} />
              <stop offset="1" stopColor={el.to} />
            </linearGradient>
          </defs>
          <rect x={el.x} y={el.y} width={el.w} height={el.h} fill={`url(#${id})`} opacity={opacity} />
        </>
      );
    case 'line':
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} stroke={el.stroke} strokeWidth={el.lw} opacity={opacity} strokeDasharray={el.dash} />;
    case 'circle':
      return <circle cx={el.cx} cy={el.cy} r={el.r} fill={el.fill ?? 'none'} stroke={el.stroke} strokeWidth={el.lw} opacity={opacity} strokeDasharray={el.dash} />;
    case 'poly':
      return <polygon points={el.points.map((p) => p.join(',')).join(' ')} fill={el.fill ?? 'none'} stroke={el.stroke} strokeWidth={el.lw} strokeLinejoin="round" opacity={opacity} />;
    case 'path':
      return <path d={el.d} fill={el.fill ?? 'none'} stroke={el.stroke} strokeWidth={el.lw} opacity={opacity} />;
    case 'image': {
      const href = el.image === 'logo' ? logo : qr;
      if (!href) return null;
      return <image href={href} x={el.x} y={el.y} width={el.w} height={el.h} opacity={opacity} preserveAspectRatio="xMidYMid meet" />;
    }
    case 'text': {
      const f = FONT[el.font];
      // Squeeze only text the estimate says would run past its width.
      const tooWide = estimateWidth(el.text, el.font, el.size, el.spacing) > el.maxWidth;
      return (
        <text
          x={el.x}
          y={el.y}
          fontFamily={f.family}
          fontWeight={f.weight}
          fontStyle={f.style}
          fontSize={el.size}
          letterSpacing={el.spacing}
          fill={el.color}
          opacity={opacity}
          textAnchor={el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'}
          {...(tooWide ? { textLength: el.maxWidth, lengthAdjust: 'spacingAndGlyphs' } : {})}
        >
          {el.text}
        </text>
      );
    }
  }
}
