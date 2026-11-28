'use client';

import type { AchievementRow } from '@dealflow/types';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACHIEVEMENTS_KEY, claimAchievements, useAchievementSettings } from '@/lib/achievements';
import { CHANGE_EVENT } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CelebrationCard } from './celebration-card';
import { Confetti } from './confetti';
import { sceneFor } from './scenes';
import { playChime } from './sound';

/** How often the host looks for achievements earned elsewhere (another device, a teammate winning your deal). */
const POLL_MS = 30_000;
/** A short wait after a change, so a burst of saves makes one request. */
const AFTER_CHANGE_MS = 500;

/** Browser tests opt in, so celebrations never cover the buttons other tests click. */
function testsOptedOut(): boolean {
  if (typeof navigator === 'undefined' || !navigator.webdriver) return false;
  try {
    return window.localStorage.getItem('sampforce.celebrations.test') !== 'on';
  } catch {
    return true;
  }
}

/** When one change earns several achievements, the event itself shows first and the biggest milestone last. */
const ORDER: AchievementRow['kind'][] = [
  'DEAL_CONVERTED', 'PROSPECT_CONVERTED', 'RFQ_SUBMITTED', 'TASK_IMPORTANT', 'TASK_PLAN_HALF', 'LEAD_MILESTONE', 'ALL_TASKS_DONE', 'TASK_PLAN_DONE',
  'LEAD_TARGET', 'CONSISTENCY', 'SALES_TARGET', 'DEALS_WON_MILESTONE', 'MAJOR_DEAL',
  'PIP_COMPLETED', 'RECOGNITION_ELIGIBLE', 'EMPLOYEE_OF_THE_MONTH',
];
const rank = (a: AchievementRow) => ORDER.indexOf(a.kind);

/** A dialog the person is working in (outside the host): the celebration waits until it closes, so it never interrupts. */
function dialogOpen(): boolean {
  for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    if (!el.closest('[data-celebration-host]') && el.getClientRects().length > 0) return true;
  }
  return false;
}

/** Reduced motion from the system (unless SampForce's Motion setting is Full) or from SampForce's Motion setting. */
function systemReducesMotion(): boolean {
  const motion = document.documentElement.dataset.motion;
  if (motion === 'off' || motion === 'minimal') return true;
  return motion !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Plays celebrations for real achievements (ADR 0090). After every change the person makes, and every half minute
 * while the tab is visible, it claims what the API recorded; the API hands each achievement to one tab once, so a
 * refresh never replays it. One celebration shows at a time, never takes the focus, closes by itself, and sits clear
 * of the header, the navigation and the chat notices. It waits while a dialog is open. Escape or the close button
 * dismisses it.
 */
export function CelebrationHost() {
  const t = useT();
  const qc = useQueryClient();
  const settings = useAchievementSettings();
  const [queue, setQueue] = useState<AchievementRow[]>([]);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [waiting, setWaiting] = useState(false);
  const head = queue[0] ?? null;
  const current = waiting ? null : head;

  const claim = useCallback(async () => {
    if (busy.current || document.visibilityState === 'hidden' || testsOptedOut()) return;
    busy.current = true;
    try {
      const got = await claimAchievements();
      if (got.length) {
        const fresh = (q: AchievementRow[]) => got.filter((g) => !q.some((x) => x.id === g.id)).sort((a, b) => rank(a) - rank(b) || a.achievedAt.localeCompare(b.achievedAt));
        setQueue((q) => [...q, ...fresh(q)]);
        void qc.invalidateQueries({ queryKey: ACHIEVEMENTS_KEY });
      }
    } catch {
      // Celebrations never get in the way: a failed claim is tried again later.
    } finally {
      busy.current = false;
    }
  }, [qc]);

  useEffect(() => {
    const soon = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void claim(), AFTER_CHANGE_MS);
    };
    const visible = () => document.visibilityState === 'visible' && soon();
    window.addEventListener(CHANGE_EVENT, soon);
    document.addEventListener('visibilitychange', visible);
    const poll = setInterval(() => void claim(), POLL_MS);
    soon();
    return () => {
      window.removeEventListener(CHANGE_EVENT, soon);
      document.removeEventListener('visibilitychange', visible);
      clearInterval(poll);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [claim]);

  // While something waits to be shown, look every half second for an open dialog.
  useEffect(() => {
    if (!head) return;
    const check = () => setWaiting(dialogOpen());
    check();
    const id = setInterval(check, 400);
    return () => clearInterval(id);
  }, [head]);

  const next = useCallback(() => setQueue((q) => q.slice(1)), []);
  const s = settings.data;
  const subtle = s?.style === 'SUBTLE';
  const still = !!s?.reduceMotion || (typeof window !== 'undefined' && systemReducesMotion());
  const base = current ? sceneFor(current) : null;
  // Subtle: no confetti and no full-screen stage, and a little shorter.
  const scene = base && subtle ? { ...base, confetti: null, layout: base.layout === 'stage' ? ('card' as const) : base.layout, ms: Math.round(base.ms * 0.75) } : base;

  // Hovering or focusing the card pauses its timer, so nobody loses it while reading.
  const [paused, setPaused] = useState(false);
  const remaining = useRef(0);
  useEffect(() => {
    if (!current || !scene) return;
    remaining.current = scene.ms;
    setPaused(false);
    if (s?.sound) playChime(current.level);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && next();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Runs once per achievement shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);
  useEffect(() => {
    if (!current || paused) return;
    const started = Date.now();
    const id = setTimeout(next, Math.max(500, remaining.current));
    return () => {
      clearTimeout(id);
      remaining.current -= Date.now() - started;
    };
  }, [current, paused, next]);
  const hold = { onPointerEnter: () => setPaused(true), onPointerLeave: () => setPaused(false), onFocus: () => setPaused(true), onBlur: () => setPaused(false) };

  if (!current || !scene) return null;
  const card = (
    <div {...hold} className="pointer-events-auto">
      <CelebrationCard key={current.id} a={current} scene={scene} still={still} onClose={next} ms={still ? undefined : scene.ms} />
    </div>
  );
  const confetti = scene.confetti && !still ? <Confetti key={`c-${current.id}`} style={scene.confetti} colors={scene.colors} origin={scene.layout === 'stage' ? { x: 0.5, y: 0.55 } : { x: 0.5, y: 0.9 }} /> : null;

  return (
    <div role="status" aria-live="polite" aria-label={t('Celebration')} data-celebration-host>
      {scene.layout === 'stage' ? (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          {/* The veil is a click target: one click anywhere outside the card closes it. */}
          <button type="button" tabIndex={-1} aria-hidden onClick={next} className="sfc-veil absolute inset-0 cursor-default overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(30,27,75,0.78),rgba(8,6,20,0.88))]">
            <span className="sfc-aurora absolute -inset-1/4 bg-[conic-gradient(from_200deg_at_50%_50%,rgba(167,139,250,0.35),rgba(240,171,252,0.25),rgba(103,232,249,0.3),rgba(167,139,250,0.35))] blur-3xl" />
          </button>
          <div className="relative">{card}</div>
        </div>
      ) : (
        <div className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-[60] flex justify-center px-4 lg:bottom-6 lg:top-auto">{card}</div>
      )}
      {confetti}
    </div>
  );
}
