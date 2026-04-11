import path from "node:path";
import type { Adapter, AdapterHint, CollectedContext, Entrypoint, ModuleGroup } from "../types.js";
import { unique } from "../utils.js";

const DEFAULT_ZONES: ModuleGroup[] = [
  {
    id: "src",
    label: "Source",
    description: "Core implementation files.",
    paths: ["src"]
  },
  {
    id: "app",
    label: "App",
    description: "Top-level app or service folders.",
    paths: ["app", "server", "ui"]
  },
  {
    id: "docs",
    label: "Docs",
    description: "Guides and documentation.",
    paths: ["docs"]
  },
  {
    id: "tests",
    label: "Tests",
    description: "Automated verification.",
    paths: ["tests"]
  }
];

function inferEntrypoints(tree: string[], packageScripts: string[]): Entrypoint[] {
  const fileCandidates = ["src/index.ts", "src/main.ts", "src/main.tsx", "app.ts", "main.ts"];
  const entrypoints = fileCandidates
    .filter((filePath) => tree.includes(filePath))
    .map((filePath) => ({
      label: path.basename(filePath),
      path: filePath,
      role: "Primary runtime entrypoint"
    }));

  if (entrypoints.length > 0) {
    return entrypoints;
  }

  return packageScripts.slice(0, 2).map((script) => ({
    label: script,
    path: "package.json",
    role: "Runtime script"
  }));
}

export const genericAdapter: Adapter = {
  id: "generic",
  name: "Generic",
  detect() {
    return true;
  },
  collectHints({ tree, packageScripts }) {
    return {
      id: "generic",
      name: "Generic",
      zones: DEFAULT_ZONES,
      entrypoints: inferEntrypoints(tree, packageScripts),
      componentAliases: {
        src: ["src", "core", "logic"],
        app: ["app", "service", "server", "ui"],
        docs: ["doc", "docs", "guide"],
        tests: ["test", "spec", "qa"]
      }
    };
  },
  groupModules(context: CollectedContext) {
    return context.adapterHint.zones
      .map((zone) => ({
        ...zone,
        paths: unique([
          ...zone.paths.filter((prefix) => context.topLevelDirectories.includes(prefix)),
          ...context.tree.filter((treePath) => zone.paths.some((prefix) => treePath === prefix || treePath.startsWith(`${prefix}/`))).map((treePath) => treePath.split("/").slice(0, 2).join("/"))
        ]).slice(0, 8)
      }))
      .filter((zone) => zone.paths.length > 0);
  },
  findEntrypoints(context: CollectedContext) {
    return inferEntrypoints(context.tree, context.packageScripts);
  }
};
