// Shared quote helpers (ETH/USD, CX decimals).

import { type Address, type PublicClient } from "viem";
import { erc20Abi } from "./abis.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = PublicClient<any, any>;

let cachedDecimals: number | null = null;
let ethUsdCache: { price: number; fetchedAt: number } | null = null;
const ETH_USD_TTL_MS = 5 * 60 * 1000;

export async function getCxDecimals(client: Rpc, cx: Address): Promise<number> {
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

export function formatUsd(usd: number | null): string {
  if (usd === null || !Number.isFinite(usd)) return "n/a";
  return `$${usd.toFixed(2)}`;
}

export function formatEthUsd(price: number | null): string {
  if (price === null || !Number.isFinite(price)) return "n/a";
  return `$${price.toFixed(2)}`;
}
