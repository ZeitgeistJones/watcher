// Exact CX -> WETH quote via Aerodrome Slipstream QuoterV2 + soft ETH/USD.

import { type Address, type PublicClient, formatUnits, parseUnits } from "viem";
import { erc20Abi, quoterV2Abi } from "./abis.js";

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
  };
}

export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "n/a";
  return `$${usd.toFixed(2)}`;
}

export function formatEthUsd(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return "n/a";
  return `$${price.toFixed(2)}`;
}
