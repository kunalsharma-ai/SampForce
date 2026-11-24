'use client';

import { HelpSupportButton } from '@/components/help/help-panel';
import { useHelpSettings } from '@/lib/help-content';
import { useWorkspaceHelpReader } from '@/lib/support';

/**
 * Help & support in the top bar, at every workspace level (ADR 0073): a labelled button that opens the quick help
 * panel (answers as you type, the Help Center, Explore SampForce, "Other: raise a query" and My queries).
 */
export function HelpMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const settings = useHelpSettings();
  const reader = useWorkspaceHelpReader();
  // The Super Workspace may hide the button; Help & support stays in the account menu, so queries are never cut off.
  if (settings.data && (!settings.data.menuVisible || !settings.data.helpEnabled)) return null;
  return <HelpSupportButton reader={reader} onShortcuts={onShortcuts} />;
}
