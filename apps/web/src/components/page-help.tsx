'use client';

import { usePathname } from 'next/navigation';
import { InfoTip } from '@/components/info-tip';
import { helpForPath } from '@/lib/help';

/** The page's own "i" button, chosen from the current route (lib/help PAGE_HELP). Renders nothing on a route without one. */
export function PageHelp({ className }: { className?: string }) {
  const topic = helpForPath(usePathname() ?? '');
  return topic ? <InfoTip topic={topic} className={className} /> : null;
}
