// Exact CX -> WETH quote via Aerodrome Slipstream QuoterV2 + soft ETH/USD.

import { type Address, type PublicClient, formatUnits, parseUnits } from "viem";
import { clPoolAbi, erc20Abi, quoterV2Abi } from "./abis.js";

// Base (OP-stack) client types are stricter than default Chain; keep loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = PublicClient<any, any>;

export interface QuoteResult {
  amountIn: bigint;
  amountOut: bigint;
  wethFormatted: string;
  usd: number | null;
  ethUsd: number | null;
  minOutRef: bigint;
  minOutRefFormatted: string;
  /** Raw QuoterV2 tuple fields (for diagnostics). */
  sqrtPriceX96After?: bigint;
  initializedTicksCrossed?: number;
  gasEstimate?: bigint;
  cxDecimals?: number;
}

export interface QuoteRouteDiagnostic {
  label: string;
  block: string;
  pool: Address;
  quoter: Address;
  tokenIn: Address;
  tokenOut: Address;
  token0: Address;
  token1: Address;
  cxIsToken0: boolean;
  wethIsToken1: boolean;
  zeroForOne: boolean;
  cxDecimals: number;
  tickSpacing: number;
  /** Slipstream fee is dynamic; raw is 1e-6 units (3000 = 0.3%). */
  feeRaw: number;
  feePercent: number;
  tick: number;
  sqrtPriceX96: string;
  liquidity: string;
  amountInHuman: string;
  amountInRaw: string;
  amountOutRaw: string;
  amountOutWeth: string;
  sqrtPriceX96After: string;
  initializedTicksCrossed: number;
  gasEstimate: string;
}

let cachedDecimals: number | null = null;
let ethUsdCache: { price: number; fetchedAt: number } | null = null;
const ETH_USD_TTL_MS = 5 * 60 * 1000;

export async function getCxDecimals(
  client: Rpc,
  cx: Address,
): Promise<number> {
  if (cachedDecimals !== null) return cachedDecimals;
  const decimals = await client.readContract({
    address: cx,
    abi: erc20Abi,
    functionName: "decimals",
  });
  cachedDecimals = Number(decimals);
  return cachedDecimals;
}

export async function fetchEthUsd(): Promise<number | null> {
  const now = Date.now();
  if (ethUsdCache && now - ethUsdCache.fetchedAt < ETH_USD_TTL_MS) {
    return ethUsdCache.price;
  }

  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      {
        signal: AbortSignal.timeout(10_000),
        headers: {
          Accept: "application/json",
          // CoinGecko often 403s bare Worker/fetch User-Agents
          "User-Agent": "cx-watcher/1.0 (read-only; +https://github.com/ZeitgeistJones/watcher)",
        },
      },
    );
    if (!res.ok) {
      console.error(`[${new Date().toISOString()}] ETH/USD HTTP ${res.status}`);
      return ethUsdCache?.price ?? null;
    }
    const data = (await res.json()) as { ethereum?: { usd?: number } };
    const price = data.ethereum?.usd;
    if (typeof price !== "number" || !Number.isFinite(price)) {
      return ethUsdCache?.price ?? null;
    }
    ethUsdCache = { price, fetchedAt: now };
    return price;
  } catch (err) {
    console.error(`[${new Date().toISOString()}] ETH/USD fetch failed:`, err);
    return ethUsdCache?.price ?? null;
  }
}

export async function quoteCxToWeth(
  client: Rpc,
  params: {
    quoter: Address;
    cx: Address;
    weth: Address;
    cxAmountHuman: string;
    tickSpacing: number;
    slippageRefBps: number;
  },
): Promise<QuoteResult> {
  const decimals = await getCxDecimals(client, params.cx);
  const amountIn = parseUnits(params.cxAmountHuman, decimals);

  const { result } = await client.simulateContract({
    address: params.quoter,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: params.cx,
        tokenOut: params.weth,
        amountIn,
        tickSpacing: params.tickSpacing,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const amountOut = result[0];
  const bps = BigInt(params.slippageRefBps);
  const minOutRef = amountOut - (amountOut * bps) / 10_000n;

  const ethUsd = await fetchEthUsd();
  const wethFormatted = formatUnits(amountOut, 18);
  let usd: number | null = null;
  if (ethUsd !== null) {
    // Safe enough for display: WETH amounts for this bag are small.
    usd = Number(wethFormatted) * ethUsd;
  }

  return {
    amountIn,
    amountOut,
    wethFormatted,
    usd,
    ethUsd,
    minOutRef,
    minOutRefFormatted: formatUnits(minOutRef, 18),
    sqrtPriceX96After: result[1],
    initializedTicksCrossed: Number(result[2]),
    gasEstimate: result[3],
    cxDecimals: decimals,
  };
}

/** Diagnostic-only quote — same QuoterV2 path; does not affect alerts. */
export async function diagnoseCxToWethQuote(
  client: Rpc,
  params: {
    label: string;
    pool: Address;
    quoter: Address;
    cx: Address;
    weth: Address;
    cxAmountHuman: string;
    tick: number;
    tickSpacing: number;
    sqrtPriceX96: bigint;
    liquidity: bigint;
    blockNumber: bigint;
  },
): Promise<QuoteRouteDiagnostic> {
  const [token0, token1, feeRaw, decimals] = await Promise.all([
    client.readContract({
      address: params.pool,
      abi: clPoolAbi,
      functionName: "token0",
    }),
    client.readContract({
      address: params.pool,
      abi: clPoolAbi,
      functionName: "token1",
    }),
    client.readContract({
      address: params.pool,
      abi: clPoolAbi,
      functionName: "fee",
    }),
    getCxDecimals(client, params.cx),
  ]);

  const amountIn = parseUnits(params.cxAmountHuman, decimals);
  const { result } = await client.simulateContract({
    address: params.quoter,
    abi: quoterV2Abi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        tokenIn: params.cx,
        tokenOut: params.weth,
        amountIn,
        tickSpacing: params.tickSpacing,
        sqrtPriceLimitX96: 0n,
      },
    ],
  });

  const amountOut = result[0];
  const feeNum = Number(feeRaw);

  return {
    label: params.label,
    block: params.blockNumber.toString(),
    pool: params.pool,
    quoter: params.quoter,
    tokenIn: params.cx,
    tokenOut: params.weth,
    token0,
    token1,
    cxIsToken0: token0.toLowerCase() === params.cx.toLowerCase(),
    wethIsToken1: token1.toLowerCase() === params.weth.toLowerCase(),
    zeroForOne: params.cx.toLowerCase() < params.weth.toLowerCase(),
    cxDecimals: decimals,
    tickSpacing: params.tickSpacing,
    feeRaw: feeNum,
    feePercent: feeNum / 10_000,
    tick: params.tick,
    sqrtPriceX96: params.sqrtPriceX96.toString(),
    liquidity: params.liquidity.toString(),
    amountInHuman: params.cxAmountHuman,
    amountInRaw: amountIn.toString(),
    amountOutRaw: amountOut.toString(),
    amountOutWeth: formatUnits(amountOut, 18),
    sqrtPriceX96After: result[1].toString(),
    initializedTicksCrossed: Number(result[2]),
    gasEstimate: result[3].toString(),
  };
}

export function logQuoteDiagnostic(d: QuoteRouteDiagnostic): void {
  console.log(
    `[quote-diag] ${d.label} block=${d.block} pool=${d.pool} quoter=${d.quoter} ` +
      `tokenIn=${d.tokenIn} tokenOut=${d.tokenOut} token0=${d.token0} token1=${d.token1} ` +
      `cxIsToken0=${d.cxIsToken0} wethIsToken1=${d.wethIsToken1} zeroForOne=${d.zeroForOne} ` +
      `cxDecimals=${d.cxDecimals} tickSpacing=${d.tickSpacing} feeRaw=${d.feeRaw} feePercent=${d.feePercent}% ` +
      `tick=${d.tick} sqrtPriceX96=${d.sqrtPriceX96} liquidity=${d.liquidity} ` +
      `amountInHuman=${d.amountInHuman} amountInRaw=${d.amountInRaw} ` +
      `amountOutRaw=${d.amountOutRaw} amountOutWeth=${d.amountOutWeth} ` +
      `sqrtPriceX96After=${d.sqrtPriceX96After} initializedTicksCrossed=${d.initializedTicksCrossed} ` +
      `gasEstimate=${d.gasEstimate}`,
  );
}

export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "n/a";
  return `$${usd.toFixed(2)}`;
}

export function formatEthUsd(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return "n/a";
  return `$${price.toFixed(2)}`;
}
