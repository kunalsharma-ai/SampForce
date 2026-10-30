# ADR 0006: Next.js App Router, Tailwind + Radix, TanStack Query, Motion

**Status:** accepted (2026-10-30)

**Decision.** Next.js 15 (App Router) for the CRM app; Tailwind CSS 3 with CSS-variable design tokens;
Radix primitives with shadcn/ui conventions in `packages/ui`; TanStack Query for server state; Zustand for
UI preferences; React Hook Form + Zod; Recharts for 2D charts; Motion for transitions; React Three Fiber for
Phase 7 3D islands.

**Why.** Accessible primitives by default, themeable tokens (dark/light/tenant brand), and a clear split
between server state and UI state. 3D stays an optional, lazily loaded layer.

**Consequences.** Next.js 16 and Tailwind 4 upgrades are deferred until after Phase 2 to avoid churn.
