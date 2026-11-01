'use client';

import { MAX_PINNED, navKindForPath } from '@dealflow/types';
import { Button, cn, Tooltip, TooltipContent, TooltipTrigger } from '@dealflow/ui';
import { Star } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useNavigation, useTogglePin } from '@/lib/workspace-nav';

/** Stars the current page (a module, a record or a report) so it appears under Favourites in the sidebar. */
export function FavouriteButton() {
  const pathname = usePathname();
  const { nav } = useNavigation();
  const pins = useTogglePin();
  const pinned = pins.isPinned(pathname);
  const full = !pinned && nav.pinned.length >= MAX_PINNED;
  const label = pinned ? 'Remove this page from favourites' : full ? `Favourites are full (${MAX_PINNED})` : 'Add this page to favourites';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={pinned}
          disabled={full || pins.pending}
          onClick={() => {
            const heading = document.querySelector('main h1')?.textContent?.trim() || document.title || 'Page';
            pins.toggle({ href: pathname, label: heading.slice(0, 120), kind: navKindForPath(pathname) });
          }}
        >
          <Star className={cn(pinned && 'fill-warning text-warning')} aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
