/**
 * CX Watcher — read-only Aerodrome Slipstream CX/WETH monitor on Base.
 * Polls pool state, quotes full bag, Telegram alerts. Never swaps or signs.
 */

import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  loadConfig,
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
  formatEthUsd,
  formatUsd,
  quoteCxToWeth,
  type QuoteResult,
} from "./quote.js";
import { loadState, saveState, type WatcherState } from "./state.js";
import { createTelegram, type TelegramClient } from "./telegram.js";

type AppClient = ReturnType<typeof createClient>;

const runOnce = process.argv.includes("--once");

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function logErr(...args: unknown[]): void {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = Math.min(30_000, 500 * 2 ** i);
      logErr(`${label} failed (attempt ${i + 1}/${attempts}):`, err);
      if (i < attempts - 1) await sleep(delay);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function createClient(rpcUrl: string) {
  return createPublicClient({
    chain: base,
    transport: http(rpcUrl, { timeout: 20_000, retryCount: 0 }),
  });
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
): Promise<QuoteResult | null> {
  try {
    return await withRetry("quote", () =>
      quoteCxToWeth(client, {
        quoter: cfg.quoterV2Address,
        cx: cfg.cxAddress,
        weth: cfg.wethAddress,
        cxAmountHuman: cfg.cxAmount,
        tickSpacing,
        slippageRefBps: cfg.quoteSlippageRefBps,
      }),
    );
  } catch (err) {
    logErr("Quote unavailable this cycle:", err);
    return null;
  }
}

function printStartupStatus(params: {
  rpcOk: boolean;
  snap: PoolSnapshot | null;
  cfg: Config;
  quote: QuoteResult | null;
  telegram: TelegramClient;
  windowOpen: boolean;
  bigActive: boolean;
}): void {
  const { rpcOk, snap, cfg, quote, telegram, windowOpen, bigActive } = params;
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
  console.log(
    `${quote ? quote.wethFormatted : "n/a"} WETH`,
  );
  console.log(`${formatUsd(quote?.usd ?? null)}`);
  console.log("");
  console.log(
    `Telegram: ${telegram.configured ? "connected" : "not configured"}`,
  );
  console.log(`Next check: ${Math.round(cfg.pollIntervalMs / 1000)}s`);
  console.log("");
}

async function processBurns(
  client: AppClient,
  cfg: Config,
  state: WatcherState,
  currentBlock: bigint,
  telegram: TelegramClient,
): Promise<void> {
  const fromBlock =
    state.lastProcessedBlock !== null
      ? BigInt(state.lastProcessedBlock) + 1n
      : currentBlock > 2000n
        ? currentBlock - 2000n
        : 0n;

  try {
    const hits = await withRetry("burn-logs", () =>
      findPositionBurns(client, {
        pool: cfg.poolAddress,
        npm: cfg.npmAddress,
        tickLower: cfg.tickBoundary,
        tickUpper: cfg.tickUpper,
        fromBlock,
        toBlock: currentBlock,
      }),
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

async function tickCycle(
  client: AppClient,
  cfg: Config,
  state: WatcherState,
  telegram: TelegramClient,
  opts: { isBoot: boolean },
): Promise<PoolSnapshot | null> {
  const snap = await withRetry("pool-read", () =>
    readPoolSnapshot(client, cfg.poolAddress),
  );

  const prevTick = state.lastTick;
  const bigActive = isBigLiquidityActive(snap.liquidity, cfg.bigLiquidityMin);
  const tickOpen = isWindowOpenByTick(snap.tick, cfg.tickBoundary);
  const windowOpen = tickOpen && bigActive;

  const quote = await tryQuote(client, cfg, snap.tickSpacing);

  if (quote) {
    state.lastQuoteWeth = quote.wethFormatted;
    state.lastQuoteUsd = quote.usd;
  }

  // --- Window open crossing ---
  const crossedOpen =
    prevTick !== null &&
    prevTick < cfg.tickBoundary &&
    snap.tick >= cfg.tickBoundary &&
    bigActive;

  const bootAlreadyOpen =
    opts.isBoot &&
    windowOpen &&
    !state.openAlertSent;

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

  // --- Window close crossing ---
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
    // Tick still "open" but liquidity collapsed without tick cross — treat as closed.
    if (tickOpen && !bigActive && state.openAlertSent) {
      log(`WINDOW EFFECTIVELY CLOSED (liquidity collapsed) tick=${snap.tick}`);
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

  // --- Tier upgrades while open ---
  if (state.openAlertSent && windowOpen && quote?.usd != null) {
    const tier = tierFromUsd(quote.usd, cfg);
    if (tierRank(tier) > tierRank(state.lastAlertedTier)) {
      log(`TIER UPGRADE ${tierLabel(state.lastAlertedTier)} -> ${tierLabel(tier)}`);
      await telegram.send(buildTierUpgradeAlert(snap, quote, cfg, tier));
      state.lastAlertedTier = tier;
    }
  }

  // --- Heartbeat ---
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

  // --- Burn watch ---
  await processBurns(client, cfg, state, snap.blockNumber, telegram);

  state.lastTick = snap.tick;
  await saveState(cfg.stateFile, state);

  log(
    `tick=${snap.tick} liq=${formatLiquidity(snap.liquidity)} window=${windowOpen ? "OPEN" : "CLOSED"} quote=${quote?.wethFormatted ?? "n/a"} WETH usd=${formatUsd(quote?.usd ?? null)} block=${snap.blockNumber}`,
  );

  return snap;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const telegram = createTelegram(cfg.telegramBotToken, cfg.telegramChatId);
  const state = await loadState(cfg.stateFile);
  const client = createClient(cfg.baseRpcUrl);

  let shuttingDown = false;
  const onSignal = (sig: string) => {
    log(`Received ${sig}, shutting down after current cycle…`);
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  let snap: PoolSnapshot | null = null;
  let quote: QuoteResult | null = null;
  let rpcOk = false;

  try {
    snap = await withRetry("startup-pool", () =>
      readPoolSnapshot(client, cfg.poolAddress),
    );
    rpcOk = true;
    quote = await tryQuote(client, cfg, snap.tickSpacing);
  } catch (err) {
    logErr("Startup RPC failed:", err);
  }

  const bigActive = snap
    ? isBigLiquidityActive(snap.liquidity, cfg.bigLiquidityMin)
    : false;
  const windowOpen = snap
    ? isWindowOpenByTick(snap.tick, cfg.tickBoundary) && bigActive
    : false;

  printStartupStatus({
    rpcOk,
    snap,
    cfg,
    quote,
    telegram,
    windowOpen,
    bigActive,
  });

  if (!rpcOk || !snap) {
    throw new Error("Cannot start without RPC / pool snapshot");
  }

  // Boot cycle handles "already open" alert + initializes burn cursor
  await tickCycle(client, cfg, state, telegram, { isBoot: true });

  if (runOnce) {
    log("(--once) exiting");
    return;
  }

  while (!shuttingDown) {
    await sleep(cfg.pollIntervalMs);
    if (shuttingDown) break;
    try {
      await tickCycle(client, cfg, state, telegram, { isBoot: false });
    } catch (err) {
      logErr("Cycle failed:", err);
    }
  }

  await saveState(cfg.stateFile, state);
  log("Shutdown complete");
}

main().catch((err) => {
  logErr("Fatal:", err);
  process.exit(1);
});
