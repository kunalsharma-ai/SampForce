import { z } from 'zod';

/*
 * Data table views (design spec Part 10): which columns show, in what order and width, the sort, filters, search and
 * density. Saved per person, optionally shared read-only with the workspace. Also the bulk action contract.
 */

export const TABLE_ENTITIES = ['leads', 'contacts', 'companies', 'deals'] as const;
export type TableEntity = (typeof TABLE_ENTITIES)[number];

export const TABLE_DENSITIES = ['auto', 'comfortable', 'balanced', 'compact', 'ultra'] as const;
export type TableDensity = (typeof TABLE_DENSITIES)[number];

const columnId = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);

/** Up to three sort keys, highest priority first. */
export const sortSpecSchema = z.array(z.object({ id: columnId, desc: z.boolean() }).strict()).max(3);
export type SortSpec = z.infer<typeof sortSpecSchema>;

export const viewConfigSchema = z
  .object({
    /** Visible columns in display order. Columns not listed are hidden. */
    columns: z.array(columnId).min(1).max(40),
    widths: z.record(columnId, z.number().int().min(60).max(640)).default({}),
    sort: sortSpecSchema.default([]),
    filters: z
      .object({
        status: z.string().max(40).optional(),
        /** "me" means whoever is looking at the view. */
        ownerId: z.union([z.literal('me'), z.string().uuid()]).optional(),
      })
      .strict()
      .default({}),
    q: z.string().trim().max(200).default(''),
    density: z.enum(TABLE_DENSITIES).default('auto'),
  })
  .strict();
export type ViewConfig = z.infer<typeof viewConfigSchema>;

export const MAX_SAVED_VIEWS = 30;

export const savedViewInputSchema = z
  .object({
    entity: z.enum(TABLE_ENTITIES),
    name: z.string().trim().min(1).max(60),
    shared: z.boolean().default(false),
    config: viewConfigSchema,
  })
  .strict();
export type SavedViewInput = z.infer<typeof savedViewInputSchema>;

export const savedViewUpdateSchema = savedViewInputSchema.omit({ entity: true }).partial().strict();
export type SavedViewUpdate = z.infer<typeof savedViewUpdateSchema>;

export interface SavedView {
  id: string;
  entity: TableEntity;
  name: string;
  shared: boolean;
  /** True when the signed-in person created it (only they can change or delete it). */
  mine: boolean;
  ownerName: string | null;
  config: ViewConfig;
  updatedAt: string;
}

/** Turns a sort spec into the list API's `sort` parameter: "status,-createdAt". */
export function sortParam(sort: SortSpec): string | undefined {
  return sort.length ? sort.map((s) => `${s.desc ? '-' : ''}${s.id}`).join(',') : undefined;
}

/** Parses the list API's `sort` parameter; the legacy single key uses `order` for its direction. */
export function parseSortParam(sort: string | undefined, order: 'asc' | 'desc' = 'desc'): { field: string; desc: boolean }[] {
  if (!sort) return [];
  const parts = sort.split(',').filter(Boolean);
  if (parts.length === 1 && !parts[0]!.startsWith('-')) return [{ field: parts[0]!, desc: order === 'desc' }];
  return parts.slice(0, 3).map((p) => (p.startsWith('-') ? { field: p.slice(1), desc: true } : { field: p, desc: false }));
}

export const BULK_ACTIONS = ['assign', 'status', 'delete'] as const;

export const bulkActionSchema = z
  .object({
    entity: z.enum(TABLE_ENTITIES),
    ids: z.array(z.string().uuid()).min(1).max(100),
    action: z.enum(BULK_ACTIONS),
    ownerId: z.string().uuid().optional(),
    status: z.string().max(40).optional(),
  })
  .strict()
  .refine((v) => v.action !== 'assign' || !!v.ownerId, { message: 'Choose an owner', path: ['ownerId'] })
  .refine((v) => v.action !== 'status' || !!v.status, { message: 'Choose a status', path: ['status'] });
export type BulkActionInput = z.infer<typeof bulkActionSchema>;

export interface BulkActionResult {
  updated: number;
  failed: { id: string; message: string }[];
}
