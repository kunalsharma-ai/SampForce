/** Types for bidi-js 1.0.3 (it ships none): the parts the PDF text layout uses. */
declare module 'bidi-js' {
  export interface EmbeddingLevels {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  export interface Bidi {
    getEmbeddingLevels(text: string, direction?: 'ltr' | 'rtl'): EmbeddingLevels;
    /** Ranges to reverse, in order; start and end are inclusive. */
    getReorderSegments(text: string, levels: EmbeddingLevels, start?: number, end?: number): [number, number][];
    /** Takes the `levels` array, not the whole result. */
    getMirroredCharactersMap(text: string, levels: Uint8Array, start?: number, end?: number): Map<number, string>;
  }
  export default function bidiFactory(): Bidi;
}
