import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pathExists } from "../utils.js";
import { startReportServer } from "./daemon.js";

const DEFAULT_PORT = 43110;
let inlineServerStarted = false;
let serverStartPromise: Promise<void> | null = null;

function moduleFilePath(): string {
  return fileURLToPath(import.meta.url);
}

function packageRoot(): string {
  return path.resolve(path.dirname(moduleFilePath()), "../..");
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const request = http.get(`${baseUrl}/health`, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        resolve(response.statusCode === 200 && Buffer.concat(chunks).toString("utf8").includes("code-visualizer"));
      });
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForHealth(baseUrl: string, retries = 30): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    if (await isHealthy(baseUrl)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new Error(`Report server did not become healthy at ${baseUrl}`);
}

async function spawnDetachedServer(reportsRoot: string, port: number): Promise<void> {
  const baseDir = packageRoot();
  const manageDir = path.dirname(moduleFilePath());
  const daemonJs = path.join(manageDir, "daemon.js");
  const daemonTs = path.join(manageDir, "daemon.ts");
  const env = {
    ...process.env,
    CODE_VISUALIZER_REPORTS_ROOT: reportsRoot,
    CODE_VISUALIZER_PORT: String(port)
  };

  if (await pathExists(daemonJs)) {
    const child = spawn(process.execPath, [daemonJs], {
      cwd: baseDir,
      detached: true,
      env,
      stdio: "ignore"
    });
    child.unref();
    return;
  }

  const tsxCli = path.join(baseDir, "node_modules", "tsx", "dist", "cli.mjs");
  const child = spawn(process.execPath, [tsxCli, daemonTs], {
    cwd: baseDir,
    detached: true,
    env,
    stdio: "ignore"
  });
  child.unref();
}

export async function ensureReportServer(reportsRoot: string, port = DEFAULT_PORT): Promise<string> {
  const baseUrl = `http://127.0.0.1:${port}`;
  if (await isHealthy(baseUrl)) {
    return baseUrl;
  }

  if (!serverStartPromise) {
    serverStartPromise = (async () => {
      if (process.env.VITEST) {
        if (!inlineServerStarted) {
          await new Promise<void>((resolve, reject) => {
            const server = startReportServer(reportsRoot, port);
            server.once("listening", () => {
              server.unref();
              inlineServerStarted = true;
              resolve();
            });
            server.once("error", (error: NodeJS.ErrnoException) => {
              if (error.code === "EADDRINUSE") {
                inlineServerStarted = true;
                resolve();
                return;
              }
              reject(error);
            });
          });
        }
      } else {
        await spawnDetachedServer(reportsRoot, port);
      }
    })();
  }

  await serverStartPromise;
  await waitForHealth(baseUrl);
  return baseUrl;
}

export function reportServerDefaults(): { reportsRoot: string; port: number } {
  return {
    reportsRoot: path.join(packageRoot(), "reports"),
    port: DEFAULT_PORT
  };
}
