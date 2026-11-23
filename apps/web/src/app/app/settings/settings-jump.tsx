'use client';

import { useT } from '@/lib/i18n';

/** Quick links to the nine sections of the Settings page. */
export function SettingsJump({ sections }: { sections: { id: string; title: string }[] }) {
  const t = useT();
  return (
    <nav aria-label={t('Settings sections')} className="flex flex-wrap gap-2" data-settings-jump>
      {sections.map((s) => (
        <a key={s.id} href={`#${s.id}`} className="rounded-full border border-border px-3 py-1 text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t.maybe(s.title)}
        </a>
      ))}
    </nav>
  );
}
