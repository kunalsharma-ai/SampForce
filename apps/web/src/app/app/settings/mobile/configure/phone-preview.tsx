'use client';

import { MOBILE_DASHBOARD_CARD_DEFS, MOBILE_MODULE_BY_KEY, type MobileAppConfig, type MobileModuleKey, type MobileWorkspaceLevel, PERMISSIONS, readableTextOn, resolveMobileConfig } from '@dealflow/types';
import { BarChart3, Bell, Building2, CheckSquare, ClipboardList, Contact, FileBarChart, Handshake, LayoutDashboard, type LucideIcon, Menu, MessagesSquare, Target, UserRound } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { MOBILE_LEVEL_LABEL } from '@/lib/mobile';

export const MODULE_ICON: Record<MobileModuleKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  companies: Building2,
  contacts: Contact,
  follow_ups: ClipboardList,
  tasks: CheckSquare,
  deals: Handshake,
  targets: Target,
  reports: FileBarChart,
  chat: MessagesSquare,
  notifications: Bell,
  profile: UserRound,
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/**
 * A phone-sized picture of the home screen one level would get from this configuration. It uses the same
 * resolveMobileConfig as the API, so what it shows is what the phone is sent: no figures, only the layout.
 */
export function PhonePreview({ config, level, features }: { config: MobileAppConfig; level: MobileWorkspaceLevel; features: string[] }) {
  const t = useT();
  const r = resolveMobileConfig(config, { level, features, permissions: [...PERMISSIONS] });
  const dark = r.branding.theme === 'dark';
  const fg = dark ? '#F8FAFC' : '#0F172A';
  const bg = dark ? '#0B1120' : '#F8FAFC';
  const card = dark ? '#111A2E' : '#FFFFFF';
  const muted = dark ? '#94A3B8' : '#64748B';
  const visibleCompanyFields = Object.keys(r.fields.companies ?? {}).length;
  const companyFieldTotal = Object.keys(config.fields.companies).length;
  return (
    <figure className="w-[264px] shrink-0">
      <div className="overflow-hidden rounded-[2rem] border-[6px] border-neutral-800 shadow-lg" style={{ background: bg, color: fg }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ background: r.branding.primaryColor, color: readableTextOn(r.branding.primaryColor) }}>
          {r.branding.logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data URL the Super Workspace uploaded
            <img src={r.branding.logoDataUrl} alt="" className="size-7 rounded bg-white object-contain p-0.5" />
          ) : (
            <span className="flex size-7 items-center justify-center rounded border border-current text-xs font-semibold">{initials(r.branding.appName)}</span>
          )}
          <span className="truncate text-sm font-semibold">{r.branding.appName}</span>
        </div>
        <div className="h-[380px] space-y-2 overflow-hidden p-3">
          <p className="text-xs" style={{ color: muted }}>
            {t.maybe(MOBILE_LEVEL_LABEL[level])}
          </p>
          {r.dashboard.length === 0 && (
            <p className="text-xs" style={{ color: muted }}>
              {t('No cards: the home screen shows only a greeting.')}
            </p>
          )}
          {r.dashboard.map((c) => (
            <div key={c.card} className="rounded-lg p-2.5 text-xs shadow-sm" style={{ background: card, borderInlineStart: `3px solid ${r.branding.accentColor}` }}>
              <p className="font-medium">{t.maybe(MOBILE_DASHBOARD_CARD_DEFS[c.card].label)}</p>
              <p style={{ color: muted }}>{t.maybe(MOBILE_DASHBOARD_CARD_DEFS[c.card].description)}</p>
              {c.showChart && (
                <p className="mt-1 flex items-center gap-1" style={{ color: muted }}>
                  <BarChart3 className="size-3.5" aria-hidden style={{ color: r.branding.accentColor }} />
                  {t('Chart')}
                </p>
              )}
            </div>
          ))}
        </div>
        <nav className="flex justify-around border-t px-1 py-2 text-[10px]" style={{ borderColor: `${muted}44`, background: card }} aria-label={t('Bottom tabs')}>
          {r.tabs.map((k, i) => {
            const Icon = MODULE_ICON[k];
            return (
              <span key={k} className={`flex flex-col items-center gap-0.5 ${i === 0 ? 'font-semibold' : ''}`} style={{ color: i === 0 ? fg : muted }}>
                <Icon className="size-4" aria-hidden style={i === 0 ? { color: r.branding.primaryColor } : undefined} />
                <span className="max-w-14 truncate">{t.maybe(MOBILE_MODULE_BY_KEY[k].label)}</span>
              </span>
            );
          })}
          {r.more.length > 0 && (
            <span className="flex flex-col items-center gap-0.5" style={{ color: muted }}>
              <Menu className="size-4" aria-hidden />
              <span>{t('More')}</span>
            </span>
          )}
        </nav>
      </div>
      <figcaption className="relative z-10 mt-2 space-y-0.5 rounded bg-card py-1 text-center text-xs text-muted-foreground">
        <span className="block font-medium text-foreground">{t.maybe(MOBILE_LEVEL_LABEL[level])}</span>
        <span className="block">{t('{n} modules · {f} of {total} company fields shown', { n: r.modules.length, f: visibleCompanyFields, total: companyFieldTotal })}</span>
      </figcaption>
    </figure>
  );
}
