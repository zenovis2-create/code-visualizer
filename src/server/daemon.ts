import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";

function contentType(filePath: string): string {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/plain; charset=utf-8";
}

export function startReportServer(reportsRoot: string, port: number): http.Server {
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400).end("Missing URL");
      return;
    }

    const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`);
    if (requestUrl.pathname === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, service: "code-visualizer" }));
      return;
    }

    if (!requestUrl.pathname.startsWith("/reports/")) {
      response.writeHead(404).end("Not found");
      return;
    }

    const relativePath = requestUrl.pathname.replace("/reports/", "");
    const targetPath = path.resolve(reportsRoot, relativePath);
    if (!targetPath.startsWith(path.resolve(reportsRoot))) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const stat = await fs.stat(targetPath);
      if (stat.isDirectory()) {
        const indexPath = path.join(targetPath, "index.html");
        const html = await fs.readFile(indexPath);
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(html);
        return;
      }

      const buffer = await fs.readFile(targetPath);
      response.writeHead(200, { "content-type": contentType(targetPath) });
      response.end(buffer);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  server.listen(port, "127.0.0.1");
  return server;
}

async function main(): Promise<void> {
  const reportsRoot = process.env.CODE_VISUALIZER_REPORTS_ROOT;
  const port = Number(process.env.CODE_VISUALIZER_PORT ?? "43110");

  if (!reportsRoot) {
    throw new Error("CODE_VISUALIZER_REPORTS_ROOT is required.");
  }

  const server = startReportServer(reportsRoot, port);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });
}

const daemonPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
const isDirectRun = daemonPath === new URL(import.meta.url).pathname;

if (isDirectRun) {
  main().catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
