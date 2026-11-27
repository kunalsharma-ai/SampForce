'use client';

import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SECTION_KEYS,
  NOTIFICATION_SECTIONS,
  type NotificationFilter,
  type NotificationPreferences,
  type NotificationSectionKey,
  type SoundCategoryKey,
} from '@dealflow/types';
import { Button, Card, cn } from '@dealflow/ui';
import { BellRing, CheckCheck, Volume2 } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { NotificationItem } from '@/components/notifications/notification-item';
import { useChatRealm } from '@/components/shell/chat-button';
import { useChatSound } from '@/lib/chat';
import { useT } from '@/lib/i18n';
import {
  askDesktopPermission,
  useNotificationActions,
  useNotificationList,
  useNotificationPreferences,
  useNotificationSummary,
  useSaveNotificationPreferences,
} from '@/lib/notification-center';
import { playChime } from '@/lib/notification-sound';

const FILTERS: { key: NotificationFilter; label: 'All' | 'Unread' | 'Action required' }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'action', label: 'Action required' },
];

/** The full history (ADR 0075): filters, one section at a time, load more, and the person's alert preferences. */
export function NotificationCenter() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = (FILTERS.find((f) => f.key === params.get('filter'))?.key ?? 'all') as NotificationFilter;
  const sectionParam = params.get('section');
  const section = (NOTIFICATION_SECTION_KEYS as readonly string[]).includes(sectionParam ?? '') ? (sectionParam as NotificationSectionKey) : undefined;
  const summary = useNotificationSummary().data;
  const list = useNotificationList({ filter, section, limit: 25 });
  const { read, readSection } = useNotificationActions();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <Card className="p-0">
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <div role="tablist" aria-label={t('Show')} className="flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => set('filter', f.key === 'all' ? null : f.key)}
                className={cn(
                  'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                  filter === f.key ? 'bg-[hsl(var(--sf-red))] text-white' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t(f.label)}
              </button>
            ))}
          </div>
          <label className="ms-auto flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{t('Section')}</span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={section ?? ''}
              onChange={(e) => set('section', e.target.value || null)}
            >
              <option value="">{t('All sections')}</option>
              {NOTIFICATION_SECTIONS.map((s) => (
                <option key={s.key} value={s.key}>
                  {t.maybe(s.label)}
                  {summary?.bySection[s.key] ? ` (${summary.bySection[s.key]})` : ''}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!summary?.unread || read.isPending || readSection.isPending}
            onClick={() => (section ? readSection.mutate(section) : read.mutate('all'))}
          >
            <CheckCheck className="size-4" aria-hidden /> {section ? t('Mark these read') : t('Mark all read')}
          </Button>
        </div>
        <div className="p-2" role="tabpanel">
          {items.length ? (
            <ul className="space-y-1" data-notification-history="">
              {items.map((n) => (
                <li key={n.id}>
                  <NotificationItem n={n} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{list.isPending ? t('Loading…') : t('No notifications here yet.')}</p>
          )}
          {list.hasNextPage && (
            <div className="p-2 text-center">
              <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                {list.isFetchingNextPage ? t('Loading…') : t('Load more')}
              </Button>
            </div>
          )}
        </div>
      </Card>
      <PreferencesCard />
    </div>
  );
}

/** Sound, volume, muted categories and browser notifications: the person's own, on every device they sign in to. */
function PreferencesCard() {
  const t = useT();
  const prefs = useNotificationPreferences().data;
  const save = useSaveNotificationPreferences();
  const [denied, setDenied] = useState(false);
  if (!prefs) return null;
  const update = (patch: Partial<NotificationPreferences>) => save.mutate({ ...prefs, ...patch });
  const toggleMuted = (key: SoundCategoryKey, on: boolean) =>
    update({ mutedSound: on ? prefs.mutedSound.filter((k) => k !== key) : [...prefs.mutedSound, key] });
  const categories: { key: SoundCategoryKey; label: string }[] = [...NOTIFICATION_CATEGORIES.map((c) => ({ key: c.key, label: c.label })), { key: 'other', label: 'Everything else' }];

  return (
    <Card id="preferences" className="scroll-mt-24 space-y-5 p-5">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-9 place-items-center rounded-xl bg-[hsl(var(--sf-red))] text-white">
          <Volume2 className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-semibold">{t('Sound and alerts')}</h2>
          <p className="text-xs text-muted-foreground">{t('Your own settings. They follow you to every workspace, browser and phone you sign in to.')}</p>
        </div>
      </div>

      <label className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--sf-red))]" checked={prefs.sound} onChange={(e) => update({ sound: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium">{t('Play a sound when a notification arrives')}</span>
          <span className="block text-xs text-muted-foreground">{t('A short, soft chime, once per notification. Urgent and action-required ones sound a little brighter. Never when you first open SampForce.')}</span>
        </span>
      </label>

      <div className={cn('flex flex-wrap items-center gap-3 ps-7')}>
        <label htmlFor="notify-volume" className="text-sm">
          {t('Volume')}
        </label>
        <input
          id="notify-volume"
          type="range"
          min={5}
          max={100}
          step={5}
          disabled={!prefs.sound}
          defaultValue={prefs.volume}
          onPointerUp={(e) => update({ volume: Number((e.target as HTMLInputElement).value) })}
          onKeyUp={(e) => update({ volume: Number((e.target as HTMLInputElement).value) })}
          className="w-48 accent-[hsl(var(--sf-red))]"
          aria-valuetext={`${prefs.volume}%`}
        />
        <span className="w-10 text-sm tabular text-muted-foreground">{prefs.volume}%</span>
        <Button type="button" variant="outline" size="sm" disabled={!prefs.sound} onClick={() => playChime('soft', prefs.volume)}>
          <BellRing className="size-4" aria-hidden /> {t('Play a test sound')}
        </Button>
      </div>

      <ChatSoundSwitch />

      <fieldset className={cn('ps-7')} disabled={!prefs.sound}>
        <legend className="text-sm font-medium">{t('Play the sound for')}</legend>
        <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {categories.map((c) => (
            <label key={c.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[hsl(var(--sf-red))]"
                checked={!prefs.mutedSound.includes(c.key)}
                onChange={(e) => toggleMuted(c.key, e.target.checked)}
                data-sound-category={c.key}
              />
              {t.maybe(c.label)}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 size-4 accent-[hsl(var(--sf-red))]"
          checked={prefs.desktop}
          onChange={async (e) => {
            const on = e.target.checked;
            if (on && !(await askDesktopPermission())) {
              setDenied(true);
              return;
            }
            setDenied(false);
            update({ desktop: on });
          }}
        />
        <span>
          <span className="block text-sm font-medium">{t('Show browser notifications while SampForce is in the background')}</span>
          <span className="block text-xs text-muted-foreground">{t('Your browser asks for permission the first time. Your computer’s own notification and Do Not Disturb settings still apply.')}</span>
          {denied && (
            <span role="alert" className="mt-1 block text-xs text-critical">
              {t('Your browser blocks notifications from SampForce. Allow them in the browser’s site settings, then turn this on again.')}
            </span>
          )}
        </span>
      </label>
      {save.isError && (
        <p role="alert" className="text-sm text-critical">
          {t('Could not save. Please try again.')}
        </p>
      )}
    </Card>
  );
}

/** Team chat's own chime (R9), set here with the other sounds (R10). It is kept on this device. */
function ChatSoundSwitch() {
  const t = useT();
  const chat = useChatSound();
  const realm = useChatRealm();
  if (!realm) return null;
  return (
    <label className="flex items-start gap-3" data-chat-sound-setting="">
      <input type="checkbox" className="mt-1 size-4 accent-[hsl(var(--sf-red))]" checked={chat.on} onChange={(e) => chat.set(e.target.checked)} />
      <span>
        <span className="block text-sm font-medium">{t('Play a sound for new team chat messages')}</span>
        <span className="block text-xs text-muted-foreground">{t('A short chime when a message arrives in a conversation you are not looking at. Kept on this device.')}</span>
      </span>
    </label>
  );
}
