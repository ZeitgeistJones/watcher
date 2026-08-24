// Load and validate watcher configuration from environment variables.

import "dotenv/config";
import { type Address, isAddress } from "viem";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : fallback;
}

function asAddress(name: string, value: string): Address {
  if (!isAddress(value)) throw new Error(`Invalid address for ${name}: ${value}`);
  return value;
}

function asInt(name: string, value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Invalid integer for ${name}: ${value}`);
  return n;
}

function asFloat(name: string, value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid number for ${name}: ${value}`);
  return n;
}

function asBool(name: string, value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === "true" || v === "1" || v === "yes") return true;
  if (v === "false" || v === "0" || v === "no") return false;
  throw new Error(`Invalid boolean for ${name}: ${value}`);
}

function asBigInt(name: string, value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid bigint for ${name}: ${value}`);
  }
}

export type AlertTier = "none" | "watch" | "good" | "strong" | "very_strong";

export interface Config {
  baseRpcUrl: string;
  telegramBotToken: string | null;
  telegramChatId: string | null;
  cxAmount: string;
  pollIntervalMs: number;
  heartbeatIntervalMs: number;
  tickBoundary: number;
  tickUpper: number;
  bigLiquidityMin: bigint;
  alertWatchUsd: number;
  alertGoodUsd: number;
  alertStrongUsd: number;
  alertVeryStrongUsd: number;
  quoteSlippageRefBps: number;
  alertOnWindowClose: boolean;
  cxAddress: Address;
  wethAddress: Address;
  poolAddress: Address;
  quoterV2Address: Address;
  npmAddress: Address;
  stateFile: string;
}

export function loadConfig(): Config {
  const telegramBotToken = optional("TELEGRAM_BOT_TOKEN", "");
  const telegramChatId = optional("TELEGRAM_CHAT_ID", "");

  return {
    baseRpcUrl: required("BASE_RPC_URL"),
    telegramBotToken: telegramBotToken || null,
    telegramChatId: telegramChatId || null,
    cxAmount: optional("CX_AMOUNT", "11577.51"),
    pollIntervalMs: asInt("POLL_INTERVAL_MS", optional("POLL_INTERVAL_MS", "30000")),
    heartbeatIntervalMs: asInt(
      "HEARTBEAT_INTERVAL_MS",
      optional("HEARTBEAT_INTERVAL_MS", "21600000"),
    ),
    tickBoundary: asInt("TICK_BOUNDARY", optional("TICK_BOUNDARY", "-115800")),
    tickUpper: asInt("TICK_UPPER", optional("TICK_UPPER", "-94800")),
    bigLiquidityMin: asBigInt(
      "BIG_LIQUIDITY_MIN",
      optional("BIG_LIQUIDITY_MIN", "1000000000000000000000"),
    ),
    alertWatchUsd: asFloat("ALERT_WATCH_USD", optional("ALERT_WATCH_USD", "200")),
    alertGoodUsd: asFloat("ALERT_GOOD_USD", optional("ALERT_GOOD_USD", "300")),
    alertStrongUsd: asFloat("ALERT_STRONG_USD", optional("ALERT_STRONG_USD", "400")),
    alertVeryStrongUsd: asFloat(
      "ALERT_VERY_STRONG_USD",
      optional("ALERT_VERY_STRONG_USD", "500"),
    ),
    quoteSlippageRefBps: asInt(
      "QUOTE_SLIPPAGE_REF_BPS",
      optional("QUOTE_SLIPPAGE_REF_BPS", "100"),
    ),
    alertOnWindowClose: asBool(
      "ALERT_ON_WINDOW_CLOSE",
      optional("ALERT_ON_WINDOW_CLOSE", "true"),
    ),
    cxAddress: asAddress(
      "CX_ADDRESS",
      optional("CX_ADDRESS", "0x000000000000012DeF132E61759048bE5b5C6033"),
    ),
    wethAddress: asAddress(
      "WETH_ADDRESS",
      optional("WETH_ADDRESS", "0x4200000000000000000000000000000000000006"),
    ),
    poolAddress: asAddress(
      "POOL_ADDRESS",
      optional("POOL_ADDRESS", "0x9249F441005947831eaAF9135B319AD97BCD6Bdf"),
    ),
    quoterV2Address: asAddress(
      "QUOTER_V2_ADDRESS",
      optional("QUOTER_V2_ADDRESS", "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0"),
    ),
    npmAddress: asAddress(
      "NPM_ADDRESS",
      optional("NPM_ADDRESS", "0x827922686190790b37229fd06084350E74485b72"),
    ),
    stateFile: optional("STATE_FILE", "data/state.json"),
  };
}

export function tierFromUsd(usd: number | null, cfg: Config): AlertTier {
  if (usd === null || !Number.isFinite(usd)) return "none";
  if (usd >= cfg.alertVeryStrongUsd) return "very_strong";
  if (usd >= cfg.alertStrongUsd) return "strong";
  if (usd >= cfg.alertGoodUsd) return "good";
  if (usd >= cfg.alertWatchUsd) return "watch";
  return "none";
}

export function tierRank(tier: AlertTier): number {
  switch (tier) {
    case "none":
      return 0;
    case "watch":
      return 1;
    case "good":
      return 2;
    case "strong":
      return 3;
    case "very_strong":
      return 4;
  }
}

export function tierLabel(tier: AlertTier): string {
  switch (tier) {
    case "none":
      return "NONE";
    case "watch":
      return "WATCH";
    case "good":
      return "GOOD";
    case "strong":
      return "STRONG";
    case "very_strong":
      return "VERY_STRONG";
  }
}
