// Cloudflare KV state store.

import {
  parseState,
  serializeState,
  type StateStore,
  type WatcherState,
} from "./state.js";

export const KV_STATE_KEY = "watcher:state";

export function createKvStateStore(
  kv: KVNamespace,
  key: string = KV_STATE_KEY,
): StateStore {
  return {
    async load(): Promise<WatcherState> {
      const raw = await kv.get(key);
      return parseState(raw);
    },
    async save(state: WatcherState): Promise<void> {
      await kv.put(key, serializeState(state));
    },
  };
}
