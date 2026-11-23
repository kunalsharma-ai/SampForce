import { z } from 'zod';
import { type Appearance, COLOR_MODES, DEFAULT_APPEARANCE, type ThemeId } from './appearance';

/**
 * The Console Admin's shell (ADR 0074): the colour palette, colour mode, sidebar and sound each operator picks, and the
 * global search across clients, people, workspaces, invoices, tickets and plans. The palettes are themes of the
 * workspace theme engine (ADR 0040) with Console overrides, so the Console paints with the same tokens and checks.
 */

export const CONSOLE_PALETTES = [
  'professional_blue',
  'indigo_violet',
  'emerald',
  'dark_enterprise',
  'modern_cyan',
  'neutral_minimal',
] as const;
export type ConsolePalette = (typeof CONSOLE_PALETTES)[number];

export interface ConsolePaletteDef {
  id: ConsolePalette;
  name: string;
  description: string;
  /** The theme engine theme the palette starts from, and the colours it replaces. */
  themeId: ThemeId;
  primary: string | null;
  accent: string | null;
  /** Shown in the picker: the colours a person recognises the palette by. */
  swatch: [string, string, string];
}

export const CONSOLE_PALETTE_DEFS: ConsolePaletteDef[] = [
  {
    id: 'professional_blue',
    name: 'Professional Blue',
    description: 'Clear blue on slate. The default.',
    themeId: 'arctic',
    primary: null,
    accent: '#06B6D4',
    swatch: ['#2563EB', '#06B6D4', '#0F172A'],
  },
  {
    id: 'indigo_violet',
    name: 'Indigo Violet',
    description: 'Indigo with a violet accent.',
    themeId: 'obsidian',
    primary: '#6366F1',
    accent: '#A855F7',
    swatch: ['#6366F1', '#A855F7', '#111114'],
  },
  {
    id: 'emerald',
    name: 'Emerald',
    description: 'Forest green and lime, calm and steady.',
    themeId: 'emerald',
    primary: null,
    accent: null,
    swatch: ['#15803D', '#84CC16', '#0F2219'],
  },
  {
    id: 'dark_enterprise',
    name: 'Dark Enterprise',
    description: 'Navy control room with amber highlights.',
    themeId: 'sapphire',
    primary: null,
    accent: '#F59E0B',
    swatch: ['#3B82F6', '#F59E0B', '#060D1F'],
  },
  {
    id: 'modern_cyan',
    name: 'Modern Cyan',
    description: 'Graphite with electric cyan.',
    themeId: 'cyber',
    primary: null,
    accent: null,
    swatch: ['#0891B2', '#22D3EE', '#16191C'],
  },
  {
    id: 'neutral_minimal',
    name: 'Neutral Minimal',
    description: 'Quiet greys that keep the data in front.',
    themeId: 'titanium',
    primary: null,
    accent: null,
    swatch: ['#4B5563', '#93C5FD', '#111827'],
  },
];

export const CONSOLE_PALETTE_BY_ID = Object.fromEntries(
  CONSOLE_PALETTE_DEFS.map((p) => [p.id, p]),
) as Record<ConsolePalette, ConsolePaletteDef>;

export const consolePreferencesSchema = z
  .object({
    palette: z.enum(CONSOLE_PALETTES),
    mode: z.enum(COLOR_MODES),
    sidebarCollapsed: z.boolean(),
    /** Subtle feedback sounds; off unless the operator turns them on. */
    sound: z.boolean(),
  })
  .strict();
export type ConsolePreferences = z.infer<typeof consolePreferencesSchema>;

export const consolePreferencesUpdateSchema = consolePreferencesSchema.partial().strict();
export type ConsolePreferencesUpdate = z.infer<typeof consolePreferencesUpdateSchema>;

export const DEFAULT_CONSOLE_PREFERENCES: ConsolePreferences = {
  palette: 'professional_blue',
  mode: 'system',
  sidebarCollapsed: false,
  sound: false,
};

/** Stored preferences with anything missing or no longer valid replaced by the default. */
export function normaliseConsolePreferences(input: unknown): ConsolePreferences {
  const out = { ...DEFAULT_CONSOLE_PREFERENCES } as Record<string, unknown>;
  if (input && typeof input === 'object') {
    const shape = consolePreferencesSchema.shape as Record<string, z.ZodTypeAny>;
    for (const [k, v] of Object.entries(input as Record<string, unknown>))
      if (k in shape && shape[k]!.safeParse(v).success) out[k] = v;
  }
  return out as ConsolePreferences;
}

/** The theme engine settings that paint a Console palette in a colour mode. */
export function consoleAppearance(p: Pick<ConsolePreferences, 'palette' | 'mode'>): Appearance {
  const def = CONSOLE_PALETTE_BY_ID[p.palette] ?? CONSOLE_PALETTE_DEFS[0]!;
  return {
    ...DEFAULT_APPEARANCE,
    themeId: def.themeId,
    mode: p.mode,
    primary: def.primary,
    accent: def.accent,
    background: 'gradient',
    sidebarStyle: 'glass',
    cardStyle: 'elevated',
    glass: 50,
  };
}

// ───── Global search (Ctrl/⌘ K) ─────

export const CONSOLE_SEARCH_KINDS = [
  'client',
  'user',
  'workspace',
  'invoice',
  'ticket',
  'plan',
] as const;
export type ConsoleSearchKind = (typeof CONSOLE_SEARCH_KINDS)[number];

export const consoleSearchQuerySchema = z
  .object({ q: z.string().trim().min(2, 'Type at least 2 characters.').max(100) })
  .strict();

export interface ConsoleSearchHit {
  kind: ConsoleSearchKind;
  id: string;
  title: string;
  /** A second line: the client a person or workspace belongs to, an email, an amount. */
  detail: string | null;
  /** Where the result opens in the Console. */
  href: string;
}

export interface ConsoleSearchResult {
  q: string;
  hits: ConsoleSearchHit[];
}
