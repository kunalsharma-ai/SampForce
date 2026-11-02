import {
  newEmailBlock,
  type EmailBlock,
  type EmailBlockType,
  type EmailDesign,
} from '@dealflow/types';

/** Edits to a design. Each returns a new design and never changes the one it is given. */

/** An id not used by any block yet: `b1`, `b2`, … */
export function nextBlockId(design: EmailDesign): string {
  const used = new Set(design.blocks.map((b) => b.id));
  let n = design.blocks.length + 1;
  while (used.has(`b${n}`)) n++;
  return `b${n}`;
}

/** Adds a new block of a type at a position (the end when it is left out), its starter text written by `say`. Returns the design and the new block's id. */
export function addBlock(
  design: EmailDesign,
  type: EmailBlockType,
  at = design.blocks.length,
  say?: (english: string) => string,
): { design: EmailDesign; id: string } {
  const id = nextBlockId(design);
  const blocks = [...design.blocks];
  blocks.splice(clamp(at, 0, blocks.length), 0, newEmailBlock(type, id, say));
  return { design: { ...design, blocks }, id };
}

/** Moves the block at `from` so it ends up at index `to` in the result. */
export function moveBlock(design: EmailDesign, from: number, to: number): EmailDesign {
  if (from === to || from < 0 || from >= design.blocks.length) return design;
  const blocks = [...design.blocks];
  const [b] = blocks.splice(from, 1);
  blocks.splice(clamp(to, 0, blocks.length), 0, b!);
  return { ...design, blocks };
}

/** Puts a copy right after the original. Returns the design and the copy's id. */
export function duplicateBlock(
  design: EmailDesign,
  id: string,
): { design: EmailDesign; id: string } {
  const i = design.blocks.findIndex((b) => b.id === id);
  if (i < 0) return { design, id };
  const copyId = nextBlockId(design);
  const blocks = [...design.blocks];
  blocks.splice(i + 1, 0, { ...structuredClone(design.blocks[i]!), id: copyId });
  return { design: { ...design, blocks }, id: copyId };
}

export function removeBlock(design: EmailDesign, id: string): EmailDesign {
  return { ...design, blocks: design.blocks.filter((b) => b.id !== id) };
}

export function updateBlock(
  design: EmailDesign,
  id: string,
  patch: Partial<EmailBlock>,
): EmailDesign {
  return {
    ...design,
    blocks: design.blocks.map((b) =>
      b.id === id ? ({ ...b, ...patch, id: b.id, type: b.type } as EmailBlock) : b,
    ),
  };
}

/** Where a drop lands: before an existing block, or at the end. */
export type DropTarget = { before: string } | { end: true };

/**
 * Applies a drag that ended over a target. `dragged` is either an existing block's id or a new block type from the
 * palette. Returns the new design and the id of the block that was placed, or null when nothing changes.
 */
export function applyDrop(
  design: EmailDesign,
  dragged: { block: string } | { type: EmailBlockType },
  target: DropTarget,
): { design: EmailDesign; id: string } | null {
  const targetIndex =
    'end' in target ? design.blocks.length : design.blocks.findIndex((b) => b.id === target.before);
  if (targetIndex < 0) return null;
  if ('type' in dragged) return addBlock(design, dragged.type, targetIndex);
  const from = design.blocks.findIndex((b) => b.id === dragged.block);
  if (from < 0) return null;
  // Dropping a block before itself or before the block right after it leaves it where it is.
  if (targetIndex === from || targetIndex === from + 1) return null;
  return {
    design: moveBlock(design, from, targetIndex > from ? targetIndex - 1 : targetIndex),
    id: dragged.block,
  };
}

/** One line that says what a block holds, for the outline. */
/** Fixed wording in a summary, translated by the caller. People's own text is never passed through it. */
export type SummaryWording = 'Logo' | 'Empty' | 'No image yet' | 'No label' | 'A line between sections' | 'No links yet' | 'Links: {count}' | 'Rows: {count}';
type Say = (text: SummaryWording, vars?: { count: number }) => string;
const english: Say = (text, vars) => text.replace('{count}', String(vars?.count ?? ''));

export function blockSummary(b: EmailBlock, say: Say = english): string {
  const cut = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}…` : s);
  switch (b.type) {
    case 'header':
      return cut(b.title || say(b.logoUrl ? 'Logo' : 'Empty'));
    case 'heading':
    case 'text':
    case 'footer':
      return cut(b.text.replace(/\s+/g, ' ').trim() || say('Empty'));
    case 'image':
      return b.src ? cut(b.alt || b.src) : say('No image yet');
    case 'button':
      return cut(b.label || say('No label'));
    case 'divider':
      return say('A line between sections');
    case 'social':
      return b.links.length ? say('Links: {count}', { count: b.links.length }) : say('No links yet');
    case 'signature':
      return cut([b.name, b.title].filter(Boolean).join(', ') || say('Empty'));
    case 'product':
      return cut([b.name, b.price].filter(Boolean).join(' · ') || say('Empty'));
    case 'pricing':
      return say('Rows: {count}', { count: b.rows.length });
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
