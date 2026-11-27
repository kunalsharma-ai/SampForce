import { z } from 'zod';

/**
 * Sections the Super Workspace shows or hides for the whole organisation (redesign, menu). The Leads and Accounts
 * pages are hidden until it switches them on; Companies and their contacts hold the leads otherwise.
 */
export const menuSectionsSchema = z.object({ leads: z.boolean(), accounts: z.boolean() }).strict();
export type MenuSectionsInput = z.infer<typeof menuSectionsSchema>;
export interface MenuSections {
  leads: boolean;
  accounts: boolean;
}

/** The Console's change of a client's Leads and Accounts pages (R8, ADR 0092): with a reason, as every Console change. */
export const putClientMenuSectionsSchema = menuSectionsSchema.extend({ reason: z.string().trim().min(3, 'Give a reason').max(300) }).strict();
export type PutClientMenuSections = z.infer<typeof putClientMenuSectionsSchema>;
