import type { GalaxyNode } from '@dealflow/types';

/** Size and colour of galaxy nodes, shared by the 3D scene and the 2D view (kept free of three.js). */
export function nodeSize(n: GalaxyNode, maxCompany: number, maxDeal: number): number {
  if (n.kind === 'company') return 0.32 + 0.5 * Math.sqrt((n.value ?? 0) / (maxCompany || 1));
  if (n.kind === 'deal') return 0.16 + 0.24 * Math.sqrt((n.value ?? 0) / (maxDeal || 1));
  return 0.13;
}

export function nodeColorToken(n: GalaxyNode): string {
  if (n.kind === 'company') return 'chart-2';
  if (n.kind === 'contact') return 'chart-6';
  return n.status === 'WON' ? 'chart-3' : n.status === 'LOST' ? 'chart-5' : 'chart-1';
}
