'use client';

import { DropdownMenuItem } from '@dealflow/ui';
import { Smile, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { usePeopleCards } from '@/lib/people';
import { UserAvatar } from './user-avatar';

/** The signed-in person's avatar in the header (ADR 0087): their photo or initials, with their mood. */
export function AccountAvatar() {
  const { data } = useSession();
  return <UserAvatar userId={data?.user.id} name={data?.user.name ?? '…'} photoUrl={data?.user.photoUrl} className="size-9 ring-0" tone="from-primary to-accent" />;
}

/** The top of the account menu: name, email and mood, opening My profile, plus a quick way to set the mood. */
export function AccountProfileItems() {
  const t = useT();
  const { data } = useSession();
  const cards = usePeopleCards();
  if (!data) return null;
  const mood = cards.data?.get(data.user.id)?.mood;
  return (
    <>
      <DropdownMenuItem asChild>
        <Link href="/app/profile" data-account-profile className="flex items-center gap-3 px-2 py-2">
          <UserAvatar userId={data.user.id} name={data.user.name} photoUrl={data.user.photoUrl} className="size-10 text-sm" tone="from-primary to-accent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{data.user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{data.user.email}</span>
            {mood && (
              <span className="mt-0.5 block truncate text-xs">
                {mood.emoji} {mood.text ? t.maybe(mood.text) : ''}
              </span>
            )}
          </span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/app/profile">
          <UserRound aria-hidden /> {t('My profile')}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link href="/app/profile?mood=1">
          <Smile aria-hidden /> {mood ? t('Change your mood') : t('Set your mood')}
        </Link>
      </DropdownMenuItem>
    </>
  );
}
