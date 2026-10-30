/** Minimal typings for the parts of d3-force-3d the Relationship Galaxy layout uses (the package ships none). */
declare module 'd3-force-3d' {
  export interface SimNode {
    index?: number;
    x?: number;
    y?: number;
    z?: number;
    vx?: number;
    vy?: number;
    vz?: number;
    [key: string]: unknown;
  }
  export interface SimLink<N extends SimNode> {
    source: string | N;
    target: string | N;
    [key: string]: unknown;
  }
  interface Force {
    (alpha: number): void;
  }
  export interface Simulation<N extends SimNode> {
    force(name: string, force: Force | null): this;
    stop(): this;
    tick(iterations?: number): this;
    alpha(): number;
    alphaDecay(v: number): this;
    nodes(): N[];
  }
  export function forceSimulation<N extends SimNode>(nodes: N[], numDimensions?: number): Simulation<N>;
  export function forceLink<N extends SimNode>(links: SimLink<N>[]): Force & {
    id(fn: (n: N) => string): ReturnType<typeof forceLink<N>>;
    distance(fn: number | ((l: SimLink<N>) => number)): ReturnType<typeof forceLink<N>>;
    strength(fn: number | ((l: SimLink<N>) => number)): ReturnType<typeof forceLink<N>>;
  };
  export function forceManyBody(): Force & { strength(v: number | ((n: SimNode) => number)): ReturnType<typeof forceManyBody>; theta(v: number): ReturnType<typeof forceManyBody>; distanceMax(v: number): ReturnType<typeof forceManyBody> };
  export function forceCenter(): Force;
}
