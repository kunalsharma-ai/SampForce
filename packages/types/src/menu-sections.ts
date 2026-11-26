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
