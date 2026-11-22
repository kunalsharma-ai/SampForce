'use client';

import { GUIDE_CATEGORY } from '@dealflow/help';
import { usePathname } from 'next/navigation';
import { InfoTip } from '@/components/info-tip';
import { helpForPath } from '@/lib/help';

/**
 * The page's own "i" button, chosen from the current route (lib/help PAGE_HELP). Renders nothing on a route without
 * one. A page with a feature guide links to it in the Help Center, so every module has its full guide one click away.
 */
export function PageHelp({ className }: { className?: string }) {
  const path = usePathname() ?? '';
  const topic = helpForPath(path);
  if (!topic) return null;
  const center = path.startsWith('/operator') ? '/operator/help' : path.startsWith('/app') ? '/app/help' : null;
  const onHelp = path === '/app/help' || path.startsWith('/app/help/') || path.startsWith('/operator/help');
  const guideHref = center && !onHelp && GUIDE_CATEGORY[topic as keyof typeof GUIDE_CATEGORY] ? `${center}?guide=${encodeURIComponent(topic)}` : undefined;
  return <InfoTip topic={topic} className={className} guideHref={guideHref} />;
}
