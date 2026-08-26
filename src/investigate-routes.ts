/**
 * Aerodrome mixed-route investigation for CX → WETH (read-only).
 * Mirrors sugar-sdk: forSwaps → path graph → MixedRouteQuoterV3.quoteExactInput.
 * Also injects known CX pools missing from Sugar forSwaps.
 *
 * Run: npm run investigate:routes
 */
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { base } from "viem/chains";

const RPC = process.env.BASE_RPC_URL ?? "https://base-rpc.publicnode.com";
const BLOCK = process.env.INVESTIGATE_BLOCK
  ? BigInt(process.env.INVESTIGATE_BLOCK)
  : undefined;

const CX = getAddress("0x000000000000012DeF132E61759048bE5b5C6033");
const WETH = getAddress("0x4200000000000000000000000000000000000006");

const LP_SUGAR = getAddress("0x69dD9db6d8f8E7d83887A704f447b1a584b599A1");
const MIXED_QUOTER_V3 = getAddress("0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555");
const MIXED_QUOTER_V1 = getAddress("0x0A5aA5D3a4d28014f967Bf0f29EAA3FF9807D5c6");
const QUOTER_V2 = getAddress("0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0");
const SWAPPER = getAddress("0xcAF22ce31298CF2BF1D152862F80216478ad7c67");
const V2_ROUTER = getAddress("0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43");

const CL_FACTORY_NEW = getAddress("0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef");
const CL_FACTORY_OLD = getAddress("0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A");
const CL_FACTORY_MID = getAddress("0xaDe65c38CD4849aDBA595a4323a8C7DdfE89716a");

const QUOTER_STABLE = 2_097_152;
const QUOTER_VOLATILE = 4_194_304;
const NEW_CL_BITMASK = 0x080000;
const OLD_CL_BITMASK = 0x100000;

/** Base connector tokens from sugar-sdk config.py */
const CONNECTORS: Address[] = [
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC
  "0x940181a94A35A4569E4529A3CDfB74e38FD98631", // AERO
  "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", // DAI
  "0x4621b7a9c75199271f773ebd9a499dbd165c3191", // txlUSD
  WETH,
  "0xb79dd08ea68a908a97220c76d19a6aa9cbde4376",
  "0xf7a0dd3317535ec4f4d29adf9d620b3d8d5d5069",
  "0xcfa3ef56d303ae4faaba0592388f19d7c3399fb4",
  "0xcb327b99ff831bf8223cced12b1338ff3aa322ff",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
  "0xc1cba3fcea344f92d9239c08c0568f6f2f0ee452", // wstETH
  "0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42", // EURC
  "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", // USDbC
  "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", // cbBTC
].map((a) => getAddress(a));

const V2_CX_WETH = getAddress("0x14eE8B85f8feb54E8d623425Bc365B5dde0800d2");
const CL_CX_WETH = getAddress("0x9249F441005947831eaAF9135B319AD97BCD6Bdf");

const FRONTEND_TARGET_WETH = 0.0181;
const AMOUNT_IN_HUMAN = "5000";

type SwapPool = {
  lp: Address;
  type: number;
  token0: Address;
  token1: Address;
  factory: Address;
  poolFee: bigint;
};

type PathHop = {
  pool: SwapPool;
  reversed: boolean;
  tokenIn: Address;
  tokenOut: Address;
};

/** CX pools exist on-chain but are absent from Sugar forSwaps / byAddress */
const MANUAL_CX_POOLS: SwapPool[] = [
  {
    lp: V2_CX_WETH,
    type: -1,
    token0: CX,
    token1: WETH,
    factory: getAddress("0x420DD381b31aEf6683db6B902084cB0FFECe40Da"),
    poolFee: 0n,
  },
  {
    lp: CL_CX_WETH,
    type: 200,
    token0: CX,
    token1: WETH,
    factory: CL_FACTORY_OLD,
    poolFee: 3000n,
  },
];

const lpSugarAbi = [
  {
    type: "function",
    name: "forSwaps",
    stateMutability: "view",
    inputs: [
      { name: "_limit", type: "uint256" },
      { name: "_offset", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple[]",
        components: [
          { name: "lp", type: "address" },
          { name: "type", type: "int24" },
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "factory", type: "address" },
          { name: "pool_fee", type: "uint256" },
        ],
      },
    ],
  },
] as const;

const mixedQuoterAbi = [
  {
    type: "function",
    name: "quoteExactInput",
    stateMutability: "nonpayable",
    inputs: [
      { name: "path", type: "bytes" },
      { name: "amountIn", type: "uint256" },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "v3SqrtPriceX96AfterList", type: "uint160[]" },
      { name: "v3InitializedTicksCrossedList", type: "uint32[]" },
      { name: "v3SwapGasEstimate", type: "uint256" },
    ],
  },
] as const;

const quoterV2Abi = [
  {
    type: "function",
    name: "quoteExactInputSingle",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "tickSpacing", type: "int24" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [
      { name: "amountOut", type: "uint256" },
      { name: "sqrtPriceX96After", type: "uint160" },
      { name: "initializedTicksCrossed", type: "uint32" },
      { name: "gasEstimate", type: "uint256" },
    ],
  },
] as const;

const routerAbi = [
  {
    type: "function",
    name: "getAmountsOut",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      {
        name: "routes",
        type: "tuple[]",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "stable", type: "bool" },
          { name: "factory", type: "address" },
        ],
      },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

function poolTypeLabel(type: number): string {
  if (type > 0) return `Slipstream CL (tickSpacing=${type})`;
  if (type === 0) return "V2 stable";
  return "V2 volatile";
}

function pathFiller(pool: SwapPool): number {
  if (pool.type > 0) {
    if (pool.factory === CL_FACTORY_NEW) return pool.type | NEW_CL_BITMASK;
    if (pool.factory === CL_FACTORY_OLD) return pool.type | OLD_CL_BITMASK;
    return pool.type;
  }
  return pool.type === 0 ? QUOTER_STABLE : QUOTER_VOLATILE;
}

function encodeMixedPath(hops: PathHop[]): `0x${string}` {
  if (hops.length === 0) throw new Error("empty path");
  const packedTypes: ("address" | "int24")[] = ["address", "int24", "address"];
  const packedValues: (Address | number)[] = [
    hops[0]!.tokenIn,
    pathFiller(hops[0]!.pool),
    hops[0]!.tokenOut,
  ];
  for (let i = 1; i < hops.length; i++) {
    packedTypes.push("int24", "address");
    packedValues.push(pathFiller(hops[i]!.pool), hops[i]!.tokenOut);
  }
  return encodePacked(packedTypes, packedValues);
}

function hopFromPool(pool: SwapPool, tokenIn: Address, tokenOut: Address): PathHop {
  const reversed =
    pool.token0.toLowerCase() === tokenOut.toLowerCase() &&
    pool.token1.toLowerCase() === tokenIn.toLowerCase();
  return { pool, reversed, tokenIn, tokenOut };
}

function pathKey(hops: PathHop[]): string {
  return hops
    .map((h) => `${h.pool.lp}:${h.tokenIn.slice(0, 6)}→${h.tokenOut.slice(0, 6)}`)
    .join("|");
}

function findAllPaths(
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
      const hop = hopFromPool(edge.pool, current, edge.next);
      hops.push(hop);
      dfs(edge.next, target, hops, depth + 1);
      hops.pop();
    }
  }

  dfs(start, end, [], 0);
  return results;
}

async function fetchAllSwapPools(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
): Promise<SwapPool[]> {
  const pageSize = 500;
  let offset = 0;
  const all: SwapPool[] = [];
  while (true) {
    const batch = (await client.readContract({
      address: LP_SUGAR,
      abi: lpSugarAbi,
      functionName: "forSwaps",
      args: [BigInt(pageSize), BigInt(offset)],
      ...(BLOCK !== undefined ? { blockNumber: BLOCK } : {}),
    })) as readonly {
      lp: Address;
      type: number;
      token0: Address;
      token1: Address;
      factory: Address;
      pool_fee: bigint;
    }[];
    if (batch.length === 0) break;
    for (const row of batch) {
      all.push({
        lp: row.lp,
        type: Number(row.type),
        token0: getAddress(row.token0),
        token1: getAddress(row.token1),
        factory: getAddress(row.factory),
        poolFee: row.pool_fee,
      });
    }
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

async function quoteMixedPath(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  quoter: Address,
  path: `0x${string}`,
  amountIn: bigint,
): Promise<bigint | null> {
  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: mixedQuoterAbi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
      ...(BLOCK !== undefined ? { blockNumber: BLOCK } : {}),
    });
    return result[0] as bigint;
  } catch {
    return null;
  }
}

async function quoteLegOutputs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  hops: PathHop[],
  amountIn: bigint,
): Promise<{ leg: string; amountOut: bigint | null; amountOutHuman: string }[]> {
  const legs: { leg: string; amountOut: bigint | null; amountOutHuman: string }[] = [];
  let running = amountIn;
  for (let i = 0; i < hops.length; i++) {
    const prefix = hops.slice(0, i + 1);
    const path = encodeMixedPath(prefix);
    const out = await quoteMixedPath(client, MIXED_QUOTER_V3, path, amountIn);
    const dec = prefix[prefix.length - 1]!.tokenOut === WETH ? 18 : 18;
    legs.push({
      leg: `${i + 1}: ${prefix.map((h) => `${h.tokenIn.slice(0, 8)}→${h.tokenOut.slice(0, 8)} via ${h.pool.lp.slice(0, 10)} (${poolTypeLabel(h.pool.type)})`).join(" | ")}`,
      amountOut: out,
      amountOutHuman: out !== null ? formatUnits(out, dec) : "FAIL",
    });
    if (out === null || out === 0n) break;
    running = out;
    void running;
  }
  return legs;
}

function buildV2SwapExecuteCalldata(
  hops: PathHop[],
  amountIn: bigint,
  minOut: bigint,
  recipient: Address,
): { commands: `0x${string}`; input: `0x${string}`; quoterPath: `0x${string}`; swapPath: `0x${string}` } {
  const quoterPath = encodeMixedPath(hops);
  const swapTypes: ("address" | "bool")[] = ["address", "bool", "address"];
  const swapValues: (Address | boolean)[] = [hops[0]!.tokenIn, false, hops[0]!.tokenOut];
  for (let i = 1; i < hops.length; i++) {
    swapTypes.push("bool", "address");
    swapValues.push(false, hops[i]!.tokenOut);
  }
  const swapPath = encodePacked(swapTypes, swapValues);
  const commands = "0x08" as `0x${string}`;
  const input = encodeAbiParameters(
    [
      { type: "address" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "bytes" },
      { type: "bool" },
      { type: "bool" },
    ],
    [recipient, amountIn, minOut, swapPath, true, false],
  ) as `0x${string}`;
  return { commands, input, quoterPath, swapPath };
}

async function main() {
  const client = createPublicClient({
    chain: base,
    transport: http(RPC, { timeout: 60_000 }),
  });

  const block = BLOCK ?? (await client.getBlockNumber());
  const amountIn = parseUnits(AMOUNT_IN_HUMAN, 18);

  console.log(
    JSON.stringify(
      {
        phase: "setup",
        block: block.toString(),
        rpc: RPC,
        amountInHuman: AMOUNT_IN_HUMAN,
        frontendTargetWeth: FRONTEND_TARGET_WETH,
        contracts: {
          lpSugar: LP_SUGAR,
          mixedQuoterV3: MIXED_QUOTER_V3,
          mixedQuoterV1: MIXED_QUOTER_V1,
          quoterV2: QUOTER_V2,
          swapper: SWAPPER,
        },
      },
      null,
      2,
    ),
  );

  const allPoolsRaw = await fetchAllSwapPools(client);
  const manualNotInSugar = MANUAL_CX_POOLS.filter(
    (p) => !allPoolsRaw.some((s) => s.lp.toLowerCase() === p.lp.toLowerCase()),
  );
  const allPools = [...allPoolsRaw, ...manualNotInSugar];
  const relevantTokens = new Set(
    [CX, WETH, ...CONNECTORS].map((t) => t.toLowerCase()),
  );
  const routingPools = allPools.filter(
    (p) =>
      relevantTokens.has(p.token0.toLowerCase()) ||
      relevantTokens.has(p.token1.toLowerCase()),
  );

  const cxPools = allPools.filter(
    (p) =>
      p.token0.toLowerCase() === CX.toLowerCase() ||
      p.token1.toLowerCase() === CX.toLowerCase(),
  );

  console.log(
    JSON.stringify(
      {
        phase: "pool_inventory",
        totalForSwaps: allPools.length,
        routingPoolCount: routingPools.length,
        cxPoolCount: cxPools.length,
        cxMissingFromSugarForSwaps: manualNotInSugar.map((p) => p.lp),
        cxPools: cxPools.map((p) => ({
          lp: p.lp,
          type: poolTypeLabel(p.type),
          factory: p.factory,
          token0: p.token0,
          token1: p.token1,
          poolFee: p.poolFee.toString(),
        })),
      },
      null,
      2,
    ),
  );

  // Direct QuoterV2 baseline
  const cxWethCl = cxPools.find(
    (p) => p.type === 200 && p.lp.toLowerCase() === "0x9249f441005947831eaaf9135b319ad97bcd6bdf",
  );
  if (cxWethCl) {
    try {
      const { result } = await client.simulateContract({
        address: QUOTER_V2,
        abi: quoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            tokenIn: CX,
            tokenOut: WETH,
            amountIn,
            tickSpacing: 200,
            sqrtPriceLimitX96: 0n,
          },
        ],
        blockNumber: block,
      });
      console.log(
        JSON.stringify(
          {
            phase: "direct_quoter_v2_cx_weth_cl200",
            pool: cxWethCl.lp,
            amountOutWeth: formatUnits(result[0], 18),
          },
          null,
          2,
        ),
      );
    } catch (e: unknown) {
      console.log(JSON.stringify({ phase: "direct_quoter_v2_cx_weth_cl200", error: String(e) }));
    }
  }

  const paths = findAllPaths(routingPools, CX, WETH, 3);
  console.log(
    JSON.stringify({ phase: "path_search", pathCount: paths.length }, null, 2),
  );

  type QuoteRow = {
    rank: number;
    pathId: string;
    hops: number;
    amountOutWeth: string;
    deltaFromFrontend: number;
    legs: { leg: string; amountOutHuman: string }[];
    pools: {
      address: Address;
      type: string;
      factory: Address;
      token0: Address;
      token1: Address;
    }[];
    mixedPathHex: string;
  };

  const quotes: QuoteRow[] = [];
  let processed = 0;
  for (const hops of paths) {
    processed++;
    if (processed % 50 === 0) {
      console.error(`Quoting path ${processed}/${paths.length}...`);
    }
    const path = encodeMixedPath(hops);
    const out = await quoteMixedPath(client, MIXED_QUOTER_V3, path, amountIn);
    if (out === null || out === 0n) continue;
    const outHuman = Number(formatUnits(out, 18));
    const legs = await quoteLegOutputs(client, hops, amountIn);
    quotes.push({
      rank: 0,
      pathId: pathKey(hops),
      hops: hops.length,
      amountOutWeth: formatUnits(out, 18),
      deltaFromFrontend: outHuman - FRONTEND_TARGET_WETH,
      legs: legs.map((l) => ({ leg: l.leg, amountOutHuman: l.amountOutHuman })),
      pools: hops.map((h) => ({
        address: h.pool.lp,
        type: poolTypeLabel(h.pool.type),
        factory: h.pool.factory,
        token0: h.pool.token0,
        token1: h.pool.token1,
      })),
      mixedPathHex: path,
    });
  }

  quotes.sort((a, b) => Number.parseFloat(b.amountOutWeth) - Number.parseFloat(a.amountOutWeth));
  quotes.forEach((q, i) => {
    q.rank = i + 1;
  });

  const best = quotes[0];
  const nearFrontend = quotes
    .filter((q) => Math.abs(Number.parseFloat(q.amountOutWeth) - FRONTEND_TARGET_WETH) < 0.003)
    .slice(0, 10);

  console.log(
    JSON.stringify(
      {
        phase: "mixed_quoter_v3_results",
        viableRoutes: quotes.length,
        bestRoute: best ?? null,
        routesNearFrontend0181: nearFrontend,
        top10Routes: quotes.slice(0, 10),
      },
      null,
      2,
    ),
  );

  if (best) {
    const bestHops = paths.find((h) => pathKey(h) === best.pathId)!;
    const minOut = (parseUnits(best.amountOutWeth, 18) * 99n) / 100n;
    const isV2Best = bestHops.every((h) => h.pool.type <= 0);
    const calldata = isV2Best
      ? buildV2SwapExecuteCalldata(bestHops, amountIn, minOut, SWAPPER)
      : null;
    console.log(
      JSON.stringify(
        {
          phase: "swapper_calldata_preview",
          swapper: SWAPPER,
          winningRoute: best.pathId,
          isV2Route: isV2Best,
          note: "Universal Router execute(commands,[input]) — sugar-sdk layout, 1% slippage minOut",
          ...(calldata ?? { clRoute: best.mixedPathHex }),
          ...(calldata
            ? {
                commands: calldata.commands,
                encodedInput: calldata.input,
                mixedQuoterPath: calldata.quoterPath,
                swapRouterPath: calldata.swapPath,
              }
            : {}),
        },
        null,
        2,
      ),
    );
  }

  // V2 Router cross-check (frontend-compatible for basic pools)
  try {
    const routerOut = await client.readContract({
      address: V2_ROUTER,
      abi: routerAbi,
      functionName: "getAmountsOut",
      args: [
        amountIn,
        [{ from: CX, to: WETH, stable: false, factory: getAddress("0x420DD381b31aEf6683db6B902084cB0FFECe40Da") }],
      ],
      ...(BLOCK !== undefined ? { blockNumber: BLOCK } : {}),
    });
    console.log(
      JSON.stringify(
        {
          phase: "v2_router_direct_volatile",
          pool: V2_CX_WETH,
          amountOutWeth: formatUnits(routerOut[1]!, 18),
          matchesFrontend: Math.abs(Number(formatUnits(routerOut[1]!, 18)) - FRONTEND_TARGET_WETH) < 0.001,
        },
        null,
        2,
      ),
    );
  } catch (e: unknown) {
    const err = e as { shortMessage?: string };
    console.log(JSON.stringify({ phase: "v2_router_direct_volatile", error: err.shortMessage }));
  }

  // Also try MixedQuoterV1 on best direct CL path if exists
  const directClHops = paths.filter((h) => h.length === 1 && h[0]!.pool.type === 200);
  for (const hops of directClHops) {
    const path = encodeMixedPath(hops);
    const outV1 = await quoteMixedPath(client, MIXED_QUOTER_V1, path, amountIn);
    const outV3 = await quoteMixedPath(client, MIXED_QUOTER_V3, path, amountIn);
    console.log(
      JSON.stringify(
        {
          phase: "direct_cl_compare_quoters",
          pool: hops[0]!.pool.lp,
          factory: hops[0]!.pool.factory,
          mixedQuoterV1Weth: outV1 !== null ? formatUnits(outV1, 18) : null,
          mixedQuoterV3Weth: outV3 !== null ? formatUnits(outV3, 18) : null,
          pathHex: path,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
