/**
 * Shared watcher cycle — used by Node (local/Railway) and Cloudflare Worker.
 * Read-only: never swaps or signs.
 */

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  tierFromUsd,
  tierLabel,
  tierRank,
  type AlertTier,
  type Config,
} from "./config.js";
import {
  findPositionBurns,
  formatLiquidity,
  isBigLiquidityActive,
  isWindowOpenByTick,
  readPoolSnapshot,
  type PoolSnapshot,
} from "./pool.js";
import {
  diagnoseCxToWethQuote,
  formatEthUsd,
  formatUsd,
  logQuoteDiagnostic,
  quoteCxToWeth,
  type QuoteResult,
} from "./quote.js";
import type { StateStore, WatcherState } from "./state.js";
import { createTelegram, type TelegramClient } from "./telegram.js";

export type AppClient = ReturnType<typeof createRpcClient>;

export interface CycleOptions {
  isBoot: boolean;
  /** Retry attempts for RPC/quote (Workers should use fewer). */
  retryAttempts?: number;
  /** Cap backoff delay (Workers should keep this low). */
  maxBackoffMs?: number;
}

export interface CycleResult {
  snap: PoolSnapshot;
  quote: QuoteResult | null;
  windowOpen: boolean;
  bigActive: boolean;
  state: WatcherState;
}

export function createRpcClient(rpcUrl: string) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }),
  });
}

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function logErr(...args: unknown[]): void {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts: number,
  maxBackoffMs: number,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = Math.min(maxBackoffMs, 400 * 2 ** i);
      logErr(`${label} failed (attempt ${i + 1}/${attempts}):`, err);
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function formatTick(tick: number): string {
  return tick.toLocaleString("en-US");
}

function buildOpenAlert(
  snap: PoolSnapshot,
  quote: QuoteResult | null,
  cfg: Config,
  tier: AlertTier,
): string {
  const tierBanner =
    tier === "very_strong"
      ? "\n🔥🔥🔥 TIER: VERY_STRONG\n"
      : tier === "strong"
        ? "\n🔥🔥 TIER: STRONG\n"
        : tier === "good"
          ? "\n🔥 TIER: GOOD\n"
          : tier === "watch"
            ? "\n👁 TIER: WATCH\n"
            : "\n";

  const weth = quote?.wethFormatted ?? "n/a";
  const ethUsd = formatEthUsd(quote?.ethUsd ?? null);
  const approx = formatUsd(quote?.usd ?? null);
  const minOut = quote?.minOutRefFormatted ?? "n/a";

  return (
    `🚨 CX EXIT WINDOW OPEN${tierBanner}\n` +
    `Tick: ${formatTick(snap.tick)}\n` +
    `Active liquidity: ${formatLiquidity(snap.liquidity)}\n` +
    `Block: ${snap.blockNumber.toString()}\n\n` +
    `Full bag:\n${cfg.cxAmount} CX\n\n` +
    `Quote:\n${weth} WETH\n\n` +
    `ETH/USD:\n${ethUsd}\n\n` +
    `Approx value:\n${approx}\n\n` +
    `1% minimum-output reference:\n${minOut} WETH\n\n` +
    `Status:\nBIG CX/WETH LIQUIDITY ACTIVE\n\n` +
    `Aerodrome:\nhttps://aerodrome.finance/swap\n\n` +
    `Timestamp:\n${new Date().toISOString()}`
  );
}

function buildTierUpgradeAlert(
  snap: PoolSnapshot,
  quote: QuoteResult,
  cfg: Config,
  tier: AlertTier,
): string {
  return (
    `📈 CX QUOTE TIER UPGRADE: ${tierLabel(tier)}\n\n` +
    `Tick: ${formatTick(snap.tick)}\n` +
    `Active liquidity: ${formatLiquidity(snap.liquidity)}\n` +
    `Block: ${snap.blockNumber.toString()}\n\n` +
    `Full bag: ${cfg.cxAmount} CX\n` +
    `Quote: ${quote.wethFormatted} WETH\n` +
    `ETH/USD: ${formatEthUsd(quote.ethUsd)}\n` +
    `Approx value: ${formatUsd(quote.usd)}\n\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

function buildClosedAlert(
  snap: PoolSnapshot,
  quote: QuoteResult | null,
): string {
  const q =
    quote !== null
      ? `${quote.wethFormatted} WETH (${formatUsd(quote.usd)})`
      : "n/a";

  return (
    `⚠️ CX EXIT WINDOW CLOSED\n\n` +
    `Current tick:\n${formatTick(snap.tick)}\n\n` +
    `Active liquidity:\n${formatLiquidity(snap.liquidity)}\n\n` +
    `Latest full-bag quote if obtainable:\n${q}\n\n` +
    `Block: ${snap.blockNumber.toString()}\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

function buildBurnAlert(hit: {
  blockNumber: bigint;
  txHash: `0x${string}`;
  liquidityBurned: bigint;
}): string {
  const explorer = `https://basescan.org/tx/${hit.txHash}`;
  return (
    `🛑 CX BIG LP POSITION BURNED\n\n` +
    `The large concentrated-liquidity position appears to have been reduced/removed.\n\n` +
    `Block:\n${hit.blockNumber.toString()}\n\n` +
    `Tx:\n${hit.txHash}\n\n` +
    `Burn liquidity amount:\n${hit.liquidityBurned.toString()}\n\n` +
    `Explorer link:\n${explorer}\n\n` +
    `This may mean the previous exit-liquidity setup no longer exists.\n\n` +
    `Timestamp: ${new Date().toISOString()}`
  );
}

function buildHeartbeat(
  snap: PoolSnapshot,
  quote: QuoteResult | null,
  windowOpen: boolean,
): string {
  return (
    `CX watcher alive\n` +
    `tick: ${formatTick(snap.tick)}\n` +
    `liquidity: ${formatLiquidity(snap.liquidity)}\n` +
    `window: ${windowOpen ? "OPEN" : "CLOSED"}\n` +
    `full-bag quote: ${quote?.wethFormatted ?? "n/a"} WETH\n` +
    `USD value: ${formatUsd(quote?.usd ?? null)}\n` +
    `latest block: ${snap.blockNumber.toString()}\n` +
    `time: ${new Date().toISOString()}`
  );
}

async function tryQuote(
  client: AppClient,
  cfg: Config,
  tickSpacing: number,
  attempts: number,
  maxBackoffMs: number,
): Promise<QuoteResult | null> {
  try {
    return await withRetry(
      "quote",
      () =>
        quoteCxToWeth(client, {
          quoter: cfg.quoterV2Address,
          cx: cfg.cxAddress,
          weth: cfg.wethAddress,
          cxAmountHuman: cfg.cxAmount,
          tickSpacing,
          slippageRefBps: cfg.quoteSlippageRefBps,
        }),
      attempts,
      maxBackoffMs,
    );
  } catch (err) {
    logErr("Quote unavailable this cycle:", err);
    return null;
  }
}

async function processBurns(
  client: AppClient,
  cfg: Config,
  state: WatcherState,
  currentBlock: bigint,
  telegram: TelegramClient,
  attempts: number,
  maxBackoffMs: number,
): Promise<void> {
  // Keep lookback short so free public RPCs don't reject as "archive".
  // ~150 Base blocks ≈ 5 minutes — enough between cron/polls once state is warm.
  const BURN_LOOKBACK_BLOCKS = 150n;
  const fromBlock =
    state.lastProcessedBlock !== null
      ? BigInt(state.lastProcessedBlock) + 1n
      : currentBlock > BURN_LOOKBACK_BLOCKS
        ? currentBlock - BURN_LOOKBACK_BLOCKS
        : 0n;

  try {
    const hits = await withRetry(
      "burn-logs",
      () =>
        findPositionBurns(client, {
          pool: cfg.poolAddress,
          npm: cfg.npmAddress,
          tickLower: cfg.tickBoundary,
          tickUpper: cfg.tickUpper,
          fromBlock,
          toBlock: currentBlock,
        }),
      attempts,
      maxBackoffMs,
    );

    for (const hit of hits) {
      if (hit.txHash === state.lastBurnTxHash) continue;
      log(
        `Burn detected tx=${hit.txHash} liquidity=${hit.liquidityBurned.toString()}`,
      );
      await telegram.send(buildBurnAlert(hit));
      state.lastBurnTxHash = hit.txHash;
    }
  } catch (err) {
    logErr("Burn scan failed:", err);
  }

  state.lastProcessedBlock = Number(currentBlock);
}

export function printStartupStatus(params: {
  rpcOk: boolean;
  snap: PoolSnapshot | null;
  cfg: Config;
  quote: QuoteResult | null;
  telegram: TelegramClient;
  windowOpen: boolean;
  bigActive: boolean;
  nextCheckLabel: string;
}): void {
  const {
    rpcOk,
    snap,
    cfg,
    quote,
    telegram,
    windowOpen,
    bigActive,
    nextCheckLabel,
  } = params;
  console.log("");
  console.log("CX WATCHER");
  console.log(`RPC connected: ${rpcOk ? "yes" : "no"}`);
  console.log(`Block: ${snap ? snap.blockNumber.toString() : "n/a"}`);
  console.log(`Tick: ${snap ? formatTick(snap.tick) : "n/a"}`);
  console.log(`Boundary: ${cfg.tickBoundary}`);
  console.log(`Window: ${windowOpen ? "OPEN" : "CLOSED"}`);
  console.log(
    `Active liquidity: ${snap ? formatLiquidity(snap.liquidity) : "n/a"}`,
  );
  console.log(`Big liquidity active: ${bigActive ? "yes" : "no"}`);
  console.log("");
  console.log(`${cfg.cxAmount} CX quote:`);
  console.log(`${quote ? quote.wethFormatted : "n/a"} WETH`);
  console.log(`${formatUsd(quote?.usd ?? null)}`);
  console.log("");
  console.log(
    `Telegram: ${telegram.configured ? "connected" : "not configured"}`,
  );
  console.log(`Next check: ${nextCheckLabel}`);
  console.log("");
}

/** One full monitor cycle: pool → quote → alerts → burns → persist. */
export async function runTickCycle(
  client: AppClient,
  cfg: Config,
  state: WatcherState,
  telegram: TelegramClient,
  store: StateStore,
  opts: CycleOptions,
): Promise<CycleResult> {
  const attempts = opts.retryAttempts ?? 5;
  const maxBackoffMs = opts.maxBackoffMs ?? 30_000;

  const snap = await withRetry(
    "pool-read",
    () => readPoolSnapshot(client, cfg.poolAddress),
    attempts,
    maxBackoffMs,
  );

  const prevTick = state.lastTick;
  const bigActive = isBigLiquidityActive(snap.liquidity, cfg.bigLiquidityMin);
  const tickOpen = isWindowOpenByTick(snap.tick, cfg.tickBoundary);
  const windowOpen = tickOpen && bigActive;

  const quote = await tryQuote(
    client,
    cfg,
    snap.tickSpacing,
    attempts,
    maxBackoffMs,
  );

  // Quote diagnostics only — does not affect alerts / thresholds.
  try {
    const diag5k = await diagnoseCxToWethQuote(client, {
      label: "diag-5000-CX",
      pool: cfg.poolAddress,
      quoter: cfg.quoterV2Address,
      cx: cfg.cxAddress,
      weth: cfg.wethAddress,
      cxAmountHuman: "5000",
      tick: snap.tick,
      tickSpacing: snap.tickSpacing,
      sqrtPriceX96: snap.sqrtPriceX96,
      liquidity: snap.liquidity,
      blockNumber: snap.blockNumber,
    });
    logQuoteDiagnostic(diag5k);

    if (quote) {
      log(
        `[quote-diag] full-bag=${cfg.cxAmount} amountInRaw=${quote.amountIn.toString()} amountOutRaw=${quote.amountOut.toString()} amountOutWeth=${quote.wethFormatted} sqrtPriceX96After=${quote.sqrtPriceX96After?.toString() ?? "n/a"} ticksCrossed=${quote.initializedTicksCrossed ?? "n/a"} cxDecimals=${quote.cxDecimals ?? "n/a"} tickSpacing=${snap.tickSpacing}`,
      );
      if (diag5k.amountOutRaw === quote.amountOut.toString()) {
        log(
          "[quote-diag] WARNING: 5000 CX and full-bag returned identical amountOut (likely liquidity exhausted / price limit hit)",
        );
      }
    }
  } catch (err) {
    logErr("Quote diagnostic failed (non-fatal):", err);
  }

  if (quote) {
    state.lastQuoteWeth = quote.wethFormatted;
    state.lastQuoteUsd = quote.usd;
  }

  const crossedOpen =
    prevTick !== null &&
    prevTick < cfg.tickBoundary &&
    snap.tick >= cfg.tickBoundary &&
    bigActive;

  const bootAlreadyOpen = opts.isBoot && windowOpen && !state.openAlertSent;

  if (crossedOpen || bootAlreadyOpen) {
    const tier = tierFromUsd(quote?.usd ?? null, cfg);
    log(
      `WINDOW OPEN tick=${snap.tick} liq=${formatLiquidity(snap.liquidity)} tier=${tierLabel(tier)}`,
    );
    await telegram.send(buildOpenAlert(snap, quote, cfg, tier));
    state.windowOpen = true;
    state.openAlertSent = true;
    state.lastAlertedTier = tier;
  }

  const crossedClosed =
    prevTick !== null &&
    prevTick >= cfg.tickBoundary &&
    snap.tick < cfg.tickBoundary;

  if (crossedClosed) {
    log(`WINDOW CLOSED tick=${snap.tick}`);
    if (cfg.alertOnWindowClose) {
      await telegram.send(buildClosedAlert(snap, quote));
    }
    state.windowOpen = false;
    state.openAlertSent = false;
    state.lastAlertedTier = "none";
  } else if (!windowOpen && state.windowOpen) {
    if (tickOpen && !bigActive && state.openAlertSent) {
      log(
        `WINDOW EFFECTIVELY CLOSED (liquidity collapsed) tick=${snap.tick}`,
      );
      if (cfg.alertOnWindowClose) {
        await telegram.send(buildClosedAlert(snap, quote));
      }
      state.windowOpen = false;
      state.openAlertSent = false;
      state.lastAlertedTier = "none";
    }
  } else {
    state.windowOpen = windowOpen;
  }

  if (state.openAlertSent && windowOpen && quote?.usd != null) {
    const tier = tierFromUsd(quote.usd, cfg);
    if (tierRank(tier) > tierRank(state.lastAlertedTier)) {
      log(
        `TIER UPGRADE ${tierLabel(state.lastAlertedTier)} -> ${tierLabel(tier)}`,
      );
      await telegram.send(buildTierUpgradeAlert(snap, quote, cfg, tier));
      state.lastAlertedTier = tier;
    }
  }

  const now = Date.now();
  if (
    telegram.configured &&
    (state.lastHeartbeatAt === null ||
      now - state.lastHeartbeatAt >= cfg.heartbeatIntervalMs)
  ) {
    await telegram.send(buildHeartbeat(snap, quote, windowOpen));
    state.lastHeartbeatAt = now;
    log("Heartbeat sent");
  }

  await processBurns(
    client,
    cfg,
    state,
    snap.blockNumber,
    telegram,
    attempts,
    maxBackoffMs,
  );

  state.lastTick = snap.tick;
  await store.save(state);

  log(
    `tick=${snap.tick} liq=${formatLiquidity(snap.liquidity)} window=${windowOpen ? "OPEN" : "CLOSED"} quote=${quote?.wethFormatted ?? "n/a"} WETH usd=${formatUsd(quote?.usd ?? null)} block=${snap.blockNumber}`,
  );

  return { snap, quote, windowOpen, bigActive, state };
}

/** Load state, run one cycle. Worker and Node both call this. */
export async function runWatcherOnce(params: {
  cfg: Config;
  store: StateStore;
  opts?: Partial<CycleOptions>;
}): Promise<CycleResult> {
  const { cfg, store } = params;
  const retryAttempts = params.opts?.retryAttempts ?? 5;
  const maxBackoffMs = params.opts?.maxBackoffMs ?? 30_000;

  const telegram = createTelegram(cfg.telegramBotToken, cfg.telegramChatId);
  const state = await store.load();
  const client = createRpcClient(cfg.baseRpcUrl);

  // First-ever run (no prior tick) acts as boot for already-open detection.
  const isBoot = params.opts?.isBoot ?? state.lastTick === null;

  return runTickCycle(client, cfg, state, telegram, store, {
    isBoot,
    retryAttempts,
    maxBackoffMs,
  });
}
