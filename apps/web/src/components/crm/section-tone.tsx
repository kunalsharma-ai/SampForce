'use client';

import { cn } from '@dealflow/ui';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';
import { stageStyle } from './stage-chip';
import './section-tone.css';

/**
 * Gives the panel inside it its own colour, a medallion icon on its top edge and some depth (section-tone.css).
 * The panel stays exactly as it is; a panel that renders nothing leaves only an empty wrapper, which is hidden.
 */
export function SectionTone({ color, second, icon: Icon, name, children, className }: { color: string; second?: string; icon: LucideIcon; name: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('sf-tone empty:hidden [&:not(:has(>.df-card,>section,>div:not(.sf-tone-medal)))]:hidden', className)} style={{ ...stageStyle(color), ...(second ? { '--tone-b': second } : {}) } as React.CSSProperties} data-tone={name}>
      <span aria-hidden className="sf-tone-medal">
        <Icon className="size-4" />
      </span>
      {children}
    </div>
  );
}
