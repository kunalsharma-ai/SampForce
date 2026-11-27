'use client';

import { PROFILE_COVERS, PROFILE_TAGS_MAX, type MyProfile, type MyProfileInput, type ProfileCover } from '@dealflow/types';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, cn, Field, Input, Skeleton } from '@dealflow/ui';
import { Cake, Camera, Check, Linkedin, Mail, Phone, Quote, Smile, Sparkles, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import * as React from 'react';
import { Textarea } from '@/components/crm/select';
import { MoodPicker } from '@/components/people/mood-picker';
import { PhotoEditor } from '@/components/people/photo-editor';
import { COVERS, UserAvatar } from '@/components/people/user-avatar';
import { PageHelp } from '@/components/page-help';
import { ApiError } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { useMyProfile, useSaveProfile } from '@/lib/people';

type Draft = Required<Pick<MyProfileInput, 'name' | 'cover' | 'tags'>> & {
  phone: string;
  headline: string;
  quote: string;
  bio: string;
  linkedinUrl: string;
  /** Date of birth as typed: day and month numbers as text, the year optional. */
  bDay: string;
  bMonth: string;
  bYear: string;
  birthYearVisible: boolean;
  celebrateBirthday: boolean;
};

const draftOf = (p: MyProfile): Draft => ({
  name: p.name,
  phone: p.phone ?? '',
  headline: p.headline ?? '',
  quote: p.quote ?? '',
  bio: p.bio ?? '',
  linkedinUrl: p.linkedinUrl ?? '',
  cover: p.cover,
  tags: p.tags,
  bDay: p.birthday ? String(p.birthday.day) : '',
  bMonth: p.birthday ? String(p.birthday.month) : '',
  bYear: p.birthday?.year ? String(p.birthday.year) : '',
  birthYearVisible: p.birthYearVisible,
  celebrateBirthday: p.celebrateBirthday,
});

/** The birthday to save: none until both day and month are chosen. */
const birthdayOf = (d: Draft): MyProfileInput['birthday'] =>
  d.bDay && d.bMonth ? { day: Number(d.bDay), month: Number(d.bMonth), year: d.bYear.trim() ? Number(d.bYear) : null } : null;

/** Quotes to start from, for anyone stuck on a blank box. */
const QUOTE_IDEAS = ['Every no brings you closer to a yes.', 'Listen more than you talk.', 'Small wins, every single day.', 'Curious about people, serious about results.'];

/**
 * My profile (ADR 0087): the person's photo, cover, mood, headline, quote, bio, contact details and "ask me about"
 * tags, with a live preview of the card teammates see.
 */
export function MyProfilePage() {
  const t = useT();
  const q = useMyProfile();
  const save = useSaveProfile();
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [photoOpen, setPhotoOpen] = React.useState(false);
  const [moodOpen, setMoodOpen] = React.useState(false);
  const [tagInput, setTagInput] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => {
    if (q.data && !draft) setDraft(draftOf(q.data));
  }, [q.data, draft]);

  // "Set your mood" in the account menu opens this page with ?mood=1.
  const params = useSearchParams();
  const router = useRouter();
  React.useEffect(() => {
    if (params.get('mood') !== '1') return;
    setMoodOpen(true);
    router.replace('/app/profile', { scroll: false });
  }, [params, router]);

  if (!q.data || !draft) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-52 w-full rounded-3xl" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  const p = q.data;
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(p));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [k]: v });
  };
  const addTag = () => {
    const v = tagInput.trim().slice(0, 24);
    if (!v || draft.tags.length >= PROFILE_TAGS_MAX || draft.tags.some((x) => x.toLowerCase() === v.toLowerCase())) return setTagInput('');
    set('tags', [...draft.tags, v]);
    setTagInput('');
  };
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    save.mutate(
      {
        name: draft.name,
        phone: draft.phone,
        headline: draft.headline,
        quote: draft.quote,
        bio: draft.bio,
        linkedinUrl: draft.linkedinUrl,
        cover: draft.cover,
        tags: draft.tags,
        birthday: birthdayOf(draft),
        birthYearVisible: draft.birthYearVisible,
        celebrateBirthday: draft.celebrateBirthday,
      },
      {
        onSuccess: (next) => {
          setDraft(draftOf(next));
          setSaved(true);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.details?.length) setErrors(Object.fromEntries(err.details.map((d) => [d.path.split('.')[0]!, t.maybe(d.message)])));
          else setErrors({ form: err instanceof ApiError ? err.message : t('Your profile could not be saved. Try again.') });
        },
      },
    );
  };
  const steps: { done: boolean; label: string }[] = [
    { done: !!p.photoUrl, label: t('Add a photo') },
    { done: !!p.mood, label: t('Set your mood') },
    { done: !!p.headline, label: t('Write a headline') },
    { done: !!p.quote, label: t('Pick a quote') },
    { done: !!p.bio, label: t('Tell your story') },
    { done: !!p.phone, label: t('Add your phone') },
    { done: !!p.linkedinUrl, label: t('Link LinkedIn') },
    { done: p.tags.length > 0, label: t('Add what to ask you about') },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero: cover, photo, mood and name. */}
      <section data-profile-hero className="relative overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
        <div className="relative h-36 sm:h-44" style={{ background: COVERS[draft.cover].css }}>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_20%,rgba(255,255,255,0.35),transparent_45%)]" />
          <div className="absolute end-3 top-3 flex items-center gap-1.5 rounded-full bg-black/25 p-1 backdrop-blur" role="radiogroup" aria-label={t('Cover')}>
            {PROFILE_COVERS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={draft.cover === c}
                aria-label={t.maybe(COVERS[c].label)}
                title={t.maybe(COVERS[c].label)}
                onClick={() => set('cover', c as ProfileCover)}
                className={cn('size-6 rounded-full ring-2 transition-transform hover:scale-110', draft.cover === c ? 'ring-white' : 'ring-white/30')}
                style={{ background: COVERS[c].css }}
              />
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <div className="relative -mt-14 shrink-0 self-start sm:-mt-16">
            <UserAvatar userId={p.userId} name={p.name} photoUrl={p.photoUrl} showMood={false} className="size-28 text-3xl ring-4 sm:size-32" />
            <button
              type="button"
              onClick={() => setPhotoOpen(true)}
              aria-label={p.photoUrl ? t('Change photo') : t('Add a photo')}
              className="absolute bottom-1 end-1 grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-surface transition-transform hover:scale-110"
            >
              <Camera className="size-4" aria-hidden />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{draft.name || p.name}</h1>
              <PageHelp />
            </div>
            <p className="truncate text-sm text-muted-foreground">{draft.headline || t('Add a headline so people know what you do')}</p>
          </div>
          <button
            type="button"
            data-mood-button
            onClick={() => setMoodOpen(true)}
            className="group inline-flex max-w-full items-center gap-2 self-start rounded-full border border-border bg-gradient-to-r from-primary/10 via-accent/10 to-transparent px-3 py-2 text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md sm:self-auto"
          >
            {p.mood ? (
              <>
                <span className="text-xl leading-none transition-transform group-hover:scale-125">{p.mood.emoji}</span>
                <span className="max-w-[14rem] truncate">{p.mood.text ? t.maybe(p.mood.text) : t('Current mood')}</span>
              </>
            ) : (
              <>
                <Smile className="size-5 text-primary" aria-hidden />
                <span>{t('Set your mood')}</span>
              </>
            )}
          </button>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <form onSubmit={submit} className="space-y-6" aria-label={t('My profile')}>
          <Card>
            <CardHeader>
              <CardTitle>{t('About you')}</CardTitle>
              <CardDescription>{t('A few words that help teammates and new joiners get to know you.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field id="profile-name" label={t('Name')} error={errors.name}>
                <Input value={draft.name} maxLength={120} onChange={(e) => set('name', e.target.value)} required />
              </Field>
              <Field id="profile-headline" label={t('Headline')} hint={t('{count} of {max} characters', { count: draft.headline.length, max: 80 })} error={errors.headline}>
                <Input value={draft.headline} maxLength={80} placeholder={t('For example: Helping healthcare brands find the right respondents')} onChange={(e) => set('headline', e.target.value)} />
              </Field>
              <div className="space-y-2">
                <Field id="profile-quote" label={t('Favourite quote')} hint={t('{count} of {max} characters', { count: draft.quote.length, max: 160 })} error={errors.quote}>
                  <Input value={draft.quote} maxLength={160} placeholder={t('The line that keeps you going')} onChange={(e) => set('quote', e.target.value)} />
                </Field>
                {!draft.quote && (
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <Sparkles className="size-3.5 text-primary" aria-hidden />
                    {QUOTE_IDEAS.map((idea) => (
                      <button key={idea} type="button" onClick={() => set('quote', t.maybe(idea))} className="rounded-full border border-border px-2 py-0.5 text-muted-foreground hover:border-primary hover:text-primary">
                        {t.maybe(idea)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Field id="profile-bio" label={t('Bio')} hint={t('{count} of {max} characters', { count: draft.bio.length, max: 600 })} error={errors.bio}>
                <Textarea value={draft.bio} maxLength={600} rows={4} placeholder={t('Where you have worked, what you love about the job, something fun about you')} onChange={(e) => set('bio', e.target.value)} />
              </Field>
              <div className="space-y-2">
                <label htmlFor="profile-tag" className="text-sm font-medium">
                  {t('Ask me about')}
                </label>
                <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background p-1.5">
                  {draft.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pe-1 ps-2.5 text-xs font-medium text-primary">
                      {tag}
                      <button type="button" aria-label={t('Remove {name}', { name: tag })} onClick={() => set('tags', draft.tags.filter((x) => x !== tag))} className="rounded-full p-0.5 hover:bg-primary/20">
                        <X className="size-3" aria-hidden />
                      </button>
                    </span>
                  ))}
                  {draft.tags.length < PROFILE_TAGS_MAX && (
                    <input
                      id="profile-tag"
                      value={tagInput}
                      maxLength={24}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ',') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      onBlur={addTag}
                      placeholder={draft.tags.length ? '' : t('Type a topic and press Enter, such as Healthcare panels')}
                      className="min-w-[10rem] flex-1 bg-transparent px-1 py-1 text-sm outline-none"
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t('Up to {count} topics you know well or love talking about.', { count: PROFILE_TAGS_MAX })}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('Contact details')}</CardTitle>
              <CardDescription>{t('People in your organisation can reach you from your profile card.')}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field id="profile-email" label={t('Email')} hint={t('Your sign-in email. It changes only with your account.')}>
                <Input value={p.email} readOnly className="bg-muted/50" />
              </Field>
              <Field id="profile-phone" label={t('Phone')} error={errors.phone}>
                <Input value={draft.phone} type="tel" maxLength={24} placeholder="+971 50 123 4567" onChange={(e) => set('phone', e.target.value)} />
              </Field>
              <div className="sm:col-span-2">
                <Field id="profile-linkedin" label={t('LinkedIn')} error={errors.linkedinUrl}>
                  <Input value={draft.linkedinUrl} maxLength={300} placeholder="linkedin.com/in/your-name" onChange={(e) => set('linkedinUrl', e.target.value)} />
                </Field>
              </div>
            </CardContent>
          </Card>

          <BirthdayCard draft={draft} set={set} error={errors.birthday} />

          {errors.form && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-2xl border border-border bg-surface/90 p-3 shadow-lg backdrop-blur">
            {saved && !dirty && (
              <span role="status" className="inline-flex items-center gap-1 text-sm text-success">
                <Check className="size-4" aria-hidden /> {t('Profile saved')}
              </span>
            )}
            <Button type="button" variant="outline" disabled={!dirty || save.isPending} onClick={() => setDraft(draftOf(p))}>
              {t('Undo changes')}
            </Button>
            <Button type="submit" disabled={!dirty || save.isPending}>
              {save.isPending ? t('Saving…') : t('Save profile')}
            </Button>
          </div>
        </form>

        <aside className="space-y-6">
          <Card data-profile-completeness>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <Ring value={p.completeness} />
                <div>
                  <p className="font-semibold">{p.completeness === 100 ? t('Your profile shines!') : t('Complete your profile')}</p>
                  <p className="text-xs text-muted-foreground">{t('{done} of {total} done', { done: steps.filter((s) => s.done).length, total: steps.length })}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-sm">
                {steps.map((s) => (
                  <li key={s.label} className={cn('flex items-center gap-2', s.done && 'text-muted-foreground line-through')}>
                    <span className={cn('grid size-4 place-items-center rounded-full', s.done ? 'bg-success text-white' : 'border border-border')}>{s.done && <Check className="size-3" aria-hidden />}</span>
                    {s.label}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('How teammates see you')}</p>
            <div data-profile-preview className="overflow-hidden rounded-2xl border border-border bg-popover shadow-lg">
              <div className="h-16" style={{ background: COVERS[draft.cover].css }} />
              <div className="-mt-8 px-4 pb-4">
                <UserAvatar userId={p.userId} name={draft.name} photoUrl={p.photoUrl} showMood={false} className="size-16 text-lg ring-4" />
                <p className="mt-2 font-semibold">{draft.name}</p>
                {draft.headline && <p className="text-sm text-muted-foreground">{draft.headline}</p>}
                {p.mood && (
                  <p className="mt-2 inline-flex items-center gap-2 rounded-2xl bg-muted px-3 py-1 text-sm">
                    <span className="text-base">{p.mood.emoji}</span>
                    {p.mood.text ? t.maybe(p.mood.text) : t('Current mood')}
                  </p>
                )}
                {draft.quote && (
                  <blockquote className="mt-2 flex gap-1.5 text-sm italic">
                    <Quote className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                    {draft.quote}
                  </blockquote>
                )}
                {draft.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {draft.tags.map((tag) => (
                      <Badge key={tag} className="rounded-full">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="mt-3 flex flex-wrap gap-1.5 text-muted-foreground">
                  <Mail className="size-4" aria-hidden />
                  {draft.phone && <Phone className="size-4" aria-hidden />}
                  {draft.linkedinUrl && <Linkedin className="size-4" aria-hidden />}
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <PhotoEditor open={photoOpen} onOpenChange={setPhotoOpen} hasPhoto={!!p.photoUrl} />
      <MoodPicker open={moodOpen} onOpenChange={setMoodOpen} current={p.mood} />
    </div>
  );
}

/** The completeness ring. */
function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${value}%`}>
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-muted" />
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" stroke="url(#profile-ring)" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} transform="rotate(-90 32 32)" style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      <defs>
        <linearGradient id="profile-ring" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <text x="32" y="37" textAnchor="middle" className="fill-foreground text-[14px] font-semibold">
        {value}%
      </text>
    </svg>
  );
}

const selectCls = 'h-10 w-full rounded-lg border border-input bg-surface px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Date of birth (ADR 0087): day and month, an optional year, and who sees it. Teammates celebrate it on their dashboards. */
function BirthdayCard({ draft, set, error }: { draft: Draft; set: <K extends keyof Draft>(k: K, v: Draft[K]) => void; error?: string }) {
  const t = useT();
  const months = React.useMemo(() => {
    const f = new Intl.DateTimeFormat(t.formatLocale, { month: 'long', timeZone: 'UTC' });
    return Array.from({ length: 12 }, (_, i) => f.format(new Date(Date.UTC(2024, i, 1))));
  }, [t.formatLocale]);
  const maxDay = draft.bMonth ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(draft.bMonth) - 1]! : 31;
  return (
    <Card data-profile-birthday>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cake className="size-5 text-primary" aria-hidden /> {t('Your birthday')}
        </CardTitle>
        <CardDescription>{t('On your birthday, everyone in your organisation sees a celebration on their dashboard.')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[6rem_1fr_8rem]">
          <Field id="profile-birth-day" label={t('Day')}>
            <select className={selectCls} value={draft.bDay} onChange={(e) => set('bDay', e.target.value)}>
              <option value="">—</option>
              {Array.from({ length: maxDay }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
          </Field>
          <Field id="profile-birth-month" label={t('Month')}>
            <select
              className={selectCls}
              value={draft.bMonth}
              onChange={(e) => {
                set('bMonth', e.target.value);
                const max = e.target.value ? [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][Number(e.target.value) - 1]! : 31;
                if (Number(draft.bDay) > max) set('bDay', String(max));
              }}
            >
              <option value="">—</option>
              {months.map((m, i) => (
                <option key={m} value={String(i + 1)}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field id="profile-birth-year" label={t('Year (optional)')}>
            <Input value={draft.bYear} inputMode="numeric" maxLength={4} placeholder="1990" onChange={(e) => set('bYear', e.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={draft.birthYearVisible} onChange={(e) => set('birthYearVisible', e.target.checked)} />
          <span>
            <span className="block font-medium">{t('Show my birth year and age')}</span>
            <span className="block text-muted-foreground">{t('Off: teammates see only the day and month.')}</span>
          </span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={draft.celebrateBirthday} onChange={(e) => set('celebrateBirthday', e.target.checked)} />
          <span>
            <span className="block font-medium">{t('Celebrate my birthday with my team')}</span>
            <span className="block text-muted-foreground">{t('Off: your birthday stays private and only you see your celebration.')}</span>
          </span>
        </label>
      </CardContent>
    </Card>
  );
}
