import { starterEmailDesign, type EmailDesign } from '@dealflow/types';
import { describe, expect, it } from 'vitest';
import {
  addBlock,
  applyDrop,
  blockSummary,
  duplicateBlock,
  moveBlock,
  nextBlockId,
  removeBlock,
  updateBlock,
} from './design-model';

const ids = (d: EmailDesign) => d.blocks.map((b) => b.id);
const types = (d: EmailDesign) => d.blocks.map((b) => b.type);

describe('email design editing', () => {
  const start = starterEmailDesign(); // b1 text, b2 button, b3 signature

  it('adds blocks with fresh ids at a position or the end', () => {
    const a = addBlock(start, 'header', 0);
    expect(a.id).toBe('b4');
    expect(types(a.design)).toEqual(['header', 'text', 'button', 'signature']);
    const b = addBlock(a.design, 'divider');
    expect(ids(b.design)).toEqual(['b4', 'b1', 'b2', 'b3', 'b5']);
    expect(nextBlockId({ ...start, blocks: [{ id: 'b2', type: 'divider' }] })).toBe('b3');
    expect(start.blocks).toHaveLength(3); // unchanged
  });

  it('moves, duplicates, edits and removes blocks', () => {
    expect(ids(moveBlock(start, 0, 2))).toEqual(['b2', 'b3', 'b1']);
    expect(ids(moveBlock(start, 2, 0))).toEqual(['b3', 'b1', 'b2']);
    const dup = duplicateBlock(start, 'b2');
    expect(ids(dup.design)).toEqual(['b1', 'b2', 'b4', 'b3']);
    expect(dup.design.blocks[2]).toMatchObject({ type: 'button', label: 'Book a call' });
    const edited = updateBlock(start, 'b2', { label: 'Reserve', type: 'divider' } as never);
    expect(edited.blocks[1]).toMatchObject({ type: 'button', label: 'Reserve', id: 'b2' });
    expect(ids(removeBlock(start, 'b1'))).toEqual(['b2', 'b3']);
  });

  it('drops palette blocks before a block or at the end, and moves existing blocks by drag', () => {
    expect(types(applyDrop(start, { type: 'image' }, { before: 'b2' })!.design)).toEqual([
      'text',
      'image',
      'button',
      'signature',
    ]);
    expect(types(applyDrop(start, { type: 'footer' }, { end: true })!.design)).toEqual([
      'text',
      'button',
      'signature',
      'footer',
    ]);
    expect(ids(applyDrop(start, { block: 'b3' }, { before: 'b1' })!.design)).toEqual([
      'b3',
      'b1',
      'b2',
    ]);
    expect(ids(applyDrop(start, { block: 'b1' }, { before: 'b3' })!.design)).toEqual([
      'b2',
      'b1',
      'b3',
    ]);
    expect(ids(applyDrop(start, { block: 'b1' }, { end: true })!.design)).toEqual([
      'b2',
      'b3',
      'b1',
    ]);
    expect(applyDrop(start, { block: 'b1' }, { before: 'b2' })).toBeNull();
    expect(applyDrop(start, { block: 'b1' }, { before: 'b1' })).toBeNull();
    expect(applyDrop(start, { block: 'gone' }, { end: true })).toBeNull();
  });

  it('summarises blocks for the outline', () => {
    expect(blockSummary(start.blocks[0]!)).toBe(
      'Hi {{first_name|there}}, Write your message here.',
    );
    expect(blockSummary({ id: 'x', type: 'social', links: [], align: 'center' })).toBe(
      'No links yet',
    );
    expect(
      blockSummary({
        id: 'x',
        type: 'pricing',
        title: '',
        rows: [{ label: 'a', price: '', note: '' }],
        footnote: '',
      }),
    ).toBe('Rows: 1');
    // Fixed wording goes through the caller's translation; people's own text does not.
    const say = (text: string, vars?: { count: number }) => `«${text.replace('{count}', String(vars?.count ?? ''))}»`;
    expect(blockSummary({ id: 'x', type: 'divider' }, say)).toBe('«A line between sections»');
    expect(blockSummary(start.blocks[0]!, say)).toBe('Hi {{first_name|there}}, Write your message here.');
  });
});
