'use client';

import type { BirthdayPerson, TodayBirthdays } from '@dealflow/types';
import { Button } from '@dealflow/ui';
import { useQuery } from '@tanstack/react-query';
import { Check, PartyPopper, Send } from 'lucide-react';
import * as React from 'react';
import { UserAvatar } from '@/components/people/user-avatar';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import './birthday-celebration.css';

/** The reader's own local date (YYYY-MM-DD): birthdays follow the person's clock, not the server's. */
function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const firstName = (name: string) => name.split(/\s+/)[0] || name;

/** Confetti pieces: fixed positions and colours so the server and browser draw the same thing. */
const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 7) % 20) / 10,
  colour: ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'][i % 7]!,
  tilt: (i * 53) % 360,
  round: i % 3 === 0,
}));

function readSent(key: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Today's birthdays under the welcome banner (ADR 0087): on someone's birthday, everyone in the organisation sees a
 * celebration with their photo, confetti and a button that sends them wishes in team chat. On your own birthday it
 * wishes you happy birthday. Nothing shows on a day without birthdays. The Console passes its own list and no wishes.
 */
export function BirthdayCelebration({ path = '/people/birthdays', wishes = true }: { path?: string; wishes?: boolean }) {
  const t = useT();
  const [date, setDate] = React.useState<string | null>(null);
  const [burst, setBurst] = React.useState(0);
  React.useEffect(() => {
    setDate(localDate());
    // Past midnight the list is for the new day.
    const id = setInterval(() => setDate(localDate()), 60_000);
    return () => clearInterval(id);
  }, []);
  const q = useQuery({
    queryKey: ['birthdays', path, date],
    queryFn: () => api<TodayBirthdays>(`${path}?date=${date}`),
    enabled: !!date,
    staleTime: 10 * 60_000,
  });
  const people = q.data?.date === date ? (q.data?.people ?? []) : [];
  if (!people.length) return null;
  const me = people.find((p) => p.self);
  const others = people.filter((p) => !p.self);
  const names = (list: BirthdayPerson[]) => list.map((p) => p.name).join(', ');

  let title: string;
  let line: string;
  if (me) {
    title = t('Happy birthday, {name}!', { name: firstName(me.name) });
    line = me.age ? t('You turn {age} today. Wishing you a wonderful year ahead, from all of us.', { age: me.age }) : t('Wishing you a wonderful year ahead, from all of us.');
  } else if (others.length === 1) {
    const p = others[0]!;
    title = t("It's {name}'s birthday today!", { name: p.name });
    line = p.age ? t('{name} turns {age} today. Send your wishes and make the day special.', { name: firstName(p.name), age: p.age }) : t('Send your wishes and make the day special.');
  } else {
    title = t('{count} birthdays today!', { count: others.length });
    line = t('Celebrating {names}. Send your wishes and make the day special.', { names: names(others) });
  }

  return (
    <section className="sf-bday" aria-labelledby="sf-bday-title" data-birthdays={people.length} data-birthday-self={me ? 'yes' : 'no'}>
      <div aria-hidden className="sf-bday-confetti" key={burst}>
        {CONFETTI.map((c, i) => (
          <span key={i} style={{ left: `${c.left}%`, animationDelay: `${c.delay}s`, background: c.colour, rotate: `${c.tilt}deg`, borderRadius: c.round ? '999px' : '2px' }} />
        ))}
      </div>
      <span aria-hidden className="sf-bday-balloons">
        🎈🎈
      </span>
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-center">
          <span aria-hidden className="sf-bday-cake">
            🎂
          </span>
          <ul className="-ms-3 flex" aria-label={t('Birthdays today')}>
            {people.slice(0, 4).map((p, i) => (
              <li key={p.id} className="sf-bday-face" style={{ zIndex: 10 - i }} data-birthday-person={p.id}>
                <UserAvatar userId={p.self ? undefined : p.id} name={p.name} photoUrl={p.photoUrl} showMood={false} className="size-14 text-base ring-4 ring-surface" />
                <span className="sr-only">{p.name}</span>
              </li>
            ))}
            {people.length > 4 && <li className="sf-bday-more">+{people.length - 4}</li>}
          </ul>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-muted-foreground">{t('Birthday celebration')}</p>
          <h2 id="sf-bday-title" className="sf-bday-title" data-birthday-title>
            {title}
          </h2>
          <p className="text-sm text-muted-foreground" data-birthday-line>
            {line}
          </p>
          {me && others.length > 0 && (
            <p className="text-sm font-medium" data-birthday-also>
              {t('Also celebrating today: {names}', { names: names(others) })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {wishes && others.slice(0, 3).map((p) => <WishButton key={p.id} person={p} date={date!} />)}
          <Button type="button" variant="outline" size="sm" className="bg-surface/70" onClick={() => setBurst((b) => b + 1)}>
            <PartyPopper aria-hidden /> {t('Celebrate')}
          </Button>
        </div>
      </div>
    </section>
  );
}

/** Sends "Happy birthday" to the person in a team chat message, once a day. */
function WishButton({ person, date }: { person: BirthdayPerson; date: string }) {
  const t = useT();
  const storeKey = `sf.birthdayWishes.${date}`;
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setSent(readSent(storeKey).includes(person.id)), [storeKey, person.id]);
  const send = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const conv = await api<{ id: string }>('/chat/conversations', { method: 'POST', json: { kind: 'DIRECT', userId: person.id } });
      const body = t('Happy birthday, {name}! 🎂🎉 Wishing you a wonderful year ahead.', { name: firstName(person.name) });
      await api(`/chat/conversations/${conv.id}/messages`, { method: 'POST', json: { clientId: crypto.randomUUID(), body } });
      setSent(true);
      try {
        localStorage.setItem(storeKey, JSON.stringify([...readSent(storeKey), person.id]));
      } catch {
        /* Remembering is a convenience only. */
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  if (sent)
    return (
      <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success/15 px-3 text-sm font-medium text-success" data-wishes-sent={person.id}>
        <Check className="size-4" aria-hidden /> {t('Wishes sent to {name}', { name: firstName(person.name) })}
      </span>
    );
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size="sm" disabled={busy} onClick={() => void send()} data-wish={person.id}>
        <Send aria-hidden /> {t('Wish {name}', { name: firstName(person.name) })}
      </Button>
      {failed && (
        <span role="alert" className="text-xs text-destructive">
          {t('Your wishes could not be sent. Try again.')}
        </span>
      )}
    </span>
  );
}
