/**
 * Cloudflare Worker entry — scheduled cron every minute.
 * Same read-only watcher logic as Node; state in KV (CX_WATCHER_STATE).
 */

import {
  envRecordFromWorker,
  loadConfigFromEnv,
} from "./config.js";
import {
  printStartupStatus,
  runWatcherOnce,
} from "./cycle.js";
import { createKvStateStore } from "./state-kv.js";
import { createTelegram } from "./telegram.js";

export interface Env {
  BASE_RPC_URL: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  CX_AMOUNT?: string;
  HEARTBEAT_INTERVAL_MS?: string;
  TICK_BOUNDARY?: string;
  TICK_UPPER?: string;
  BIG_LIQUIDITY_MIN?: string;
  ALERT_WATCH_USD?: string;
  ALERT_GOOD_USD?: string;
  ALERT_STRONG_USD?: string;
  ALERT_VERY_STRONG_USD?: string;
  QUOTE_SLIPPAGE_REF_BPS?: string;
  ALERT_ON_WINDOW_CLOSE?: string;
  CX_ADDRESS?: string;
  WETH_ADDRESS?: string;
  POOL_ADDRESS?: string;
  QUOTER_V2_ADDRESS?: string;
  NPM_ADDRESS?: string;
  /** KV namespace binding — required */
  CX_WATCHER_STATE: KVNamespace;
}

async function runScheduled(env: Env): Promise<Response> {
  // Safe binding diagnostics — booleans/types only, never secret values.
  const hasTelegramBotToken = Boolean(env.TELEGRAM_BOT_TOKEN);
  const hasTelegramChatId = Boolean(env.TELEGRAM_CHAT_ID);
  console.log(
    `[cx-watcher] telegramBindings hasTelegramBotToken=${hasTelegramBotToken} hasTelegramChatId=${hasTelegramChatId} tokenType=${typeof env.TELEGRAM_BOT_TOKEN} chatIdType=${typeof env.TELEGRAM_CHAT_ID}`,
  );

  const cfg = loadConfigFromEnv(envRecordFromWorker(env));
  const store = createKvStateStore(env.CX_WATCHER_STATE);
  const telegram = createTelegram(cfg.telegramBotToken, cfg.telegramChatId);

  // Tighter retries for Workers wall-clock / CPU limits.
  const result = await runWatcherOnce({
    cfg,
    store,
    opts: { retryAttempts: 3, maxBackoffMs: 2_000 },
  });

  // One concise line per cron for Cloudflare Workers Logs / observability.
  console.log(
    `[cx-watcher] block=${result.snap.blockNumber.toString()} tick=${result.snap.tick} liquidity=${result.snap.liquidity.toString()} window=${result.windowOpen ? "OPEN" : "CLOSED"} quote=${result.quote?.wethFormatted ?? "n/a"} WETH usd=${result.quote?.usd ?? "n/a"}`,
  );

  printStartupStatus({
    rpcOk: true,
    snap: result.snap,
    cfg,
    quote: result.quote,
    telegram,
    windowOpen: result.windowOpen,
    bigActive: result.bigActive,
    nextCheckLabel: "1m (cron)",
  });

  return new Response(
    JSON.stringify({
      ok: true,
      tick: result.snap.tick,
      liquidity: result.snap.liquidity.toString(),
      window: result.windowOpen ? "OPEN" : "CLOSED",
      quoteWeth: result.quote?.wethFormatted ?? null,
      quoteUsd: result.quote?.usd ?? null,
      block: result.snap.blockNumber.toString(),
    }),
    { headers: { "content-type": "application/json" } },
  );
}

export default {
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      await runScheduled(env);
    } catch (err: unknown) {
      console.error(`[${new Date().toISOString()}] scheduled failed:`, err);
      throw err;
    }
  },

  /** Manual / health trigger for local wrangler testing. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/run" || url.pathname === "/") {
      try {
        return await runScheduled(env);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${new Date().toISOString()}] fetch run failed:`, err);
        return new Response(JSON.stringify({ ok: false, error: message }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("CX Watcher Worker — POST/GET /run or wait for cron", {
      status: 404,
    });
  },
};
