import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateVisualizationReport } from "./index.js";
import type { VisualizationMode, VisualizationRequest } from "./types.js";

function parseValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return argv[index + 1];
}

export function parseCliArgs(argv: string[]): VisualizationRequest {
  const modeValue = parseValue(argv, "--mode");
  const repoPath = parseValue(argv, "--repo");
  const query = parseValue(argv, "--query");
  const filesValue = parseValue(argv, "--files");
  const adapter = parseValue(argv, "--adapter");

  if (!modeValue || !repoPath) {
    throw new Error("Usage: visualize --mode <diff|component|project|app> --repo <absolute-path> [--query value] [--files a,b]");
  }

  if (!["diff", "component", "project", "app"].includes(modeValue)) {
    throw new Error(`Unsupported mode: ${modeValue}`);
  }

  return {
    mode: modeValue as VisualizationMode,
    repoPath,
    query,
    files: filesValue ? filesValue.split(",").map((item) => item.trim()).filter(Boolean) : undefined,
    adapter
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const request = parseCliArgs(args);
  const report = await generateVisualizationReport(request);
  console.log(`Visualization ready: ${report.url}`);
  console.log(`Mode: ${report.mode}`);
  console.log(`Adapter: ${report.adapter.name}`);
  console.log(`Easy summary: ${report.summary.easy}`);
  console.log(`Technical summary: ${report.summary.technical}`);
}

const isDirectRun = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isDirectRun) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
