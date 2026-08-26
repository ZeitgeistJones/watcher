// Best-route CX -> WETH quote via Aerodrome MixedRouteQuoterV3 + soft ETH/USD.

import { type Address, type PublicClient, formatUnits } from "viem";
import type { Config } from "./config.js";
import {
  fetchEthUsd,
  formatEthUsd,
  formatUsd,
  getCxDecimals,
} from "./quote-utils.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rpc = PublicClient<any, any>;

import {
  BASE_CONNECTOR_TOKENS,
  buildManualCxPools,
  type QuoteRouteKind,
  quoteBestCxToWethRoute,
} from "./routes.js";

export interface QuoteResult {
  amountIn: bigint;
  amountOut: bigint;
  wethFormatted: string;
  usd: number | null;
  ethUsd: number | null;
  minOutRef: bigint;
  minOutRefFormatted: string;
  routeKind: QuoteRouteKind;
  routePools: Address[];
  mixedPathHex: string;
  /** Per-route candidate outputs (same amountIn), for diagnostics. */
  candidateSummary: string;
  cxDecimals: number;
}

export type { QuoteRouteKind };

export { formatEthUsd, formatUsd, getCxDecimals, fetchEthUsd };

export async function quoteCxToWeth(
  client: Rpc,
  cfg: Config,
  cxAmountHuman: string,
): Promise<QuoteResult> {
  const decimals = await getCxDecimals(client, cfg.cxAddress);
  const manualPools = buildManualCxPools({
    cx: cfg.cxAddress,
    weth: cfg.wethAddress,
    v2Pool: cfg.v2PoolAddress,
    clPool: cfg.poolAddress,
    v2Factory: cfg.v2FactoryAddress,
    clFactoryOld: cfg.clFactoryOldAddress,
    clTickSpacing: 200,
  });

  const best = await quoteBestCxToWethRoute(client, {
    mixedQuoter: cfg.mixedQuoterV3Address,
    lpSugar: cfg.lpSugarAddress,
    cx: cfg.cxAddress,
    weth: cfg.wethAddress,
    cxAmountHuman,
    cxDecimals: decimals,
    manualPools,
    connectors: BASE_CONNECTOR_TOKENS,
    clFactoryOld: cfg.clFactoryOldAddress,
    clFactoryNew: cfg.clFactoryNewAddress,
  });

  if (!best) {
    throw new Error("No viable CX→WETH route from MixedRouteQuoterV3");
  }

  const bps = BigInt(cfg.quoteSlippageRefBps);
  const minOutRef = best.amountOut - (best.amountOut * bps) / 10_000n;
  const ethUsd = await fetchEthUsd();
  const wethFormatted = best.wethFormatted;
  let usd: number | null = null;
  if (ethUsd !== null) {
    usd = Number(wethFormatted) * ethUsd;
  }

  const candidateSummary = best.candidates
    .map(
      (c) =>
        `${c.kind}=${formatUnits(c.amountOut, 18)} WETH pools=${c.hops.map((h) => h.pool.lp.slice(0, 10)).join(",")}`,
    )
    .join("; ");

  return {
    amountIn: best.amountIn,
    amountOut: best.amountOut,
    wethFormatted,
    usd,
    ethUsd,
    minOutRef,
    minOutRefFormatted: formatUnits(minOutRef, 18),
    routeKind: best.kind,
    routePools: best.poolAddresses,
    mixedPathHex: best.mixedPathHex,
    candidateSummary,
    cxDecimals: decimals,
  };
}

export function logQuoteResult(label: string, quote: QuoteResult, block?: bigint): void {
  console.log(
    `[quote] ${label} block=${block?.toString() ?? "n/a"} winner=${quote.routeKind} ` +
      `weth=${quote.wethFormatted} usd=${quote.usd ?? "n/a"} pools=${quote.routePools.join(",")} ` +
      `candidates=[${quote.candidateSummary}]`,
  );
}
