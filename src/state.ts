// Persist minimal watcher state to avoid duplicate alerts across restarts.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AlertTier } from "./config.js";

export interface WatcherState {
  lastTick: number | null;
  windowOpen: boolean;
  openAlertSent: boolean;
  lastAlertedTier: AlertTier;
  lastHeartbeatAt: number | null;
  lastProcessedBlock: number | null;
  lastBurnTxHash: string | null;
  lastQuoteWeth: string | null;
  lastQuoteUsd: number | null;
}

const DEFAULT_STATE: WatcherState = {
  lastTick: null,
  windowOpen: false,
  openAlertSent: false,
  lastAlertedTier: "none",
  lastHeartbeatAt: null,
  lastProcessedBlock: null,
  lastBurnTxHash: null,
  lastQuoteWeth: null,
  lastQuoteUsd: null,
};

export async function loadState(filePath: string): Promise<WatcherState> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<WatcherState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      lastAlertedTier: parsed.lastAlertedTier ?? "none",
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return { ...DEFAULT_STATE };
    throw err;
  }
}

export async function saveState(filePath: string, state: WatcherState): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
