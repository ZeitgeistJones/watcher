/**
 * Aerodrome mixed-route quoting — MixedRouteQuoterV3 + manual CX pools.
 * Mirrors sugar-sdk path packing; CX pools are absent from Sugar forSwaps.
 */

import {
  type Address,
  encodePacked,
  formatUnits,
  getAddress,
  parseUnits,
} from "viem";
import { lpSugarAbi, mixedQuoterAbi } from "./abis.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = import("viem").PublicClient<any, any>;

export type QuoteRouteKind = "V2_VOLATILE" | "SLIPSTREAM" | "MIXED";

export interface SwapPool {
  lp: Address;
  type: number;
  token0: Address;
  token1: Address;
  factory: Address;
}

export interface PathHop {
  pool: SwapPool;
  tokenIn: Address;
  tokenOut: Address;
}

export interface RouteQuoteCandidate {
  kind: QuoteRouteKind;
  hops: PathHop[];
  amountOut: bigint;
  mixedPathHex: `0x${string}`;
}

export interface BestRouteQuote {
  kind: QuoteRouteKind;
  amountIn: bigint;
  amountOut: bigint;
  wethFormatted: string;
  hops: PathHop[];
  mixedPathHex: `0x${string}`;
  poolAddresses: Address[];
  candidates: RouteQuoteCandidate[];
}

const QUOTER_STABLE = 2_097_152;
const QUOTER_VOLATILE = 4_194_304;
const NEW_CL_BITMASK = 0x080000;
const OLD_CL_BITMASK = 0x100000;

const FOR_SWAPS_TTL_MS = 10 * 60 * 1000;

/** Base connector tokens (sugar-sdk config.py) for multi-hop discovery */
export const BASE_CONNECTOR_TOKENS: Address[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
  "0x4621b7a9c75199271f773ebd9a499dbd165c3191",
  "0x4200000000000000000000000000000000000006",
  "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376",
  "0xf7a0dd3317535ec4f4d29adf9d620b3d8d5d5069",
  "0xcfa3ef56d303ae4faaba0592388f19d7c3399fb4",
  "0xcb327b99ff831bf8223cced12b1338ff3aa322ff",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452",
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42",
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
].map((a) => getAddress(a));

let forSwapsCache: { pools: SwapPool[]; fetchedAt: number } | null = null;

export function buildManualCxPools(params: {
  cx: Address;
  weth: Address;
  v2Pool: Address;
  clPool: Address;
  v2Factory: Address;
  clFactoryOld: Address;
  clTickSpacing: number;
}): SwapPool[] {
  return [
    {
      lp: params.v2Pool,
      type: -1,
      token0: params.cx,
      token1: params.weth,
      factory: params.v2Factory,
    },
    {
      lp: params.clPool,
      type: params.clTickSpacing,
      token0: params.cx,
      token1: params.weth,
      factory: params.clFactoryOld,
    },
  ];
}

function pathFiller(pool: SwapPool, clFactoryOld: Address, clFactoryNew: Address): number {
  if (pool.type > 0) {
    if (pool.factory === clFactoryNew) return pool.type | NEW_CL_BITMASK;
    if (pool.factory === clFactoryOld) return pool.type | OLD_CL_BITMASK;
    return pool.type;
  }
  return pool.type === 0 ? QUOTER_STABLE : QUOTER_VOLATILE;
}

export function encodeMixedPath(hops: PathHop[], clFactoryOld: Address, clFactoryNew: Address): `0x${string}` {
  if (hops.length === 0) throw new Error("empty path");
  const packedTypes: ("address" | "int24")[] = ["address", "int24", "address"];
  const packedValues: (Address | number)[] = [
    hops[0]!.tokenIn,
    pathFiller(hops[0]!.pool, clFactoryOld, clFactoryNew),
    hops[0]!.tokenOut,
  ];
  for (let i = 1; i < hops.length; i++) {
    packedTypes.push("int24", "address");
    packedValues.push(
      pathFiller(hops[i]!.pool, clFactoryOld, clFactoryNew),
      hops[i]!.tokenOut,
    );
  }
  return encodePacked(packedTypes, packedValues);
}

function hopFromPool(pool: SwapPool, tokenIn: Address, tokenOut: Address): PathHop {
  return { pool, tokenIn, tokenOut };
}

function pathKey(hops: PathHop[]): string {
  return hops.map((h) => `${h.pool.lp}:${h.tokenIn.slice(0, 6)}→${h.tokenOut.slice(0, 6)}`).join("|");
}

export function findAllPaths(
  pools: SwapPool[],
  start: Address,
  end: Address,
  maxHops = 3,
): PathHop[][] {
  type Edge = { pool: SwapPool; next: Address };
  const adj = new Map<string, Edge[]>();
  const addEdge = (a: Address, b: Address, pool: SwapPool) => {
    const k = a.toLowerCase();
    const list = adj.get(k) ?? [];
    list.push({ pool, next: b });
    adj.set(k, list);
  };
  for (const p of pools) {
    addEdge(p.token0, p.token1, p);
    addEdge(p.token1, p.token0, p);
  }

  const results: PathHop[][] = [];
  const seen = new Set<string>();

  function dfs(current: Address, target: Address, hops: PathHop[], depth: number) {
    if (depth > maxHops) return;
    if (current.toLowerCase() === target.toLowerCase()) {
      if (hops.length === 0) return;
      const key = pathKey(hops);
      if (!seen.has(key)) {
        seen.add(key);
        results.push([...hops]);
      }
      return;
    }
    for (const edge of adj.get(current.toLowerCase()) ?? []) {
      if (hops.some((h) => h.pool.lp === edge.pool.lp)) continue;
      hops.push(hopFromPool(edge.pool, current, edge.next));
      dfs(edge.next, target, hops, depth + 1);
      hops.pop();
    }
  }

  dfs(start, end, [], 0);
  return results;
}

function classifyRoute(hops: PathHop[]): QuoteRouteKind {
  if (hops.length > 1) return "MIXED";
  return hops[0]!.pool.type > 0 ? "SLIPSTREAM" : "V2_VOLATILE";
}

async function fetchForSwapsPools(client: Rpc, lpSugar: Address): Promise<SwapPool[]> {
  const pageSize = 500;
  let offset = 0;
  const all: SwapPool[] = [];
  while (true) {
    const batch = (await client.readContract({
      address: lpSugar,
      abi: lpSugarAbi,
      functionName: "forSwaps",
      args: [BigInt(pageSize), BigInt(offset)],
    })) as readonly {
      lp: Address;
      type: number;
      token0: Address;
      token1: Address;
      factory: Address;
    }[];
    if (batch.length === 0) break;
    for (const row of batch) {
      all.push({
        lp: row.lp,
        type: Number(row.type),
        token0: getAddress(row.token0),
        token1: getAddress(row.token1),
        factory: getAddress(row.factory),
      });
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function getRoutingPools(
  client: Rpc,
  params: {
    lpSugar: Address;
    manualPools: SwapPool[];
    cx: Address;
    weth: Address;
    connectors: Address[];
  },
): Promise<SwapPool[]> {
  const now = Date.now();
  if (!forSwapsCache || now - forSwapsCache.fetchedAt > FOR_SWAPS_TTL_MS) {
    try {
      const pools = await fetchForSwapsPools(client, params.lpSugar);
      forSwapsCache = { pools, fetchedAt: now };
    } catch {
      if (!forSwapsCache) forSwapsCache = { pools: [], fetchedAt: now };
    }
  }

  const relevant = new Set(
    [params.cx, params.weth, ...params.connectors].map((t) => t.toLowerCase()),
  );
  const fromSugar = forSwapsCache.pools.filter(
    (p) =>
      relevant.has(p.token0.toLowerCase()) ||
      relevant.has(p.token1.toLowerCase()),
  );

  const byLp = new Map<string, SwapPool>();
  for (const p of [...fromSugar, ...params.manualPools]) {
    byLp.set(p.lp.toLowerCase(), p);
  }
  return [...byLp.values()];
}

async function quoteMixedPath(
  client: Rpc,
  mixedQuoter: Address,
  path: `0x${string}`,
  amountIn: bigint,
): Promise<bigint | null> {
  try {
    const { result } = await client.simulateContract({
      address: mixedQuoter,
      abi: mixedQuoterAbi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    return result[0] as bigint;
  } catch {
    return null;
  }
}

export async function quoteBestCxToWethRoute(
  client: Rpc,
  params: {
    mixedQuoter: Address;
    lpSugar: Address;
    cx: Address;
    weth: Address;
    cxAmountHuman: string;
    cxDecimals: number;
    manualPools: SwapPool[];
    connectors: Address[];
    clFactoryOld: Address;
    clFactoryNew: Address;
  },
): Promise<BestRouteQuote | null> {
  const amountIn = parseUnits(params.cxAmountHuman, params.cxDecimals);
  const routingPools = await getRoutingPools(client, {
    lpSugar: params.lpSugar,
    manualPools: params.manualPools,
    cx: params.cx,
    weth: params.weth,
    connectors: params.connectors,
  });

  const paths = findAllPaths(routingPools, params.cx, params.weth, 3);
  const candidates: RouteQuoteCandidate[] = [];

  for (const hops of paths) {
    const mixedPathHex = encodeMixedPath(hops, params.clFactoryOld, params.clFactoryNew);
    const amountOut = await quoteMixedPath(client, params.mixedQuoter, mixedPathHex, amountIn);
    if (amountOut === null || amountOut === 0n) continue;
    candidates.push({
      kind: classifyRoute(hops),
      hops,
      amountOut,
      mixedPathHex,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0));
  const best = candidates[0]!;

  return {
    kind: best.kind,
    amountIn,
    amountOut: best.amountOut,
    wethFormatted: formatUnits(best.amountOut, 18),
    hops: best.hops,
    mixedPathHex: best.mixedPathHex,
    poolAddresses: best.hops.map((h) => h.pool.lp),
    candidates,
  };
}

export function formatRouteKind(kind: QuoteRouteKind): string {
  return kind;
}
