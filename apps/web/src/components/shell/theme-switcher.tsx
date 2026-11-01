'use client';

import { type Appearance, getTheme, THEMES } from '@dealflow/types';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dealflow/ui';
import { Palette, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePreferences } from '@/stores/preferences';

/** Top bar theme and mode switcher. Changes apply at once and are saved to the person's account. */
export function ThemeSwitcher() {
  const appearance = usePreferences((s) => s.appearance);
  const update = usePreferences((s) => s.update);
  const current = getTheme(appearance.themeId);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current.name}`}>
          <Palette aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] w-64 overflow-y-auto">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={appearance.mode} onValueChange={(v) => update({ mode: v as Appearance['mode'] })}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">Automatic</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={appearance.themeId} onValueChange={(v) => update({ themeId: v as Appearance['themeId'] })}>
          {THEMES.map((t) => (
            <DropdownMenuRadioItem key={t.id} value={t.id}>
              <span aria-hidden className="flex shrink-0 overflow-hidden rounded-full border border-border">
                <span className="size-3" style={{ background: t[t.preferredMode].background }} />
                <span className="size-3" style={{ background: t[t.preferredMode].primary }} />
              </span>
              <span className="truncate">{t.name}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings/appearance">
            <SlidersHorizontal aria-hidden /> Open Theme Studio
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
