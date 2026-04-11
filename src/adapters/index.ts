import type { Adapter } from "../types.js";
import { genericAdapter } from "./generic.js";
import { paperclipAdapter } from "./paperclip.js";

const adapters: Adapter[] = [paperclipAdapter, genericAdapter];

export async function resolveAdapter(repoPath: string, tree: string[], preferredId?: string): Promise<Adapter> {
  if (preferredId) {
    const matched = adapters.find((adapter) => adapter.id === preferredId);
    if (matched) {
      return matched;
    }
  }

  for (const adapter of adapters) {
    if (await adapter.detect(repoPath, tree)) {
      return adapter;
    }
  }

  return genericAdapter;
}

export { adapters };
