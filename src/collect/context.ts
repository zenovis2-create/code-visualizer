import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveAdapter } from "../adapters/index.js";
import type { CollectedContext, GitDiffSummary, RepoFile, VisualizationRequest } from "../types.js";
import { clampList, normalizeRelative, pathExists, unique } from "../utils.js";

async function readJsonIfPresent(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await pathExists(filePath))) {
    return null;
  }

  const content = await fs.readFile(filePath, "utf8");
  return JSON.parse(content) as Record<string, unknown>;
}

async function listTopLevelDirectories(rootPath: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".git" && entry.name !== "dist" && entry.name !== "reports")
    .map((entry) => entry.name)
    .sort();
}

async function walkTree(rootPath: string, currentPath = rootPath, depth = 0, collected: string[] = []): Promise<string[]> {
  if (depth > 4 || collected.length >= 250) {
    return collected;
  }

  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === "reports") {
      continue;
    }

    const absolutePath = path.join(currentPath, entry.name);
    const relativePath = normalizeRelative(rootPath, absolutePath);
    collected.push(relativePath);

    if (entry.isDirectory()) {
      await walkTree(rootPath, absolutePath, depth + 1, collected);
    }

    if (collected.length >= 250) {
      break;
    }
  }

  return collected.sort();
}

function readGitDiff(repoPath: string): GitDiffSummary {
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"], {
      stdio: "ignore"
    });
  } catch {
    return {
      available: false,
      files: [],
      notes: ["git diff를 쓸 수 없어 파일 기반 fallback으로 요약했습니다."]
    };
  }

  try {
    const staged = execFileSync("git", ["-C", repoPath, "diff", "--name-only", "--cached"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const unstaged = execFileSync("git", ["-C", repoPath, "diff", "--name-only"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const previous = execFileSync("git", ["-C", repoPath, "diff", "--name-only", "HEAD~1", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const files = unique([...staged, ...unstaged, ...previous]);
    return {
      available: files.length > 0,
      files,
      notes: files.length > 0 ? [] : ["git은 있지만 바뀐 파일이 잡히지 않아 대표 파일 fallback으로 요약했습니다."]
    };
  } catch {
    return {
      available: false,
      files: [],
      notes: ["git history에서 쓸 만한 diff를 못 찾아 파일 기반 fallback으로 요약했습니다."]
    };
  }
}

function scoreMatch(treePath: string, query: string): number {
  const normalized = query.toLowerCase();
  const loweredPath = treePath.toLowerCase();
  if (loweredPath === normalized) {
    return 100;
  }
  if (loweredPath.includes(`/${normalized}/`) || loweredPath.startsWith(`${normalized}/`)) {
    return 80;
  }
  if (loweredPath.includes(normalized)) {
    return 40;
  }
  return 0;
}

function chooseFiles(request: VisualizationRequest, tree: string[], diff: GitDiffSummary): string[] {
  if (request.files && request.files.length > 0) {
    return request.files;
  }

  if (request.mode === "diff") {
    if (diff.files.length > 0) {
      return diff.files.slice(0, 8);
    }

    return tree.filter((item) => item.endsWith(".ts") || item.endsWith(".tsx") || item.endsWith(".md")).slice(0, 6);
  }

  if (request.mode === "component" && request.query) {
    const scored = tree
      .map((item) => ({
        item,
        score: scoreMatch(item, request.query ?? "")
      }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .map((entry) => entry.item);

    return scored.slice(0, 8);
  }

  if (request.mode === "app") {
    return tree.filter((item) => /(?:index|main)\.(?:ts|tsx|js)$/.test(item)).slice(0, 6);
  }

  if (request.mode === "project") {
    const preferred = [
      "package.json",
      "README.md",
      "server/src/index.ts",
      "ui/src/main.tsx",
      "cli/src/index.ts",
      "packages/shared/src/index.ts"
    ];
    const matched = preferred.filter((item) => tree.includes(item));
    if (matched.length > 0) {
      return matched;
    }
  }

  return tree.filter((item) => item.endsWith(".ts") || item.endsWith(".tsx") || item.endsWith(".md")).slice(0, 10);
}

async function readSelectedFiles(repoPath: string, relativePaths: string[]): Promise<RepoFile[]> {
  const files: RepoFile[] = [];
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(repoPath, relativePath);
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      continue;
    }

    const content = await fs.readFile(absolutePath, "utf8");
    files.push({
      path: relativePath,
      content: content.slice(0, 4000)
    });
  }
  return files;
}

export async function collectContext(request: VisualizationRequest): Promise<CollectedContext> {
  const repoPath = path.resolve(request.repoPath);
  if (!(await pathExists(repoPath))) {
    throw new Error(`Repo path does not exist: ${repoPath}`);
  }

  const tree = await walkTree(repoPath);
  const packageJson = await readJsonIfPresent(path.join(repoPath, "package.json"));
  const scripts = Object.keys((packageJson?.scripts as Record<string, unknown> | undefined) ?? {});
  const diff = readGitDiff(repoPath);
  const adapter = await resolveAdapter(repoPath, tree, request.adapter);
  const adapterHint = adapter.collectHints({
    repoPath,
    tree,
    packageScripts: scripts
  });
  const selectedFilePaths = chooseFiles(request, tree, diff);
  const selectedFiles = await readSelectedFiles(repoPath, selectedFilePaths);
  const topLevelDirectories = await listTopLevelDirectories(repoPath);
  const limits: string[] = [];

  if (tree.length >= 240) {
    limits.push("트리 수집이 안전 한도에 걸려 더 깊은 파일은 일부 빠졌을 수 있습니다.");
  }
  if (selectedFiles.length === 0) {
    limits.push("직접 고른 파일이 없어, 이 리포트는 코드 세부보다 구조 설명 쪽 비중이 큽니다.");
  }

  return {
    request,
    repoName: path.basename(repoPath),
    repoPath,
    packageScripts: scripts,
    tree: clampList(tree, 250),
    selectedFiles,
    diff,
    adapterHint,
    topLevelDirectories,
    limits
  };
}
