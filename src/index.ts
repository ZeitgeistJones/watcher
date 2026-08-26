/**
 * CX Watcher — Node entry (local / Railway).
 * Long-running loop. For Cloudflare Workers see src/worker.ts.
 */

import "dotenv/config";
import {
  createRpcClient,
  printStartupStatus,
  runTickCycle,
  runWatcherOnce,
} from "./cycle.js";
import { loadConfig } from "./config.js";
import {
  isBigLiquidityActive,
  isWindowOpenByTick,
  readPoolSnapshot,
} from "./pool.js";
import { quoteCxToWeth } from "./quote.js";
import { createFileStateStore } from "./state-file.js";
import { createTelegram } from "./telegram.js";

const runOnce = process.argv.includes("--once");

function log(...args: unknown[]): void {
  console.log(`[${new Date().toISOString()}]`, ...args);
}

function logErr(...args: unknown[]): void {
  console.error(`[${new Date().toISOString()}]`, ...args);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const store = createFileStateStore(cfg.stateFile);
  const telegram = createTelegram(cfg.telegramBotToken, cfg.telegramChatId);
  const client = createRpcClient(cfg.baseRpcUrl);

  let shuttingDown = false;
  const onSignal = (sig: string) => {
    log(`Received ${sig}, shutting down after current cycle…`);
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  let rpcOk = false;
  let snap = null;
  let quote = null;

  try {
    snap = await readPoolSnapshot(client, cfg.poolAddress);
    rpcOk = true;
    try {
      quote = await quoteCxToWeth(client, cfg, cfg.cxAmount);
    } catch (err) {
      logErr("Startup quote failed:", err);
    }
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
    nextCheckLabel: `${Math.round(cfg.pollIntervalMs / 1000)}s`,
  });

  if (!rpcOk || !snap) {
    throw new Error("Cannot start without RPC / pool snapshot");
  }

  const state = await store.load();
  await runTickCycle(client, cfg, state, telegram, store, {
    isBoot: true,
    retryAttempts: 5,
    maxBackoffMs: 30_000,
  });

  if (runOnce) {
    log("(--once) exiting");
    return;
  }

  while (!shuttingDown) {
    await sleep(cfg.pollIntervalMs);
    if (shuttingDown) break;
    try {
      await runWatcherOnce({
        cfg,
        store,
        opts: { isBoot: false, retryAttempts: 5, maxBackoffMs: 30_000 },
      });
    } catch (err) {
      logErr("Cycle failed:", err);
    }
  }

  log("Shutdown complete");
}

main().catch((err) => {
  logErr("Fatal:", err);
  process.exit(1);
});
