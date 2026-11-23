'use client';

import { HelpCenter } from '@/components/help/help-center';
import { useCan, useSession } from '@/lib/session';
import { useWorkspaceHelpReader } from '@/lib/support';

/** The Help Center in a workspace: answers and guides for the person's plan, workspace level and role (ADR 0073). */
export function WorkspaceHelpCenter() {
  const { data: me } = useSession();
  const canBill = useCan('billing:manage');
  return (
    <HelpCenter
      reader={useWorkspaceHelpReader()}
      queriesHref="/app/help/queries"
      currentPlan={me?.tenant.appliedPlan ?? null}
      billingHref={canBill ? '/app/billing' : null}
    />
  );
}
