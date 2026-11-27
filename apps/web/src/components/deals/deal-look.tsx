'use client';

import type { StageRow } from '@dealflow/types';
import { cn } from '@dealflow/ui';
import {
  BadgeCheck,
  CircleX,
  ClipboardList,
  FileText,
  Handshake,
  type LucideIcon,
  MessagesSquare,
  Presentation,
  ScanSearch,
  Sparkles,
  Target,
  Trophy,
  UserPlus,
} from 'lucide-react';
import type * as React from 'react';
import { stageStyle } from '@/components/crm/stage-chip';
import './deals.css';

/*
 * The Deals redesign's look (ADR 0096): every stage gets its own colour and icon, and icons are drawn as small raised
 * "3D" tiles. Colours follow a fixed categorical order (never cycled by rank), won is green and lost is red, and
 * stageStyle turns each into tints that keep text at 4.5:1 in light and dark. Colour is never the only signal: each
 * stage also has its name and icon.
 */

/** Open stages take these in order; a pipeline has at most 20 stages, so later ones repeat the order. */
const OPEN_COLOURS = ['#257de0', '#f47230', '#00b894', '#f2a600', '#ee7fac', '#6a4ce2', '#0e9fb5', '#c2410c'];
export const WON_COLOUR = '#008a17';
export const LOST_COLOUR = '#ec4647';

export function dealStageColour(stage: Pick<StageRow, 'category'>, openIndex: number): string {
  if (stage.category === 'WON') return WON_COLOUR;
  if (stage.category === 'LOST') return LOST_COLOUR;
  return OPEN_COLOURS[openIndex % OPEN_COLOURS.length]!;
}

/** Colour per stage id for a pipeline's stages in order. */
export function stageColours(stages: Pick<StageRow, 'id' | 'category'>[]): Map<string, string> {
  let open = 0;
  return new Map(stages.map((s) => [s.id, dealStageColour(s, s.category === 'OPEN' ? open++ : 0)]));
}

const BY_WORD: [RegExp, LucideIcon][] = [
  [/new|lead|prospect|inbound|contact/i, UserPlus],
  [/qualif|discover|research|review/i, ScanSearch],
  [/meet|call|demo|present/i, Presentation],
  [/discuss|talk|follow/i, MessagesSquare],
  [/propos|quote|offer|bid|rfq/i, FileText],
  [/negotia|contract|commit|terms/i, Handshake],
  [/approv|verbal|decision/i, BadgeCheck],
  [/plan|scope|brief/i, ClipboardList],
];
const FALLBACK: LucideIcon[] = [Sparkles, ScanSearch, FileText, Handshake, Target, Presentation];

/** An icon that fits the stage's name; won is a trophy and lost a cross. */
export function dealStageIcon(stage: Pick<StageRow, 'name' | 'category' | 'position'>): LucideIcon {
  if (stage.category === 'WON') return Trophy;
  if (stage.category === 'LOST') return CircleX;
  return BY_WORD.find(([re]) => re.test(stage.name))?.[1] ?? FALLBACK[stage.position % FALLBACK.length]!;
}

/** A raised, glossy icon tile in the given colour. Decorative: pair it with a visible label. */
export function Icon3D({ icon: Icon, colour, size = 'md', className }: { icon: LucideIcon; colour: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <span aria-hidden className={cn('sf-i3d', `sf-i3d-${size}`, className)} style={stageStyle(colour)}>
      <Icon />
    </span>
  );
}

/** Puts the stage colour's tints on an element (for column heads, chips and bars). */
export const tone = (colour: string): React.CSSProperties => stageStyle(colour);
