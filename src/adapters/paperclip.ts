import path from "node:path";
import type { Adapter, AdapterHint, CollectedContext, Entrypoint, ModuleGroup } from "../types.js";
import { unique } from "../utils.js";

const ZONES: ModuleGroup[] = [
  {
    id: "server",
    label: "Server",
    description: "API routes, runtime, and backend coordination.",
    paths: ["server"]
  },
  {
    id: "ui",
    label: "UI",
    description: "React screens, components, and browser-side flows.",
    paths: ["ui"]
  },
  {
    id: "packages",
    label: "Packages",
    description: "Reusable shared packages and domain libraries.",
    paths: ["packages"]
  },
  {
    id: "skills",
    label: "Skills",
    description: "Promptable skills, templates, and operator guidance.",
    paths: ["skills"]
  },
  {
    id: "docs",
    label: "Docs",
    description: "Specs, guides, plans, and operational docs.",
    paths: ["docs", "doc"]
  },
  {
    id: "cli",
    label: "CLI",
    description: "Terminal entrypoints and user-facing commands.",
    paths: ["cli"]
  },
  {
    id: "tests",
    label: "Tests",
    description: "Validation, e2e coverage, and release smoke checks.",
    paths: ["tests", "evals"]
  }
];

function entrypointsFromTree(tree: string[]): Entrypoint[] {
  const candidates = [
    ["server/src/index.ts", "Backend HTTP entrypoint"],
    ["ui/src/main.tsx", "Browser UI bootstrap"],
    ["cli/src/index.ts", "CLI command entrypoint"]
  ] as const;

  return candidates
    .filter(([filePath]) => tree.includes(filePath))
    .map(([filePath, role]) => ({
      label: path.basename(filePath),
      path: filePath,
      role
    }));
}

export const paperclipAdapter: Adapter = {
  id: "paperclip",
  name: "Paperclip",
  async detect(repoPath, tree) {
    const basename = path.basename(repoPath).toLowerCase();
    const required = ["server", "ui", "packages", "skills"];
    const matchedSegments = required.filter((segment) => tree.some((item) => item.startsWith(`${segment}/`) || item === segment));
    return basename.includes("paperclip") || matchedSegments.length >= 3;
  },
  collectHints({ tree }) {
    return {
      id: "paperclip",
      name: "Paperclip",
      zones: ZONES,
      entrypoints: entrypointsFromTree(tree),
      componentAliases: {
        ui: ["ui", "frontend", "screen", "client"],
        server: ["server", "api", "backend", "runtime"],
        packages: ["package", "shared", "library"],
        skills: ["skill", "prompt", "instruction"],
        docs: ["doc", "docs", "plan", "guide"],
        cli: ["cli", "command", "terminal"],
        tests: ["test", "qa", "validation"]
      }
    };
  },
  groupModules(context: CollectedContext) {
    return context.adapterHint.zones.map((zone) => ({
      ...zone,
      paths: unique([
        ...zone.paths.filter((prefix) => context.topLevelDirectories.includes(prefix)),
        ...context.tree.filter((treePath) => zone.paths.some((prefix) => treePath === prefix || treePath.startsWith(`${prefix}/`))).map((treePath) => treePath.split("/").slice(0, 2).join("/"))
      ]).slice(0, 10)
    }));
  },
  findEntrypoints(context: CollectedContext) {
    return entrypointsFromTree(context.tree);
  }
};
