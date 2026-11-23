'use client';

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@dealflow/ui';
import { BookOpen, CircleHelp, Inbox, Keyboard, LifeBuoy, MessagesSquare, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useT } from '@/lib/i18n';

/**
 * The Help menu in the top bar, at every workspace level (ADR 0073): the Help Center, its FAQs and feature guide,
 * "Other: raise a query" (which remembers the page you were on) and your queries.
 */
export function HelpMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const t = useT();
  const pathname = usePathname();
  const from = pathname && pathname.startsWith('/app') && !pathname.startsWith('/app/help') ? `&from=${encodeURIComponent(pathname)}` : '';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('top.help')} data-help-menu>
          <CircleHelp aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t('Help')}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/app/help">
            <Search aria-hidden /> {t('Search help')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/help#faqs">
            <MessagesSquare aria-hidden /> {t('Frequently asked questions')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/help#guide">
            <BookOpen aria-hidden /> {t('Feature guide')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onShortcuts}>
          <Keyboard aria-hidden /> {t('top.shortcuts')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={`/app/help?raise=1${from}`} data-menu-raise-query>
            <LifeBuoy aria-hidden /> {t('Other: raise a query')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/app/help/queries">
            <Inbox aria-hidden /> {t('My queries')}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
