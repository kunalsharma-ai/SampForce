'use client';

import { LANGUAGES, type LanguageCode } from '@dealflow/types';
import { Languages } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { useRegional } from '@/stores/regional';

/**
 * Language choice on the signed-out pages. It applies on this device straight away and is saved to the account on
 * the first sign-in, unless the account already has a language of its own.
 */
export function AuthLanguage() {
  const t = useT();
  const choose = useRegional((s) => s.chooseSignedOut);
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Languages className="size-4" aria-hidden />
      <label htmlFor="auth-language" className="sr-only">
        {t('regional.language')}
      </label>
      <select
        id="auth-language"
        className="h-8 rounded-md border border-input bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={t.language}
        onChange={(e) => choose(e.target.value as LanguageCode)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </div>
  );
}
