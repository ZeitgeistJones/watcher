// Node filesystem state store (local / Railway).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  parseState,
  serializeState,
  type StateStore,
  type WatcherState,
} from "./state.js";

export function createFileStateStore(filePath: string): StateStore {
  return {
    async load(): Promise<WatcherState> {
      try {
        const raw = await readFile(filePath, "utf8");
        return parseState(raw);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return parseState(null);
        throw err;
      }
    },
    async save(state: WatcherState): Promise<void> {
      const dir = path.dirname(filePath);
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, `${serializeState(state)}\n`, "utf8");
    },
  };
}

/** @deprecated Prefer createFileStateStore — kept for any external imports. */
export async function loadState(filePath: string): Promise<WatcherState> {
  return createFileStateStore(filePath).load();
}

/** @deprecated Prefer createFileStateStore */
export async function saveState(
  filePath: string,
  state: WatcherState,
): Promise<void> {
  return createFileStateStore(filePath).save(state);
}
