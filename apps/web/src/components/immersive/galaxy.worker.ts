/// <reference lib="webworker" />
import type { GalaxyEdge, GalaxyNode } from '@dealflow/types';
import { layoutGraph } from '@/lib/galaxy-layout';

/** Runs the galaxy layout off the main thread so the page stays responsive while it settles. */
self.onmessage = (e: MessageEvent<{ nodes: Pick<GalaxyNode, 'id' | 'kind'>[]; edges: GalaxyEdge[]; dims: 2 | 3 }>) => {
  const { positions } = layoutGraph(e.data.nodes, e.data.edges, e.data.dims);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage({ positions }, [positions.buffer]);
};
