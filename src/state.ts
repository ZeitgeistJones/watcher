// Watcher state shape + parse/serialize (no filesystem — Node and Workers both use this).

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

export const DEFAULT_STATE: WatcherState = {
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

export interface StateStore {
  load(): Promise<WatcherState>;
  save(state: WatcherState): Promise<void>;
}

export function parseState(raw: string | null | undefined): WatcherState {
  if (!raw) return { ...DEFAULT_STATE };
  try {
    const parsed = JSON.parse(raw) as Partial<WatcherState>;
    return {
      ...DEFAULT_STATE,
      ...parsed,
      lastAlertedTier: parsed.lastAlertedTier ?? "none",
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function serializeState(state: WatcherState): string {
  return JSON.stringify(state);
}
