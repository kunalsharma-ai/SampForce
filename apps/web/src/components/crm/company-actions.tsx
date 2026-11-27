'use client';

import * as React from 'react';

/**
 * Quick actions in the company header (ADR 0060, Phase 3). Each card on the company page registers the actions it
 * can run, such as opening its dialog, and the header buttons call them. Without the provider, nothing is registered.
 */
export type CompanyAction =
  | 'edit'
  | 'addEmployee'
  | 'addBranch'
  | 'addFollowUp'
  | 'scheduleCall'
  | 'logInteraction'
  | 'addRfq'
  | 'upload'
  | 'changeStatus'
  | 'transfer'
  | 'requestTransfer'
  | 'raiseConcern'
  | 'enrich'
  | 'aiEmail';

type Registry = Map<CompanyAction, () => void>;
const Ctx = React.createContext<{ registry: Registry; version: number; bump: () => void } | null>(null);

export function CompanyActionsProvider({ children }: { children: React.ReactNode }) {
  const registry = React.useRef<Registry>(new Map()).current;
  const [version, setVersion] = React.useState(0);
  const value = React.useMemo(() => ({ registry, version, bump: () => setVersion((v) => v + 1) }), [registry, version]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Registers `run` for `action` while the calling component is mounted. */
export function useCompanyAction(action: CompanyAction, run: (() => void) | null) {
  const ctx = React.useContext(Ctx);
  const ref = React.useRef(run);
  ref.current = run;
  const enabled = !!run;
  React.useEffect(() => {
    if (!ctx || !enabled) return;
    const fn = () => ref.current?.();
    ctx.registry.set(action, fn);
    ctx.bump();
    return () => {
      if (ctx.registry.get(action) === fn) ctx.registry.delete(action);
      ctx.bump();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ctx.bump changes with every registration
  }, [action, enabled, ctx?.registry]);
}

/** The actions available right now, and a way to run one. */
export function useCompanyActions(): { has: (a: CompanyAction) => boolean; run: (a: CompanyAction) => void } {
  const ctx = React.useContext(Ctx);
  return React.useMemo(
    () => ({ has: (a: CompanyAction) => !!ctx?.registry.has(a), run: (a: CompanyAction) => ctx?.registry.get(a)?.() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- version tracks registry changes
    [ctx?.version],
  );
}

/** Scrolls a section into view and focuses the first control inside it. */
export function focusSection(id: string, selector = 'button, select, input, a') {
  const el = document.getElementById(id);
  if (!el) return;
  // A section under "More about this company" opens it first.
  const more = el.closest('details');
  if (more && !more.open) more.open = true;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  (el.querySelector(selector) as HTMLElement | null)?.focus({ preventScroll: true });
}
