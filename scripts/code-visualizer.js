#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PORT = 43110;
const REPORTS_ROOT = path.join(os.homedir(), ".codex", "state", "code-visualizer", "reports");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const value = argv[index + 1];
    const normalized = key.slice(2);
    if (args[normalized] === undefined) {
      args[normalized] = value;
    } else if (Array.isArray(args[normalized])) {
      args[normalized].push(value);
    } else {
      args[normalized] = [args[normalized], value];
    }
    index += 1;
  }
  return args;
}

function listArg(value) {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  const ascii = value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const base = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return base || "item";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readTextIfExists(filePath) {
  if (!(await pathExists(filePath))) return null;
  return await fs.readFile(filePath, "utf8");
}

function isImagePath(filePath) {
  return /\.(png|jpg|jpeg|webp|gif|svg)$/i.test(filePath);
}

async function collectTree(rootPath, current = rootPath, depth = 0, items = []) {
  if (depth > 4 || items.length >= 240) return items;
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if ([".git", "node_modules", "dist", "reports"].includes(entry.name)) continue;
    const abs = path.join(current, entry.name);
    const rel = path.relative(rootPath, abs).split(path.sep).join("/");
    items.push(rel);
    if (entry.isDirectory()) {
      await collectTree(rootPath, abs, depth + 1, items);
    }
    if (items.length >= 240) break;
  }
  return items.sort();
}

async function collectTopDirs(rootPath) {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && ![".git", "node_modules", "dist", "reports"].includes(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function readGitChangedFiles(repoPath) {
  try {
    execFileSync("git", ["-C", repoPath, "rev-parse", "--is-inside-work-tree"], { stdio: "ignore" });
  } catch {
    return [];
  }

  const readNames = (args) => {
    try {
      return execFileSync("git", ["-C", repoPath, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      })
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  };

  return [...new Set([...readNames(["diff", "--name-only"]), ...readNames(["diff", "--name-only", "--cached"])])];
}

async function readRepoSummary(repoPath) {
  const readme = await readTextIfExists(path.join(repoPath, "README.md"));
  if (!readme) return null;
  const line = readme
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith("#") && !item.startsWith("-") && !item.startsWith("```"));
  return line ?? null;
}

function extractUrls(text) {
  return String(text || "").match(/https?:\/\/[^\s)]+/g) || [];
}

const TERM_ROWS = [
  ["UI", "화면, 사용자가 보는 부분"],
  ["Server", "처리 규칙, 운영실"],
  ["Package / Shared", "공통 부품"],
  ["CLI", "실행/관리 도구"],
  ["Test", "검증 장치"],
  ["Route / API", "요청을 받는 창구"],
  ["Component", "화면 조각"]
];

const CAPABILITY_RULES = [
  { id: "ui", label: "화면과 경험", role: "사용자가 직접 보는 화면과 상호작용", patterns: [/^ui\//, /pages\//, /components\//, /screen/i, /frontend/i] },
  { id: "server", label: "처리 규칙과 데이터 흐름", role: "요청을 받고 계산하거나 규칙을 적용하는 부분", patterns: [/^server\//, /api/i, /route/i, /backend/i, /service/i] },
  { id: "shared", label: "공통 기능", role: "여러 기능이 같이 쓰는 공통 부품", patterns: [/^packages\//, /shared/i, /lib\//, /core/i, /utils/i] },
  { id: "docs", label: "문서와 이해 자료", role: "왜 이렇게 만들었는지 설명하는 문서", patterns: [/^docs?\//, /readme/i] },
  { id: "tools", label: "실행/관리 도구", role: "실행하거나 관리할 때 쓰는 도구", patterns: [/^cli\//, /^scripts\//, /command/i] },
  { id: "tests", label: "검증 장치", role: "망가지지 않았는지 확인하는 장치", patterns: [/^tests\//, /spec/i, /e2e/i, /qa/i] },
  { id: "skills", label: "스킬/설명 규칙", role: "에이전트가 어떻게 설명하고 행동할지 정하는 규칙", patterns: [/^skills\//, /^agents\//, /^references\//] }
];

function splitFileCandidates(cell) {
  return String(cell || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => /(?:\/|\.md$|\.json$|\.tsx?$|\.jsx?$)/.test(part));
}

function taskKey(tableTitle, rowTitle, index) {
  return `${tableTitle}::${rowTitle}::${index}`;
}

function pinKey(prefix, value) {
  return `${prefix}:${value}`;
}

function absoluteReportHref(reportId, relativePath) {
  return `/reports/${reportId}/${relativePath}`;
}

function previewFileName(filePath) {
  const suffix = Buffer.from(filePath).toString("hex").slice(0, 10);
  return `${slugify(filePath)}-${suffix}.html`;
}

function taskPageName(tableTitle, rowTitle, index) {
  const base = slugify(`${tableTitle}-${rowTitle}`);
  const suffix = Buffer.from(`${tableTitle}-${rowTitle}`).toString("hex").slice(0, 8);
  return `${base || "task"}-${suffix}-${index}.html`;
}

function toneBadge(tone) {
  const labelMap = {
    ui: "UI",
    server: "SERVER",
    packages: "PACKAGE",
    docs: "DOCS",
    tests: "TEST",
    cli: "CLI",
    neutral: "INFO"
  };
  return `<span class="glance-badge badge-${tone}">${escapeHtml(labelMap[tone] || "INFO")}</span>`;
}

function severityClass(value) {
  if (String(value).includes("높음")) return "high";
  if (String(value).includes("중간")) return "medium";
  if (String(value).includes("낮음")) return "low";
  return "neutral";
}

function renderLinkedFileTokens(cell, linkMap, className) {
  const candidates = splitFileCandidates(cell);
  if (candidates.length === 0) {
    return `<span class="${className}">${escapeHtml(cell)}</span>`;
  }
  return candidates
    .map((candidate) => {
      const href = linkMap.get(candidate);
      return href
        ? `<a class="file-link ${className}" href="${escapeHtml(href)}">${escapeHtml(candidate)}</a>`
        : `<span class="${className}">${escapeHtml(candidate)}</span>`;
    })
    .join('<span class="file-separator">, </span>');
}

function summarizeFile(file) {
  const filePath = file.path.toLowerCase();
  if (filePath.includes("ui/")) return "이 파일은 화면이나 사용자 경험과 직접 맞닿아 있는 부분입니다.";
  if (filePath.includes("server/")) return "이 파일은 처리 규칙과 데이터 흐름을 담당하는 부분입니다.";
  if (filePath.includes("packages/")) return "이 파일은 여러 기능이 같이 쓰는 공통 부품입니다.";
  if (filePath.includes("readme") || filePath.includes("docs/") || filePath.endsWith(".md")) return "이 파일은 왜 이렇게 만들었는지 이해하는 데 도움이 되는 문서입니다.";
  if (filePath.includes("cli/") || filePath.includes("scripts/")) return "이 파일은 실행하거나 관리할 때 쓰는 도구 쪽 설명에 가깝습니다.";
  return "이 파일은 현재 프로젝트를 설명하는 대표 파일 중 하나입니다.";
}

function shortFileLabel(filePath) {
  const parts = filePath.split("/");
  if (parts.length <= 2) return filePath;
  return `${parts[0]}/${parts[parts.length - 1]}`;
}

function mapCapabilities(tree, topDirs) {
  return CAPABILITY_RULES.map((rule) => {
    const files = tree.filter((item) => rule.patterns.some((pattern) => pattern.test(item))).slice(0, 6);
    const folder = topDirs.find((dir) => rule.patterns.some((pattern) => pattern.test(`${dir}/`)));
    return {
      ...rule,
      representativeFiles: files,
      folder: folder ?? files[0]?.split("/")[0] ?? ""
    };
  }).filter((capability) => capability.representativeFiles.length > 0 || capability.folder);
}

function selectRepresentativeFiles(intent, tree, changedFiles, focus) {
  if (intent === "change-explainer" && changedFiles.length > 0) return changedFiles.slice(0, 6);
  if (intent === "feature-explainer" && focus) {
    const lowered = focus.toLowerCase();
    const matched = tree.filter((item) => item.toLowerCase().includes(lowered));
    if (matched.length > 0) return matched.slice(0, 6);
  }
  const preferred = ["README.md", "package.json", "ui/src/main.tsx", "server/src/index.ts", "cli/src/index.ts"];
  return preferred.filter((item) => tree.includes(item)).slice(0, 6);
}

function readLatestCommit(repoPath) {
  try {
    const subject = execFileSync("git", ["-C", repoPath, "log", "-1", "--pretty=%s"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return subject;
  } catch {
    return "";
  }
}

function summarizeChangedPaths(paths, limit = 4) {
  return paths.slice(0, limit).join(", ") || "대표 파일 없음";
}

function classifyChangeSet(changedFiles) {
  const addedSkillRoots = changedFiles.filter((file) => /^(SKILL\.md|agents\/|assets\/|references\/|scripts\/)/.test(file));
  const removedAppRoots = changedFiles.filter((file) => /^(src\/|tests\/|viewer\/|package\.json|pnpm-lock\.yaml|tsconfig\.json|vitest\.config\.ts)/.test(file));
  return {
    looksLikePureSkillRewrite: addedSkillRoots.length >= 3 && removedAppRoots.length >= 3,
    addedSkillRoots,
    removedAppRoots
  };
}

function buildNarrativeFromChanges({ intent, focus, repoName, changedFiles, capabilities, latestCommit }) {
  const changeSet = classifyChangeSet(changedFiles);
  const changedCapabilities = capabilities.filter((cap) => cap.files.some((file) => changedFiles.includes(file)));
  const changedPresentationLayer = changedFiles.some((file) => /^(assets\/template\.html|assets\/style\.css)$/.test(file));
  const changedExplainerEngine = changedFiles.some((file) => /^scripts\/code-visualizer\.js$/.test(file));

  if (changeSet.looksLikePureSkillRewrite) {
    return {
      whatNow: "이번 작업은 이 저장소를 개발용 앱 리포에서, GitHub에서 바로 받아 쓸 수 있는 순수 스킬 구조로 다시 정리한 것입니다.",
      beforeText: "전에는 앱 개발용 파일, 테스트, 빌드 설정, 실행 코드가 한 저장소에 섞여 있어서 '받아서 바로 쓰는 스킬'처럼 보이지 않았습니다.",
      nowText: "지금은 SKILL.md, agents, references, assets, scripts 중심으로 정리돼서 '설치 가능한 스킬'이라는 목적이 더 분명해졌습니다.",
      userImpact: [
        "다른 환경에서 GitHub로 내려받아 스킬처럼 설치하기 쉬워졌습니다.",
        "비개발자 설명 규칙과 용어 번역이 별도 자료로 정리돼 이해가 더 쉬워졌습니다.",
        "무거운 개발 리포보다, 실제 사용 목적이 바로 보이는 스킬 구조가 됐습니다."
      ],
      timeline: [
        {
          step: "1단계",
          title: "개발용 구조를 걷어냄",
          body: `${summarizeChangedPaths(changeSet.removedAppRoots)} 같은 앱형 파일 묶음을 정리했습니다.`
        },
        {
          step: "2단계",
          title: "순수 스킬 재구성",
          body: `${summarizeChangedPaths(changeSet.addedSkillRoots)} 중심으로 설치 가능한 스킬 구조를 세웠습니다.`
        },
        {
          step: "3단계",
          title: "설명 엔진 연결",
          body: latestCommit ? `최근 커밋 "${latestCommit}" 기준으로 실제 사용 흐름을 스크립트에 연결했습니다.` : "설명 생성 스크립트와 자산을 연결해 바로 실행 가능한 상태로 만들었습니다."
        }
      ],
      diffRows: [
        {
          kind: "정리됨",
          item: "앱형 개발 구조",
          files: summarizeChangedPaths(changeSet.removedAppRoots),
          why: "설치 목적과 개발 목적이 섞여 있던 구조를 줄였습니다."
        },
        {
          kind: "추가됨",
          item: "순수 스킬 구성요소",
          files: summarizeChangedPaths(changeSet.addedSkillRoots),
          why: "비개발자 설명과 설치 흐름에 필요한 핵심 요소만 남겼습니다."
        },
        {
          kind: "사용자 체감 변화",
          item: "GitHub에서 바로 받아 쓰는 스킬",
          files: "SKILL.md, scripts/run-code-visualizer.sh",
          why: "이제 이 저장소가 무엇인지 훨씬 빨리 이해할 수 있습니다."
        }
      ]
    };
  }

  if (changedPresentationLayer && changedExplainerEngine) {
    return {
      whatNow: "이번 작업은 설명 화면과 해설 엔진을 함께 바꿔서, 비개발자가 변화와 구조를 더 직관적으로 이해하게 만드는 데 초점을 맞췄습니다.",
      beforeText: "전에는 설명 화면이 있어도 무엇이 실제로 달라졌는지와 왜 중요한지가 파일 이름 수준에서만 느껴질 가능성이 컸습니다.",
      nowText: "지금은 변화 타임라인, 비개발자용 diff 뷰, 결과물 연결 섹션을 통해 이번 변경의 스토리를 더 직접 읽을 수 있습니다.",
      userImpact: [
        "이번 변경이 화면/설명 구조 기준으로 어떻게 달라졌는지 더 빠르게 이해할 수 있습니다.",
        "개발자식 diff 대신, 무엇이 추가되고 정리됐는지를 비개발자 언어로 따라갈 수 있습니다.",
        "결과물 연결 섹션 덕분에 코드 변경과 설명 결과물의 관계를 더 쉽게 체감할 수 있습니다."
      ],
      timeline: [
        {
          step: "1단계",
          title: "요청/목표 정리",
          body: focus || "비개발자가 이번 변경을 바로 이해할 수 있도록 설명 방향을 다시 잡았습니다."
        },
        {
          step: "2단계",
          title: "설명 화면 재구성",
          body: "assets/template.html, assets/style.css를 바꿔 변화 타임라인과 비개발자용 diff 뷰를 추가했습니다."
        },
        {
          step: "3단계",
          title: "해설 엔진 강화",
          body: latestCommit ? `scripts/code-visualizer.js를 고쳐 최근 작업 "${latestCommit}" 이후의 변화 의미를 더 직접 읽게 했습니다.` : "scripts/code-visualizer.js를 고쳐 실제 변경 근거를 더 직접 반영하게 했습니다."
        }
      ],
      diffRows: [
        {
          kind: "추가됨",
          item: "설명용 시각 섹션",
          files: "assets/template.html, assets/style.css",
          why: "변화 타임라인과 비개발자용 diff 뷰가 첫 화면에서 보이게 했습니다."
        },
        {
          kind: "연결됨",
          item: "해설 생성 엔진",
          files: "scripts/code-visualizer.js",
          why: "실제 변경 파일과 설명 문구를 더 강하게 연결했습니다."
        },
        {
          kind: "사용자 체감 변화",
          item: "설명 읽기 경험",
          files: "타임라인, diff 뷰, 결과물 연결",
          why: "이번 작업이 무엇을 어떻게 바꿨는지 스토리처럼 따라가기 쉬워졌습니다."
        }
      ]
    };
  }

  const topChanged = changedCapabilities.map((cap) => cap.feature).slice(0, 3);
  const featureLabel = topChanged.join(", ") || capabilities[0]?.feature || "핵심 기능";
  return {
    whatNow:
      intent === "change-explainer"
        ? `이번 작업은 ${featureLabel} 쪽 코드가 실제로 바뀌어, 그 변화가 어떤 의미인지 설명하는 데 초점을 둡니다.`
        : intent === "feature-explainer"
          ? `이번 설명은 ${focus || featureLabel}가 사용자 입장에서 어떤 기능인지 풀어주는 데 초점을 둡니다.`
          : `이번 설명은 ${repoName}이 현재 어떤 기능 묶음으로 이루어졌는지, 그리고 최근 변화가 어디에 몰려 있었는지 보여줍니다.`,
    beforeText:
      changedFiles.length > 0
        ? `전에는 ${summarizeChangedPaths(changedFiles)} 같은 변화가 어떤 기능 의미를 가지는지 파일 이름만 보고 추측해야 했습니다.`
        : "전에는 프로젝트를 폴더 이름만 보고 이해해야 했습니다.",
    nowText:
      changedFiles.length > 0
        ? `지금은 ${featureLabel} 관점에서 어떤 파일이 바뀌었고, 그것이 사용자 입장에서 어떤 의미인지 먼저 읽을 수 있습니다.`
        : "지금은 기술 구조보다 먼저, 이 프로젝트가 무엇을 만들고 있는지와 기능별 역할을 읽을 수 있습니다.",
    userImpact: [
      topChanged.length > 0 ? `${featureLabel}와 관련된 변화를 기능 기준으로 이해할 수 있습니다.` : "프로젝트의 기능 묶음을 비개발자 기준으로 먼저 이해할 수 있습니다.",
      "파일 이름보다 기능 의미가 먼저 보여서 바이브코딩 결과를 따라가기 쉬워집니다.",
      "필요하면 그 아래에서 대표 파일과 세부 설명으로 내려갈 수 있습니다."
    ],
    timeline: [
      {
        step: "1단계",
        title: "요청/목표 정리",
        body: focus || "사용자가 알고 싶어 한 변화나 기능 의미를 먼저 잡았습니다."
      },
      {
        step: "2단계",
        title: "실제 변경 확인",
        body: changedFiles.length > 0 ? `${summarizeChangedPaths(changedFiles)} 파일 변화를 기준으로 설명을 묶었습니다.` : "최근 변경 대신 현재 구조를 기준으로 설명을 묶었습니다."
      },
      {
        step: "3단계",
        title: "기능 의미로 번역",
        body: `${featureLabel}를 사용자 체감 관점으로 다시 설명했습니다.`
      }
    ],
    diffRows: [
      {
        kind: "추가됨/바뀜",
        item: featureLabel,
        files: summarizeChangedPaths(changedFiles),
        why: "실제 바뀐 파일을 기능 의미로 번역해 보여줍니다."
      },
      {
        kind: "정리됨",
        item: "설명 방식",
        files: "기능 묶음 기준",
        why: "파일 이름이 아니라 사용자가 느끼는 역할 기준으로 읽게 만듭니다."
      },
      {
        kind: "사용자 체감 변화",
        item: topChanged[0] || "프로젝트 이해 방식",
        files: topChanged.join(", ") || "현재 기능 묶음",
        why: "이번 작업이 어디에 영향을 주는지 더 빠르게 파악할 수 있습니다."
      }
    ]
  };
}

function findResultConnections(repoPath, tree, focus, inputs = {}) {
  const urls = [...extractUrls(focus), ...(inputs.resultUrls || [])];
  const imageCandidates = tree.filter((item) => isImagePath(item)).slice(0, 4);
  const mappedImages = imageCandidates.map((item) => ({
    type: "image",
    title: path.basename(item),
    description: "저장소 안에서 찾은 실제 화면/결과물 단서입니다.",
    sourcePath: path.join(repoPath, item)
  }));
  const mappedUrls = urls.map((url, index) => ({
    type: "link",
    title: `실행 중 화면 ${index + 1}`,
    description: "사용자가 준 실제 결과물 링크입니다.",
    url
  }));
  const mappedScreenshots = (inputs.screenshotPaths || []).map((item, index) => ({
    type: "image",
    title: `스크린샷 ${index + 1}`,
    description: "사용자가 직접 제공한 실제 화면 스크린샷입니다.",
    sourcePath: item
  }));
  const mappedArtifacts = (inputs.artifactPaths || []).map((item, index) => ({
    type: isImagePath(item) ? "image" : "file",
    title: `결과물 ${index + 1}`,
    description: "사용자가 직접 제공한 결과물 파일입니다.",
    sourcePath: item
  }));

  if (
    mappedImages.length === 0 &&
    mappedUrls.length === 0 &&
    mappedScreenshots.length === 0 &&
    mappedArtifacts.length === 0
  ) {
    return [
      {
        type: "note",
        title: "현재 결과물은 이 설명 페이지 자체",
        description: "이 저장소 안에서 별도 스크린샷이나 실행 URL은 찾지 못했습니다. 대신 이번 작업의 실제 결과물은 지금 보고 있는 설명 페이지와 그 안의 타임라인/diff/기능 지도 구성입니다. 실행 중인 화면 URL이나 스크린샷 파일이 있으면 여기서 코드와 화면을 직접 연결할 수 있습니다."
      }
    ];
  }

  return [...mappedUrls, ...mappedScreenshots, ...mappedArtifacts, ...mappedImages];
}

async function readFiles(repoPath, filePaths) {
  const results = [];
  for (const filePath of filePaths) {
    const abs = path.join(repoPath, filePath);
    if (!(await pathExists(abs))) continue;
    const stat = await fs.stat(abs);
    if (!stat.isFile()) continue;
    const content = await fs.readFile(abs, "utf8");
    results.push({ path: filePath, content: content.slice(0, 5000) });
  }
  return results;
}

function describeProjectPurpose(repoName, readmeSummary, capabilities) {
  if (repoName === "code-visualizer") {
    return "code-visualizer은 방금 만든 변화와 현재 프로젝트 구조를 비개발자와 바이브코더도 이해할 수 있게 풀어 설명해 주는 Codex 스킬입니다.";
  }
  if (readmeSummary) return readmeSummary;
  const labels = capabilities.map((item) => item.feature || item.label).slice(0, 3).join(", ");
  return `${repoName}은 ${labels}을 중심으로 돌아가는 프로젝트입니다.`;
}

function buildSections(intent, repoName, focus, changedFiles, capabilities, projectPurpose) {
  const changedCapabilityLabels = capabilities
    .filter((cap) => (cap.files || cap.representativeFiles || []).some((file) => changedFiles.includes(file)))
    .map((cap) => cap.feature || cap.label);
  const topCapability = capabilities[0]?.feature || capabilities[0]?.label || "핵심 기능";
  const whatNow =
    intent === "change-explainer"
      ? `이번 작업은 ${changedCapabilityLabels.join(", ") || topCapability} 쪽 변화를 설명하는 데 초점을 둡니다.`
      : intent === "feature-explainer"
        ? `이번 설명은 ${focus || topCapability}가 사용자 입장에서 무슨 의미인지 이해시키는 데 초점을 둡니다.`
        : `이번 설명은 ${repoName}이 현재 어떤 기능 묶음으로 이루어졌는지 보여주는 데 초점을 둡니다.`;

  const beforeText =
    intent === "change-explainer"
      ? "전에는 무엇이 바뀌었는지 폴더나 파일 이름을 보고 추측해야 했습니다."
      : "전에는 이 프로젝트를 폴더 이름만 보고 이해해야 했습니다.";

  const nowText =
    intent === "change-explainer"
      ? "지금은 어떤 기능 묶음이 바뀌었고, 그것이 사용자 입장에서 어떤 의미인지부터 읽을 수 있습니다."
      : "지금은 기술 구조보다 먼저, 이 프로젝트가 무엇을 만들고 있는지와 기능별 역할을 읽을 수 있습니다.";

  const userImpact = [
    intent === "change-explainer"
      ? "코드를 모르는 사람도 이번 변경이 어디에 영향을 주는지 바로 파악할 수 있습니다."
      : "이 프로젝트가 어떤 종류의 제품인지 더 빨리 감을 잡을 수 있습니다.",
    "기술 용어를 바로 쉬운 말로 번역해서 읽을 수 있습니다.",
    "파일을 열기 전에 어떤 기능 묶음부터 봐야 할지 결정할 수 있습니다."
  ];

  return { whatNow, beforeText, nowText, userImpact, projectPurpose };
}

function pinBoardMarkup() {
  return `<section class="pin-board-shell">
  <div class="pin-board-head">
    <h2>핀 보드</h2>
    <p>중요한 작업과 파일을 다시 열 수 있습니다.</p>
  </div>
  <ul id="pin-board-list" class="pin-board-list"></ul>
  <p id="pin-board-empty" class="pin-board-empty">아직 핀된 항목이 없습니다.</p>
</section>`;
}

function progressBoardMarkup() {
  return `<section class="progress-shell">
  <div class="progress-head">
    <h2>작업 진행 요약</h2>
    <p>작업 상세 페이지에서 체크한 상태를 모아 보여줍니다.</p>
  </div>
  <ul id="task-progress-list" class="task-progress-list"></ul>
  <p id="task-progress-empty" class="task-progress-empty">아직 체크한 작업이 없습니다.</p>
</section>`;
}

function renderInteractiveScript({ reportId }) {
  return `
(() => {
  const pinStorageKey = "code-visualizer:pins:${reportId}";
  const progressPrefix = "code-visualizer:task:${reportId}:";
  const pinList = document.getElementById("pin-board-list");
  const pinEmpty = document.getElementById("pin-board-empty");
  const progressList = document.getElementById("task-progress-list");
  const progressEmpty = document.getElementById("task-progress-empty");

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function bindPins() {
    document.querySelectorAll(".pin-toggle").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const items = readJson(pinStorageKey, []);
        const key = button.dataset.pinKey || "";
        const label = button.dataset.pinLabel || "핀 항목";
        const href = button.dataset.pinHref || "#";
        const exists = items.some((item) => item.key === key);
        const next = exists ? items.filter((item) => item.key !== key) : [...items, { key, label, href }];
        writeJson(pinStorageKey, next);
        renderPins();
      });
    });
  }

  function renderPins() {
    if (!pinList || !pinEmpty) return;
    const items = readJson(pinStorageKey, []);
    pinList.innerHTML = "";
    if (items.length === 0) {
      pinEmpty.hidden = false;
    } else {
      pinEmpty.hidden = true;
      for (const item of items) {
        const li = document.createElement("li");
        li.innerHTML = '<div class="pin-board-item"><button type="button" class="pin-toggle is-pinned" data-pin-key="' + item.key + '" data-pin-label="' + item.label + '" data-pin-href="' + item.href + '">핀 해제</button><a class="pin-board-link" href="' + item.href + '">' + item.label + '</a></div>';
        pinList.appendChild(li);
      }
    }
    bindPins();
  }

  function renderProgress() {
    if (!progressList || !progressEmpty) return;
    const rows = Array.from(document.querySelectorAll("[data-task-state-key]"));
    const items = rows
      .map((row) => {
        const stateKey = row.getAttribute("data-task-state-key");
        const label = row.getAttribute("data-task-label") || "작업";
        const href = row.getAttribute("data-task-href") || "#";
        if (!stateKey) return null;
        const state = readJson(stateKey, {});
        const total = Object.keys(state).length;
        const done = Object.values(state).filter(Boolean).length;
        if (done === 0 || total === 0) return null;
        return { label, href, done, total };
      })
      .filter(Boolean);

    progressList.innerHTML = "";
    if (items.length === 0) {
      progressEmpty.hidden = false;
    } else {
      progressEmpty.hidden = true;
      for (const item of items) {
        const li = document.createElement("li");
        li.innerHTML = '<div class="task-progress-item"><a class="task-progress-link" href="' + item.href + '">' + item.label + '</a><span class="task-progress-meta">' + item.done + '/' + item.total + ' 완료</span></div>';
        progressList.appendChild(li);
      }
    }
  }

  bindPins();
  renderPins();
  renderProgress();
})();
`.trim();
}

function renderMainScript(reportId) {
  return `
(() => {
  const pinKey = "code-visualizer:pins:${reportId}";
  const progressPrefix = "code-visualizer:task:${reportId}:";
  const pinList = document.getElementById("pin-board-list");
  const pinEmpty = document.getElementById("pin-board-empty");
  const progressList = document.getElementById("task-progress-list");
  const progressEmpty = document.getElementById("task-progress-empty");

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function bindPins() {
    document.querySelectorAll(".pin-toggle").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const items = readJson(pinKey, []);
        const key = button.dataset.pinKey || "";
        const label = button.dataset.pinLabel || "핀 항목";
        const href = button.dataset.pinHref || "#";
        const exists = items.some((item) => item.key === key);
        const next = exists ? items.filter((item) => item.key !== key) : [...items, { key, label, href }];
        writeJson(pinKey, next);
        renderPins();
      });
    });
  }

  function renderPins() {
    if (!pinList || !pinEmpty) return;
    const items = readJson(pinKey, []);
    pinList.innerHTML = "";
    if (items.length === 0) {
      pinEmpty.hidden = false;
    } else {
      pinEmpty.hidden = true;
      for (const item of items) {
        const li = document.createElement("li");
        li.innerHTML = '<div class="pin-board-item"><button type="button" class="pin-toggle is-pinned" data-pin-key="' + item.key + '" data-pin-label="' + item.label + '" data-pin-href="' + item.href + '">핀 해제</button><a class="pin-board-link" href="' + item.href + '">' + item.label + '</a></div>';
        pinList.appendChild(li);
      }
    }
    bindPins();
  }

  function renderProgress() {
    if (!progressList || !progressEmpty) return;
    const rows = Array.from(document.querySelectorAll("[data-task-state-key]"));
    const items = rows
      .map((row) => {
        const stateKey = row.getAttribute("data-task-state-key");
        const label = row.getAttribute("data-task-label") || "작업";
        const href = row.getAttribute("data-task-href") || "#";
        if (!stateKey) return null;
        const state = readJson(stateKey, {});
        const total = Object.keys(state).length;
        const done = Object.values(state).filter(Boolean).length;
        if (total === 0 || done === 0) return null;
        return { label, href, done, total };
      })
      .filter(Boolean);
    progressList.innerHTML = "";
    if (items.length === 0) {
      progressEmpty.hidden = false;
      return;
    }
    progressEmpty.hidden = true;
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = '<div class="task-progress-item"><a class="task-progress-link" href="' + item.href + '">' + item.label + '</a><span class="task-progress-meta">' + item.done + '/' + item.total + ' 완료</span></div>';
      progressList.appendChild(li);
    }
  }

  renderPins();
  renderProgress();
})();
`.trim();
}

function renderTaskScript(reportId, taskStateKey) {
  return `
(() => {
  const pinKey = "code-visualizer:pins:${reportId}";
  const stateKey = "${taskStateKey}";
  const pinList = document.getElementById("pin-board-list");
  const pinEmpty = document.getElementById("pin-board-empty");
  const boxes = Array.from(document.querySelectorAll(".task-check-input"));
  const progress = document.getElementById("task-progress");

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); } catch { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function bindPins() {
    document.querySelectorAll(".pin-toggle").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const items = readJson(pinKey, []);
        const key = button.dataset.pinKey || "";
        const label = button.dataset.pinLabel || "핀 항목";
        const href = button.dataset.pinHref || "#";
        const exists = items.some((item) => item.key === key);
        const next = exists ? items.filter((item) => item.key !== key) : [...items, { key, label, href }];
        writeJson(pinKey, next);
        renderPins();
      });
    });
  }

  function renderPins() {
    if (!pinList || !pinEmpty) return;
    const items = readJson(pinKey, []);
    pinList.innerHTML = "";
    if (items.length === 0) {
      pinEmpty.hidden = false;
    } else {
      pinEmpty.hidden = true;
      for (const item of items) {
        const li = document.createElement("li");
        li.innerHTML = '<div class="pin-board-item"><button type="button" class="pin-toggle is-pinned" data-pin-key="' + item.key + '" data-pin-label="' + item.label + '" data-pin-href="' + item.href + '">핀 해제</button><a class="pin-board-link" href="' + item.href + '">' + item.label + '</a></div>';
        pinList.appendChild(li);
      }
    }
    bindPins();
  }

  function syncChecks() {
    const state = readJson(stateKey, {});
    let done = 0;
    boxes.forEach((box) => {
      const id = box.getAttribute("data-check-id") || "";
      const checked = Boolean(state[id]);
      box.checked = checked;
      if (checked) done += 1;
    });
    if (progress) progress.textContent = done + "/" + boxes.length + " 완료";
  }

  boxes.forEach((box) => {
    box.addEventListener("change", () => {
      const id = box.getAttribute("data-check-id") || "";
      const state = readJson(stateKey, {});
      state[id] = box.checked;
      writeJson(stateKey, state);
      syncChecks();
    });
  });

  bindPins();
  renderPins();
  syncChecks();
})();
`.trim();
}

function renderFilePreviewPage(reportId, file, summary, sourceRows, relatedFiles, linkMap) {
  const relatedItems = relatedFiles
    .map((related) => `<li><a class="preview-link" href="../${escapeHtml(linkMap.get(related.path) || "#")}">${escapeHtml(related.path)}</a></li>`)
    .join("");

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(file.path)}</title>
    <style>
      body { margin: 0; font-family: "SF Pro Display", "Pretendard", sans-serif; background: #f8fafc; color: #0f172a; }
      main { width: min(1120px, calc(100vw - 32px)); margin: 32px auto; }
      .shell { background: #fff; border: 1px solid #dbe3ef; border-radius: 24px; padding: 24px; box-shadow: 0 24px 70px rgba(15,23,42,0.08); }
      .path-chip { display: inline-flex; padding: 7px 11px; border-radius: 999px; background: rgba(15,118,110,0.10); color: #0f766e; font-family: "SF Mono", monospace; font-size: 12px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 18px 0 22px; }
      .card { padding: 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #dbe3ef; }
      .card h2 { margin: 0 0 8px; font-size: 18px; }
      .card p, .card li { margin: 0; line-height: 1.6; }
      .card ul { margin: 0; padding-left: 18px; }
      .preview-link, .back-link { color: #0f766e; text-decoration: none; font-weight: 700; }
      .pin-toggle { border: 0; border-radius: 999px; padding: 6px 10px; background: rgba(15,118,110,0.10); color: #0f766e; font-weight: 700; cursor: pointer; }
      .pin-toggle.is-pinned { background: rgba(245,158,11,0.18); color: #b45309; }
      .flow-shell { margin: 0 0 22px; padding: 18px; border-radius: 20px; background: #fff; border: 1px solid #dbe3ef; }
      .preview-flow { border-radius: 18px; border: 1px solid #dbe3ef; background: linear-gradient(180deg, #fff 0%, #f8fafc 100%); }
      .preview-flow-link { cursor: pointer; }
      .pin-board-shell { margin: 0 0 18px; padding: 18px; border-radius: 20px; background: rgba(15,23,42,0.04); border: 1px solid #dbe3ef; }
      .pin-board-head h2 { margin: 0 0 6px; font-size: 18px; }
      .pin-board-head p { margin: 0 0 10px; color: #475569; }
      .pin-board-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .pin-board-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid #dbe3ef; }
      .pin-board-link { color: #0f172a; text-decoration: none; font-weight: 700; }
      .pin-board-empty { margin: 0; color: #64748b; }
      pre { overflow: auto; padding: 18px; border-radius: 18px; background: #0f172a; color: #e2e8f0; font-family: "SF Mono", monospace; font-size: 13px; line-height: 1.55; }
    </style>
  </head>
  <body>
    <main>
      ${pinBoardMarkup()}
      <a class="back-link" href="../index.html">← 메인 시각화로 돌아가기</a>
      <section class="shell">
        <p class="path-chip">${escapeHtml(file.path)}</p>
        <h1>${escapeHtml(file.path)}</h1>
        <button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("file", file.path))}" data-pin-label="${escapeHtml(`파일 · ${file.path}`)}" data-pin-href="${escapeHtml(absoluteReportHref(reportId, `files/${previewFileName(file.path)}`))}">핀</button>
        <section class="grid">
          <article class="card"><h2>이 파일 한 줄 요약</h2><p>${escapeHtml(summary)}</p></article>
          <article class="card"><h2>표에서 온 위치</h2><ul>${sourceRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("") || "<li>직접 참조한 작업이 없습니다.</li>"}</ul></article>
          <article class="card"><h2>같이 보면 좋은 파일</h2><ul>${relatedItems || "<li>관련 파일이 없습니다.</li>"}</ul></article>
        </section>
        <section class="flow-shell">__FLOW__</section>
        <pre><code>${escapeHtml(file.content)}</code></pre>
      </section>
    </main>
    <script>${renderInteractiveScript({ reportId })}</script>
  </body>
</html>`;
}

function renderFileFlow(currentFile, relatedFiles, linkMap) {
  const width = 920;
  const positions = [{ x: 110, y: 80 }, { x: 660, y: 80 }, { x: 110, y: 320 }];
  const nodes = relatedFiles.slice(0, 3).map((file, index) => {
    const pos = positions[index] ?? { x: 660, y: 320 };
    const href = linkMap.get(file.path);
    const body = `<rect x="${pos.x}" y="${pos.y}" rx="18" ry="18" width="250" height="72" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" />
<text x="${pos.x + 16}" y="${pos.y + 30}" font-family="ui-sans-serif, system-ui" font-size="13" fill="#64748b">관련 파일</text>
<text x="${pos.x + 16}" y="${pos.y + 52}" font-family="ui-sans-serif, system-ui" font-size="16" font-weight="700" fill="#0f172a">${escapeHtml(shortFileLabel(file.path))}</text>`;
    return `<line x1="${pos.x + 125}" y1="${pos.y + 36}" x2="460" y2="245" stroke="#94a3b8" stroke-width="2.5" marker-end="url(#mini-arrow)" />${href ? `<a class="preview-flow-link" href="../${escapeHtml(href)}">${body}</a>` : body}`;
  }).join("");
  return `<svg class="preview-flow" viewBox="0 0 ${width} 430" width="100%" role="img" aria-label="이 파일 주변 흐름도">
  <defs><marker id="mini-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path></marker></defs>
  <rect x="0" y="0" width="${width}" height="430" fill="#ffffff"></rect>
  <text x="34" y="38" font-family="ui-sans-serif, system-ui" font-size="24" font-weight="700" fill="#0f172a">이 파일 주변 흐름도</text>
  <text x="34" y="62" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">현재 파일을 가운데 두고, 같이 보면 이해가 빨라지는 파일을 연결했습니다.</text>
  ${nodes}
  <rect x="310" y="210" rx="22" ry="22" width="300" height="86" fill="#ccfbf1" stroke="#14b8a6" stroke-width="2.5" />
  <text x="328" y="242" font-family="ui-sans-serif, system-ui" font-size="13" fill="#0f766e">현재 보고 있는 파일</text>
  <text x="328" y="268" font-family="ui-sans-serif, system-ui" font-size="18" font-weight="700" fill="#0f172a">${escapeHtml(shortFileLabel(currentFile.path))}</text>
</svg>`;
}

function renderTaskPage(reportId, tableTitle, headers, row, rowIndex, previewFiles, fileLinkMap) {
  const rowMap = new Map(headers.map((header, index) => [header, row[index] ?? ""]));
  const title = row[0] ?? tableTitle;
  const folderFallback = (() => {
    const prefix = (rowMap.get("대표 폴더") ?? "").trim();
    return prefix ? previewFiles.filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`)).map((file) => file.path).slice(0, 3) : [];
  })();
  const primaryFiles = splitFileCandidates(rowMap.get("대표 파일") ?? "");
  const startFiles = splitFileCandidates(rowMap.get("추천 시작점") ?? "");
  const resolvedPrimaryFiles = primaryFiles.length > 0 ? primaryFiles : folderFallback.slice(0, 1);
  const resolvedStartFiles = startFiles.length > 0 ? startFiles : folderFallback.slice(0, 2);
  const relatedFiles = [...new Set([...resolvedPrimaryFiles, ...resolvedStartFiles])];
  const firstAction = resolvedStartFiles[0] ?? resolvedPrimaryFiles[0] ?? "";
  const secondAction = relatedFiles[0] ?? resolvedPrimaryFiles[0] ?? firstAction;
  const thirdAction = relatedFiles[1] ?? relatedFiles[0] ?? resolvedPrimaryFiles[0] ?? firstAction;
  const stateKey = `code-visualizer:task:${reportId}:${taskKey(tableTitle, title, rowIndex)}`;
  const checklist = [
    { order: "1.", text: `${firstAction || "대표 파일"}부터 열어 현재 상태를 확인합니다.`, href: firstAction ? fileLinkMap.get(firstAction) : undefined },
    { order: "2.", text: `${rowMap.get("영향도") || "영향도"} 수준에 맞게 연결된 파일 범위를 좁힙니다.`, href: secondAction ? fileLinkMap.get(secondAction) : undefined },
    { order: "3.", text: `수정 후 관련 파일 프리뷰를 다시 보며 흐름이 자연스러운지 확인합니다.`, href: thirdAction ? fileLinkMap.get(thirdAction) : undefined }
  ];
  const listItems = (items) =>
    items.length > 0
      ? items.map((item) => {
          const href = fileLinkMap.get(item);
          return href ? `<li><a class="task-file-link" href="../${escapeHtml(href)}">${escapeHtml(item)}</a></li>` : `<li>${escapeHtml(item)}</li>`;
        }).join("")
      : "<li>직접 연결된 파일이 없습니다.</li>";
  const flowNodes = [
    { title: "시작", subtitle: firstAction || "대표 파일 먼저", href: firstAction ? fileLinkMap.get(firstAction) : undefined, color: "#dbeafe" },
    { title: "중간 점검", subtitle: rowMap.get("영향도") ? `영향도 ${rowMap.get("영향도")}` : "영향 범위 확인", href: secondAction ? fileLinkMap.get(secondAction) : undefined, color: "#fef3c7" },
    { title: "마무리", subtitle: relatedFiles[0] ?? "관련 파일 재확인", href: thirdAction ? fileLinkMap.get(thirdAction) : undefined, color: "#ccfbf1" }
  ];
  const flowMarkup = `<svg class="task-flow" viewBox="0 0 860 220" width="100%" role="img" aria-label="작업 흐름도">
  <defs><marker id="task-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path></marker></defs>
  <rect x="0" y="0" width="860" height="220" fill="#ffffff"></rect>
  <text x="28" y="34" font-family="ui-sans-serif, system-ui" font-size="22" font-weight="700" fill="#0f172a">작업 흐름도</text>
  <text x="28" y="58" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">이 작업을 손댈 때 보통 따라가면 되는 순서입니다.</text>
  ${flowNodes.map((node, index) => {
    const x = 36 + index * 270;
    const body = `<rect x="${x}" y="86" rx="20" ry="20" width="220" height="86" fill="${node.color}" stroke="#cbd5e1" stroke-width="2" />
<text x="${x + 18}" y="118" font-family="ui-sans-serif, system-ui" font-size="16" font-weight="700" fill="#0f172a">${escapeHtml(node.title)}</text>
<text x="${x + 18}" y="144" font-family="ui-sans-serif, system-ui" font-size="13" fill="#334155">${escapeHtml(node.subtitle)}</text>`;
    const arrow = index < flowNodes.length - 1 ? `<line x1="${x + 220}" y1="126" x2="${x + 252}" y2="126" stroke="#94a3b8" stroke-width="3" marker-end="url(#task-arrow)" />` : "";
    return `${arrow}${node.href ? `<a class="task-flow-link" href="../${escapeHtml(node.href)}">${body}</a>` : body}`;
  }).join("")}
  </svg>`;
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { margin: 0; font-family: "SF Pro Display", "Pretendard", sans-serif; background: #f8fafc; color: #0f172a; }
      main { width: min(1120px, calc(100vw - 32px)); margin: 32px auto; }
      .back-link { display: inline-flex; margin-bottom: 18px; color: #0f766e; text-decoration: none; font-weight: 700; }
      .pin-board-shell { margin: 0 0 18px; padding: 18px; border-radius: 20px; background: rgba(15,23,42,0.04); border: 1px solid #dbe3ef; }
      .pin-board-head h2 { margin: 0 0 6px; font-size: 18px; }
      .pin-board-head p { margin: 0 0 10px; color: #475569; }
      .pin-board-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .pin-board-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid #dbe3ef; }
      .pin-board-link { color: #0f172a; text-decoration: none; font-weight: 700; }
      .pin-board-empty { margin: 0; color: #64748b; }
      .shell { background: #fff; border: 1px solid #dbe3ef; border-radius: 24px; padding: 24px; box-shadow: 0 24px 70px rgba(15,23,42,0.08); }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 18px; }
      .card { padding: 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #dbe3ef; }
      .card h2 { margin: 0 0 8px; font-size: 18px; }
      .card p, .card li { margin: 0; line-height: 1.6; }
      .card ul { margin: 0; padding-left: 18px; }
      .badge { display: inline-flex; padding: 6px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
      .pin-toggle { border: 0; border-radius: 999px; padding: 6px 10px; background: rgba(15,118,110,0.10); color: #0f766e; font-weight: 700; cursor: pointer; }
      .pin-toggle.is-pinned { background: rgba(245,158,11,0.18); color: #b45309; }
      .task-file-link, .checklist-action-link { color: #0f766e; text-decoration: none; font-weight: 700; }
      .meta-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 0; }
      .meta-row .badge:nth-child(1) { background: rgba(245, 158, 11, 0.18); color: #b45309; }
      .meta-row .badge:nth-child(2) { background: rgba(16, 185, 129, 0.16); color: #047857; }
      .checklist-card ol { margin: 0; padding-left: 22px; }
      .checklist-card li { margin: 0 0 10px; }
      .task-progress { margin: 10px 0 0; color: #475569; font-weight: 700; }
      .flow-shell { margin-top: 18px; padding: 18px; border-radius: 20px; background: #fff; border: 1px solid #dbe3ef; }
      .task-flow { border-radius: 18px; border: 1px solid #dbe3ef; background: linear-gradient(180deg, #fff 0%, #f8fafc 100%); }
      .task-flow-link { cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      ${pinBoardMarkup()}
      <a class="back-link" href="../index.html">← 메인 시각화로 돌아가기</a>
      <section class="shell">
        <p>${escapeHtml(tableTitle)}</p>
        <h1>${escapeHtml(title)}</h1>
        <button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("task", title))}" data-pin-label="${escapeHtml(`작업 · ${title}`)}" data-pin-href="${escapeHtml(absoluteReportHref(reportId, `tasks/${taskPageName(tableTitle, title, rowIndex)}`))}">핀</button>
        <div class="meta-row">
          <span class="badge">수정 난이도: ${escapeHtml(rowMap.get("수정 난이도") || "정보 없음")}</span>
          <span class="badge">영향도: ${escapeHtml(rowMap.get("영향도") || "정보 없음")}</span>
        </div>
        <section class="grid">
          <article class="card"><h2>이 작업 한 줄 설명</h2><p>${escapeHtml(rowMap.get("왜 여기 보면 되는지") || "이 작업의 목적 설명이 없습니다.")}</p></article>
          <article class="card"><h2>먼저 볼 파일</h2><ul>${listItems(resolvedPrimaryFiles)}</ul></article>
          <article class="card"><h2>추천 시작점</h2><ul>${listItems(resolvedStartFiles)}</ul></article>
          <article class="card"><h2>관련 파일 프리뷰</h2><ul>${listItems(relatedFiles)}</ul></article>
          <article class="card checklist-card">
            <h2>우선순위 체크리스트</h2>
            <ol>${checklist.map((step, index) => {
              const label = `${step.order} ${step.text}`;
              return step.href
                ? `<li><label><input type="checkbox" class="task-check-input" data-check-id="${index}" /> <a class="checklist-action-link" href="../${escapeHtml(step.href)}">${escapeHtml(label)}</a></label></li>`
                : `<li><label><input type="checkbox" class="task-check-input" data-check-id="${index}" /> ${escapeHtml(label)}</label></li>`;
            }).join("")}</ol>
            <p id="task-progress" class="task-progress">0/3 완료</p>
          </article>
        </section>
        <section class="flow-shell">${flowMarkup}</section>
      </section>
    </main>
    <script>
${renderInteractiveScript({ reportId })}
(() => {
  const storageKey = "code-visualizer:task:${reportId}:${taskKey(tableTitle, title, rowIndex)}";
  const boxes = Array.from(document.querySelectorAll(".task-check-input"));
  const progress = document.getElementById("task-progress");
  function readState() { try { return JSON.parse(localStorage.getItem(storageKey) || "{}"); } catch { return {}; } }
  function writeState(state) { localStorage.setItem(storageKey, JSON.stringify(state)); }
  function sync() {
    const state = readState();
    let done = 0;
    boxes.forEach((box) => {
      const id = box.getAttribute("data-check-id") || "";
      const checked = Boolean(state[id]);
      box.checked = checked;
      if (checked) done += 1;
    });
    if (progress) progress.textContent = done + "/" + boxes.length + " 완료";
  }
  boxes.forEach((box) => {
    box.addEventListener("change", () => {
      const id = box.getAttribute("data-check-id") || "";
      const state = readState();
      state[id] = box.checked;
      writeState(state);
      sync();
    });
  });
  sync();
})();
    </script>
  </body>
</html>`;
}

async function writeReport(report) {
  const template = await fs.readFile(path.join(ROOT, "assets", "template.html"), "utf8");
  const style = await fs.readFile(path.join(ROOT, "assets", "style.css"), "utf8");
  const reportId = `${Date.now()}-${slugify(report.repoName)}-${slugify(report.intent)}`;
  const reportDir = path.join(REPORTS_ROOT, reportId);
  const filesDir = path.join(reportDir, "files");
  const tasksDir = path.join(reportDir, "tasks");
  const mediaDir = path.join(reportDir, "media");
  await fs.mkdir(filesDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });
  await fs.mkdir(mediaDir, { recursive: true });

  const fileLinkMap = new Map();
  for (const file of report.representativeFiles) {
    fileLinkMap.set(file.path, `files/${previewFileName(file.path)}`);
  }

  const previewArtifacts = [];
  for (const file of report.representativeFiles) {
    const relatedFiles = report.representativeFiles.filter((item) => item.path !== file.path).slice(0, 3);
    const sourceRows = report.capabilityRows.filter((row) => row.files.includes(file.path)).map((row) => `${row.title} · ${row.feature}`);
    const previewHtml = renderFilePreviewPage(reportId, file, summarizeFile(file), sourceRows, relatedFiles, fileLinkMap).replace("__FLOW__", renderFileFlow(file, relatedFiles, fileLinkMap));
    const previewPath = path.join(filesDir, previewFileName(file.path));
    await fs.writeFile(previewPath, previewHtml, "utf8");
    previewArtifacts.push(previewPath);
  }

  const taskArtifacts = [];
  const taskLinkMap = new Map();
  report.taskRows.forEach((row, index) => {
    taskLinkMap.set(taskKey(row.tableTitle, row.row[0], index), `tasks/${taskPageName(row.tableTitle, row.row[0], index)}`);
  });

  for (const [index, task] of report.taskRows.entries()) {
    const taskHtml = renderTaskPage(reportId, task.tableTitle, task.headers, task.row, index, report.representativeFiles, fileLinkMap);
    const filename = taskPageName(task.tableTitle, task.row[0], index);
    const taskPath = path.join(tasksDir, filename);
    await fs.writeFile(taskPath, taskHtml, "utf8");
    taskArtifacts.push(taskPath);
  }

  const capabilityRows = report.capabilityRows
    .map((capability, index) => {
      const taskHref = taskLinkMap.get(taskKey("기능 지도", capability.feature, index));
      const fileLinks = capability.files
        .map((file) => {
          const href = fileLinkMap.get(file);
          return href ? `<a class="file-link file-chip" href="${escapeHtml(href)}">${escapeHtml(file)}</a>` : escapeHtml(file);
        })
        .join('<span class="file-separator">, </span>');
      return `<tr class="glance-row tone-${capability.tone}" data-task-href="${escapeHtml(taskHref || "#")}" data-task-state-key="${escapeHtml(`code-visualizer:task:${reportId}:${taskKey("기능 지도", capability.feature, index)}`)}" data-task-label="${escapeHtml(capability.feature)}"><td><div class="glance-cell-head">${toneBadge(capability.tone)}<a class="task-row-link" href="${escapeHtml(taskHref || "#")}">${escapeHtml(capability.feature)}</a><button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("task", capability.feature))}" data-pin-label="${escapeHtml(`작업 · ${capability.feature}`)}" data-pin-href="${escapeHtml(absoluteReportHref(reportId, taskHref || "#"))}">핀</button></div></td><td>${escapeHtml(capability.role)}</td><td>${escapeHtml(capability.area)}</td><td>${fileLinks}</td></tr>`;
    })
    .join("");

  const termRows = TERM_ROWS.map(([term, plain]) => `<tr><td>${escapeHtml(term)}</td><td>${escapeHtml(plain)}</td></tr>`).join("");
  const userImpactItems = report.userImpact.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const fileLinkItems = report.representativeFiles
    .map((file) => `<li><a href="${escapeHtml(fileLinkMap.get(file.path) || "#")}">${escapeHtml(file.path)}</a></li>`)
    .join("");
  const featureLinkItems = report.taskRows
    .map((task, index) => {
      const href = taskLinkMap.get(taskKey(task.tableTitle, task.row[0], index));
      return `<li><a href="${escapeHtml(href || "#")}">${escapeHtml(task.row[0])}</a></li>`;
    })
    .join("");
  const timelineCards = report.timeline
    .map((item) => `<article class="timeline-card"><p class="timeline-step">${escapeHtml(item.step)}</p><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`)
    .join("");
  const diffRows = report.diffRows
    .map((row) => `<tr><td>${escapeHtml(row.kind)}</td><td>${escapeHtml(row.item)}</td><td>${escapeHtml(row.files)}</td><td>${escapeHtml(row.why)}</td></tr>`)
    .join("");
  const resultCardsParts = [];
  for (const connection of report.resultConnections) {
    if (connection.type === "image" && connection.sourcePath) {
      const ext = path.extname(connection.sourcePath);
      const filename = `${slugify(connection.sourcePath)}-${Buffer.from(connection.sourcePath).toString("hex").slice(0, 8)}${ext}`;
      const targetPath = path.join(mediaDir, filename);
      await fs.copyFile(connection.sourcePath, targetPath);
      resultCardsParts.push(`<article class="result-card"><h3>${escapeHtml(connection.title)}</h3><p>${escapeHtml(connection.description)}</p><img src="media/${escapeHtml(filename)}" alt="${escapeHtml(connection.title)}" /></article>`);
    } else if (connection.type === "file" && connection.sourcePath) {
      const ext = path.extname(connection.sourcePath);
      const filename = `${slugify(connection.sourcePath)}-${Buffer.from(connection.sourcePath).toString("hex").slice(0, 8)}${ext || ".dat"}`;
      const targetPath = path.join(mediaDir, filename);
      await fs.copyFile(connection.sourcePath, targetPath);
      resultCardsParts.push(`<article class="result-card"><h3>${escapeHtml(connection.title)}</h3><p>${escapeHtml(connection.description)}</p><p><a class="result-link" href="media/${escapeHtml(filename)}">${escapeHtml(path.basename(connection.sourcePath))}</a></p></article>`);
    } else if (connection.type === "link" && connection.url) {
      resultCardsParts.push(`<article class="result-card"><h3>${escapeHtml(connection.title)}</h3><p>${escapeHtml(connection.description)}</p><p><a class="result-link" href="${escapeHtml(connection.url)}">${escapeHtml(connection.url)}</a></p></article>`);
    } else {
      resultCardsParts.push(`<article class="result-card"><h3>${escapeHtml(connection.title)}</h3><p>${escapeHtml(connection.description)}</p></article>`);
    }
  }
  const resultCards = resultCardsParts.join("");

  const html = template
    .replaceAll("__TITLE__", escapeHtml(report.title))
    .replaceAll("__STYLE__", style)
    .replaceAll("__LEAD__", escapeHtml(report.lead))
    .replaceAll("__WHAT_NOW__", escapeHtml(report.whatNow))
    .replaceAll("__PROJECT_PURPOSE__", escapeHtml(report.projectPurpose))
    .replaceAll("__BEFORE__", escapeHtml(report.beforeText))
    .replaceAll("__NOW__", escapeHtml(report.nowText))
    .replaceAll("__USER_IMPACT_ITEMS__", userImpactItems)
    .replaceAll("__TIMELINE_CARDS__", timelineCards)
    .replaceAll("__DIFF_ROWS__", diffRows)
    .replaceAll("__CAPABILITY_ROWS__", capabilityRows)
    .replaceAll("__TERM_ROWS__", termRows)
    .replaceAll("__RESULT_CONNECTIONS__", resultCards)
    .replaceAll("__FILE_LINK_ITEMS__", fileLinkItems)
    .replaceAll("__FEATURE_LINK_ITEMS__", featureLinkItems)
    .replaceAll("__SCRIPT__", renderMainScript(reportId));

  const indexPath = path.join(reportDir, "index.html");
  const reportJsonPath = path.join(reportDir, "report.json");
  await fs.writeFile(indexPath, html, "utf8");
  await fs.writeFile(reportJsonPath, JSON.stringify(report, null, 2), "utf8");

  return {
    reportId,
    indexPath,
    reportJsonPath,
    previewArtifacts,
    taskArtifacts
  };
}

function buildTaskRows(capabilities) {
  const rows = capabilities.map((capability) => ({
    tableTitle: "기능 지도",
    headers: ["기능 이름", "사용자가 느끼는 역할", "관련 화면/처리", "대표 파일"],
    row: [capability.feature, capability.role, capability.area, capability.files.join(", ")]
  }));
  return rows;
}

async function buildReport(intent, repoPath, focus, inputs = {}) {
  const repoName = path.basename(repoPath);
  const tree = await collectTree(repoPath);
  const topDirs = await collectTopDirs(repoPath);
  const changedFiles = readGitChangedFiles(repoPath);
  const representativePaths = selectRepresentativeFiles(intent, tree, changedFiles, focus);
  const representativeFiles = await readFiles(repoPath, representativePaths);
  const capabilities = mapCapabilities(tree, topDirs).map((capability) => ({
    feature: capability.label,
    role: capability.role,
    area: capability.folder || capability.representativeFiles[0] || "관련 파일 없음",
    files: capability.representativeFiles.slice(0, 3),
    tone: capability.id === "ui" ? "ui" : capability.id === "server" ? "server" : capability.id === "shared" ? "packages" : capability.id === "docs" ? "docs" : capability.id === "tests" ? "tests" : capability.id === "tools" ? "cli" : "neutral"
  }));
  const readmeSummary = await readRepoSummary(repoPath);
  const projectPurpose = describeProjectPurpose(repoName, readmeSummary, capabilities);
  const latestCommit = readLatestCommit(repoPath);
  const sections = buildSections(intent, repoName, focus, changedFiles, capabilities, projectPurpose);
  const changeNarrative = buildNarrativeFromChanges({
    intent,
    focus,
    repoName,
    changedFiles,
    capabilities,
    latestCommit
  });
  const resultConnections = findResultConnections(repoPath, tree, focus, inputs);
  return {
    intent,
    repoName,
    title:
      intent === "change-explainer"
        ? `${repoName}: 변화 설명`
        : intent === "feature-explainer"
          ? `${repoName}: 기능 설명`
          : `${repoName}: 프로젝트 이해`,
    lead: changeNarrative.whatNow,
    whatNow: changeNarrative.whatNow,
    beforeText: changeNarrative.beforeText,
    nowText: changeNarrative.nowText,
    userImpact: changeNarrative.userImpact,
    projectPurpose: sections.projectPurpose,
    timeline: changeNarrative.timeline,
    diffRows: changeNarrative.diffRows,
    resultConnections,
    capabilityRows: capabilities,
    representativeFiles,
    taskRows: buildTaskRows(capabilities)
  };
}

async function ensureServer() {
  const health = await new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
  });
  if (health) return;
  const child = spawn(process.execPath, [__filename, "--serve", "--root", REPORTS_ROOT, "--port", String(PORT)], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 250));
}

async function serve(root, port) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    if (url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (!url.pathname.startsWith("/reports/")) {
      res.writeHead(404).end("Not found");
      return;
    }
    const rel = url.pathname.replace("/reports/", "");
    const target = path.resolve(root, rel);
    if (!target.startsWith(path.resolve(root))) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    try {
      const stat = await fs.stat(target);
      if (stat.isDirectory()) {
        const index = await fs.readFile(path.join(target, "index.html"));
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(index);
        return;
      }
      const body = await fs.readFile(target);
      const type = target.endsWith(".json") ? "application/json; charset=utf-8" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  server.listen(port, "127.0.0.1");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.serve) {
    await serve(args.root || REPORTS_ROOT, Number(args.port || PORT));
    return;
  }

  const intent = args.intent || "project-explainer";
  const repoPath = args.repo ? path.resolve(args.repo) : process.cwd();
  const focus = args.focus || "";
  if (!["change-explainer", "project-explainer", "feature-explainer"].includes(intent)) {
    throw new Error(`Unsupported intent: ${intent}`);
  }
  await fs.mkdir(REPORTS_ROOT, { recursive: true });
  const report = await buildReport(intent, repoPath, focus, {
    resultUrls: listArg(args["result-url"]),
    screenshotPaths: listArg(args.screenshot).map((item) => path.resolve(item)),
    artifactPaths: listArg(args.artifact).map((item) => path.resolve(item))
  });
  const written = await writeReport(report);
  await ensureServer();
  const url = `http://127.0.0.1:${PORT}/reports/${written.reportId}/index.html`;
  console.log(`Visualization ready: ${url}`);
  console.log(`Intent: ${intent}`);
  console.log(`Easy summary: ${report.whatNow}`);
  console.log(`Project purpose: ${report.projectPurpose}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
