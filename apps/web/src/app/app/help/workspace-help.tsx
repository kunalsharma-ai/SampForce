'use client';

import { HelpCenter } from '@/components/help/help-center';
import { useWorkspaceHelpReader } from '@/lib/support';

/** The Help Center in a workspace: answers and guides for the person's plan, workspace level and role (ADR 0073). */
export function WorkspaceHelpCenter() {
  return <HelpCenter reader={useWorkspaceHelpReader()} queriesHref="/app/help/queries" />;
}
