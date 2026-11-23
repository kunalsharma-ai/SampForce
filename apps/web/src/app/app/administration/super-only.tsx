'use client';

import type { ReactNode } from 'react';
import { useSession } from '@/lib/session';

/** Organisation-wide settings belong to the Super Workspace (ADR 0071); managers here only read their team's log. */
export function SuperOnly({ children }: { children: ReactNode }) {
  const { data } = useSession();
  if (!data || data.workspace.level !== 'SUPER') return null;
  return <>{children}</>;
}
