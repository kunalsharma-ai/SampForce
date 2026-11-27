'use client';

import { Badge, Popover, PopoverContent, PopoverTrigger, Skeleton } from '@dealflow/ui';
import { Linkedin, Mail, Pencil, Phone, Quote } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { useT } from '@/lib/i18n';
import { usePersonProfile } from '@/lib/people';
import { COVERS, UserAvatar } from './user-avatar';

/**
 * A teammate's profile card (ADR 0087): opens from their avatar or name and shows their cover, photo, mood, headline,
 * quote, "ask me about" tags and how to reach them.
 */
export function PersonPopover({ userId, name, children }: { userId: string; name: string; children: React.ReactElement }) {
  const [open, setOpen] = React.useState(false);
  // Profiles belong to a workspace's pages; elsewhere (the Console) the avatar stays a plain avatar.
  if (!(usePathname() ?? '').startsWith('/app')) return children;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 overflow-hidden p-0" aria-label={name}>
        {open && <PersonCardBody userId={userId} name={name} />}
      </PopoverContent>
    </Popover>
  );
}

function PersonCardBody({ userId, name }: { userId: string; name: string }) {
  const t = useT();
  const q = usePersonProfile(userId);
  const p = q.data;
  return (
    <div data-person-card={userId}>
      <div className="h-20" style={{ background: COVERS[p?.cover ?? 'aurora'].css }} />
      <div className="-mt-10 px-4 pb-4">
        <div className="flex items-end justify-between gap-2">
          <UserAvatar userId={userId} name={p?.name ?? name} photoUrl={p?.photoUrl} showMood={false} className="size-20 text-xl ring-4" />
          {p?.self && (
            <Link href="/app/profile" className="mb-1 inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:bg-muted">
              <Pencil className="size-3" aria-hidden /> {t('Edit my profile')}
            </Link>
          )}
        </div>
        <p className="mt-2 text-base font-semibold leading-tight">{p?.name ?? name}</p>
        {q.isLoading ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        ) : q.isError || !p ? (
          <p className="mt-2 text-xs text-muted-foreground">{t('This profile is not available.')}</p>
        ) : (
          <>
            {p.headline && <p className="text-sm text-muted-foreground">{p.headline}</p>}
            <p className="mt-0.5 text-xs text-muted-foreground">{[p.designation ? t.maybe(p.designation) : null, p.department ? t.maybe(p.department) : null, p.role ? t.maybe(p.role) : null].filter(Boolean).join(' · ')}</p>
            {p.mood && (
              <p data-person-mood className="mt-3 inline-flex max-w-full items-center gap-2 rounded-2xl bg-muted px-3 py-1.5 text-sm">
                <span className="text-lg leading-none">{p.mood.emoji}</span>
                <span className="truncate">{p.mood.text ? t.maybe(p.mood.text) : t('Current mood')}</span>
              </p>
            )}
            {p.birthday && (
              <p data-person-birthday className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <span aria-hidden>🎂</span>
                <span className="sr-only">{t('Birthday')}: </span>
                {new Intl.DateTimeFormat(t.formatLocale, { day: 'numeric', month: 'long', ...(p.birthday.year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(
                  new Date(Date.UTC(p.birthday.year ?? 2000, p.birthday.month - 1, p.birthday.day)),
                )}
              </p>
            )}
            {p.quote && (
              <blockquote className="mt-3 flex gap-2 text-sm italic text-foreground/90">
                <Quote className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                <span>{p.quote}</span>
              </blockquote>
            )}
            {p.bio && <p className="mt-2 line-clamp-4 whitespace-pre-line text-sm text-muted-foreground">{p.bio}</p>}
            {p.tags.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t('Ask me about')}</p>
                <div className="flex flex-wrap gap-1">
                  {p.tags.map((tag) => (
                    <Badge key={tag} className="rounded-full">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3 text-xs">
              <a href={`mailto:${p.email}`} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 font-medium text-primary hover:bg-primary/20">
                <Mail className="size-3.5" aria-hidden /> {t('Email')}
              </a>
              {p.phone && (
                <a href={`tel:${p.phone.replace(/[^+0-9]/g, '')}`} className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 font-medium text-success hover:bg-success/20">
                  <Phone className="size-3.5" aria-hidden /> {p.phone}
                </a>
              )}
              {p.linkedinUrl && (
                <a href={p.linkedinUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full bg-[#0a66c2]/10 px-2.5 py-1 font-medium text-[#0a66c2] hover:bg-[#0a66c2]/20 dark:text-[#70b5f9]">
                  <Linkedin className="size-3.5" aria-hidden /> LinkedIn
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
