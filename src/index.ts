import fs from "node:fs/promises";
import path from "node:path";
import { resolveAdapter } from "./adapters/index.js";
import { analyzeContext, createReportId } from "./analysis/report.js";
import { collectContext } from "./collect/context.js";
import { writeReportBundle } from "./render/html.js";
import { ensureReportServer, reportServerDefaults } from "./server/manage.js";
import type { RepoFile, VisualizationReport, VisualizationRequest } from "./types.js";
import { unique } from "./utils.js";

function extractReferencedFiles(report: Omit<VisualizationReport, "artifacts" | "url" | "reportId">): string[] {
  const cells = report.glance.tables.flatMap((table) => table.rows.flatMap((row) => row));
  return unique(
    cells
      .flatMap((cell) => cell.split(",").map((part) => part.trim()))
      .filter((part) => /(?:\/|\.md$|\.json$|\.tsx?$|\.jsx?$)/.test(part))
  );
}

async function collectPreviewFiles(repoPath: string, selectedFiles: RepoFile[], referencedPaths: string[]): Promise<RepoFile[]> {
  const known = new Map(selectedFiles.map((file) => [file.path, file]));
  for (const relativePath of referencedPaths) {
    if (known.has(relativePath)) {
      continue;
    }
    const absolutePath = path.join(repoPath, relativePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      known.set(relativePath, {
        path: relativePath,
        content: content.slice(0, 4000)
      });
    } catch {
      // Ignore non-file or unresolved references.
    }
  }

  return [...known.values()];
}

export async function generateVisualizationReport(request: VisualizationRequest): Promise<VisualizationReport> {
  const context = await collectContext(request);
  const adapter = await resolveAdapter(context.repoPath, context.tree, request.adapter);
  const analyzed = analyzeContext(context, adapter, request);
  const previewFiles = await collectPreviewFiles(context.repoPath, context.selectedFiles, extractReferencedFiles(analyzed));
  const reportId = createReportId(analyzed.title);
  const defaults = reportServerDefaults();

  await fs.mkdir(defaults.reportsRoot, { recursive: true });

  const baseReport: VisualizationReport = {
    ...analyzed,
    reportId,
    artifacts: [],
    url: ""
  };

  const artifacts = await writeReportBundle(defaults.reportsRoot, baseReport, previewFiles);
  const baseUrl = await ensureReportServer(defaults.reportsRoot, defaults.port);
  const url = `${baseUrl}/reports/${reportId}/index.html`;

  const finalReport: VisualizationReport = {
    ...baseReport,
    artifacts: artifacts.map((artifactPath) => path.relative(process.cwd(), artifactPath) || artifactPath),
    url
  };

  const finalArtifacts = await writeReportBundle(defaults.reportsRoot, finalReport, previewFiles);
  return {
    ...finalReport,
    artifacts: finalArtifacts.map((artifactPath) => path.relative(process.cwd(), artifactPath) || artifactPath)
  };
}

export * from "./types.js";
