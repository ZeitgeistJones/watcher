// Load and validate watcher configuration from an env map (Node or Workers).

import { type Address, isAddress } from "viem";

type EnvMap = Record<string, string | undefined>;

function required(env: EnvMap, name: string): string {
  const v = env[name]?.trim();
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(env: EnvMap, name: string, fallback: string): string {
  const v = env[name]?.trim();
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
  v2PoolAddress: Address;
  quoterV2Address: Address;
  mixedQuoterV3Address: Address;
  lpSugarAddress: Address;
  v2FactoryAddress: Address;
  clFactoryOldAddress: Address;
  clFactoryNewAddress: Address;
  npmAddress: Address;
  stateFile: string;
}

/** Build config from any env-like object (process.env or Worker env). */
export function loadConfigFromEnv(env: EnvMap): Config {
  const telegramBotToken = optional(env, "TELEGRAM_BOT_TOKEN", "");
  const telegramChatId = optional(env, "TELEGRAM_CHAT_ID", "");

  return {
    baseRpcUrl: required(env, "BASE_RPC_URL"),
    telegramBotToken: telegramBotToken || null,
    telegramChatId: telegramChatId || null,
    cxAmount: optional(env, "CX_AMOUNT", "11577.51"),
    pollIntervalMs: asInt(
      "POLL_INTERVAL_MS",
      optional(env, "POLL_INTERVAL_MS", "30000"),
    ),
    heartbeatIntervalMs: asInt(
      "HEARTBEAT_INTERVAL_MS",
      optional(env, "HEARTBEAT_INTERVAL_MS", "21600000"),
    ),
    tickBoundary: asInt(
      "TICK_BOUNDARY",
      optional(env, "TICK_BOUNDARY", "-115800"),
    ),
    tickUpper: asInt("TICK_UPPER", optional(env, "TICK_UPPER", "-94800")),
    bigLiquidityMin: asBigInt(
      "BIG_LIQUIDITY_MIN",
      optional(env, "BIG_LIQUIDITY_MIN", "1000000000000000000000"),
    ),
    alertWatchUsd: asFloat(
      "ALERT_WATCH_USD",
      optional(env, "ALERT_WATCH_USD", "200"),
    ),
    alertGoodUsd: asFloat(
      "ALERT_GOOD_USD",
      optional(env, "ALERT_GOOD_USD", "300"),
    ),
    alertStrongUsd: asFloat(
      "ALERT_STRONG_USD",
      optional(env, "ALERT_STRONG_USD", "400"),
    ),
    alertVeryStrongUsd: asFloat(
      "ALERT_VERY_STRONG_USD",
      optional(env, "ALERT_VERY_STRONG_USD", "500"),
    ),
    quoteSlippageRefBps: asInt(
      "QUOTE_SLIPPAGE_REF_BPS",
      optional(env, "QUOTE_SLIPPAGE_REF_BPS", "100"),
    ),
    alertOnWindowClose: asBool(
      "ALERT_ON_WINDOW_CLOSE",
      optional(env, "ALERT_ON_WINDOW_CLOSE", "true"),
    ),
    cxAddress: asAddress(
      "CX_ADDRESS",
      optional(env, "CX_ADDRESS", "0x000000000000012DeF132E61759048bE5b5C6033"),
    ),
    wethAddress: asAddress(
      "WETH_ADDRESS",
      optional(
        env,
        "WETH_ADDRESS",
        "0x4200000000000000000000000000000000000006",
      ),
    ),
    poolAddress: asAddress(
      "POOL_ADDRESS",
      optional(
        env,
        "POOL_ADDRESS",
        "0x9249F441005947831eaAF9135B319AD97BCD6Bdf",
      ),
    ),
    v2PoolAddress: asAddress(
      "V2_POOL_ADDRESS",
      optional(
        env,
        "V2_POOL_ADDRESS",
        "0x14eE8B85f8feb54E8d623425Bc365B5dde0800d2",
      ),
    ),
    quoterV2Address: asAddress(
      "QUOTER_V2_ADDRESS",
      optional(
        env,
        "QUOTER_V2_ADDRESS",
        "0x254cF9E1E6e233aa1AC962CB9B05b2cfeAaE15b0",
      ),
    ),
    mixedQuoterV3Address: asAddress(
      "MIXED_QUOTER_V3_ADDRESS",
      optional(
        env,
        "MIXED_QUOTER_V3_ADDRESS",
        "0xCd2A7D98e82D6107eac1828ce8DeAA6acB65b555",
      ),
    ),
    lpSugarAddress: asAddress(
      "LP_SUGAR_ADDRESS",
      optional(
        env,
        "LP_SUGAR_ADDRESS",
        "0x69dD9db6d8f8E7d83887A704f447b1a584b599A1",
      ),
    ),
    v2FactoryAddress: asAddress(
      "V2_FACTORY_ADDRESS",
      optional(
        env,
        "V2_FACTORY_ADDRESS",
        "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      ),
    ),
    clFactoryOldAddress: asAddress(
      "CL_FACTORY_OLD_ADDRESS",
      optional(
        env,
        "CL_FACTORY_OLD_ADDRESS",
        "0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A",
      ),
    ),
    clFactoryNewAddress: asAddress(
      "CL_FACTORY_NEW_ADDRESS",
      optional(
        env,
        "CL_FACTORY_NEW_ADDRESS",
        "0xf8f2eB4940CFE7d13603DDDD87f123820Fc061Ef",
      ),
    ),
    npmAddress: asAddress(
      "NPM_ADDRESS",
      optional(
        env,
        "NPM_ADDRESS",
        "0x827922686190790b37229fd06084350E74485b72",
      ),
    ),
    stateFile: optional(env, "STATE_FILE", "data/state.json"),
  };
}

/** Node convenience: reads process.env (call after dotenv). */
export function loadConfig(): Config {
  return loadConfigFromEnv(
    process.env as Record<string, string | undefined>,
  );
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

/** Known string env/secret names (explicit access — Object.entries misses CF secrets). */
const WORKER_STRING_KEYS = [
  "BASE_RPC_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "CX_AMOUNT",
  "POLL_INTERVAL_MS",
  "HEARTBEAT_INTERVAL_MS",
  "TICK_BOUNDARY",
  "TICK_UPPER",
  "BIG_LIQUIDITY_MIN",
  "ALERT_WATCH_USD",
  "ALERT_GOOD_USD",
  "ALERT_STRONG_USD",
  "ALERT_VERY_STRONG_USD",
  "QUOTE_SLIPPAGE_REF_BPS",
  "ALERT_ON_WINDOW_CLOSE",
  "CX_ADDRESS",
  "WETH_ADDRESS",
  "POOL_ADDRESS",
  "V2_POOL_ADDRESS",
  "QUOTER_V2_ADDRESS",
  "MIXED_QUOTER_V3_ADDRESS",
  "LP_SUGAR_ADDRESS",
  "V2_FACTORY_ADDRESS",
  "CL_FACTORY_OLD_ADDRESS",
  "CL_FACTORY_NEW_ADDRESS",
  "NPM_ADDRESS",
  "STATE_FILE",
] as const;

/**
 * Read Worker bindings by explicit key access.
 * Prefer `env.*`; fall back to `process.env` when nodejs_compat populates it.
 * Do NOT use Object.entries(env) — Cloudflare secret bindings are often non-enumerable.
 */
export function envRecordFromWorker(env: object): EnvMap {
  const record = env as Record<string, unknown>;
  const proc =
    typeof process !== "undefined" && process.env
      ? (process.env as Record<string, string | undefined>)
      : undefined;
  const out: EnvMap = {};
  for (const key of WORKER_STRING_KEYS) {
    const v = record[key] ?? proc?.[key];
    if (typeof v === "string") {
      out[key] = v;
    } else if (typeof v === "number" || typeof v === "boolean") {
      out[key] = String(v);
    }
  }
  return out;
}
