import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RepoFile, VisualizationReport, VisualizationSection } from "../types.js";
import { escapeHtml, slugify } from "../utils.js";

function inferRowTone(row: string[]): string {
  const combined = row.join(" ").toLowerCase();
  if (combined.includes("ui") || combined.includes("화면")) return "ui";
  if (combined.includes("server") || combined.includes("서버") || combined.includes("api")) return "server";
  if (combined.includes("package") || combined.includes("공용")) return "packages";
  if (combined.includes("docs") || combined.includes("문서")) return "docs";
  if (combined.includes("test") || combined.includes("검증") || combined.includes("검사")) return "tests";
  if (combined.includes("cli") || combined.includes("터미널")) return "cli";
  return "neutral";
}

function toneBadge(tone: string): string {
  const labelMap: Record<string, string> = {
    ui: "UI",
    server: "SERVER",
    packages: "PACKAGE",
    docs: "DOCS",
    tests: "TEST",
    cli: "CLI",
    neutral: "INFO"
  };
  return `<span class="glance-badge badge-${tone}">${escapeHtml(labelMap[tone] ?? "INFO")}</span>`;
}

function severityClass(value: string): string {
  if (value.includes("높음")) return "high";
  if (value.includes("중간")) return "medium";
  if (value.includes("낮음")) return "low";
  return "neutral";
}

function previewFileName(filePath: string): string {
  const suffix = Buffer.from(filePath).toString("hex").slice(0, 10);
  return `${slugify(filePath)}-${suffix}.html`;
}

function taskPageName(tableTitle: string, rowTitle: string, index: number): string {
  const base = slugify(`${tableTitle}-${rowTitle}`);
  const suffix = Buffer.from(`${tableTitle}-${rowTitle}`).toString("hex").slice(0, 8);
  return `${base || "task"}-${suffix}-${index}.html`;
}

function splitFileCandidates(cell: string): string[] {
  return cell
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => /(?:\/|\.md$|\.json$|\.tsx?$|\.jsx?$)/.test(part));
}

function renderLinkedFileTokens(cell: string, linkMap: Map<string, string>, className: string): string {
  const candidates = splitFileCandidates(cell);
  if (candidates.length === 0) {
    return `<span class="${className}">${escapeHtml(cell)}</span>`;
  }

  const rendered = candidates.map((candidate) => {
    const href = linkMap.get(candidate);
    if (!href) {
      return `<span class="${className}">${escapeHtml(candidate)}</span>`;
    }
    return `<a class="file-link ${className}" href="${escapeHtml(href)}">${escapeHtml(candidate)}</a>`;
  });
  return rendered.join('<span class="file-separator">, </span>');
}

function taskKey(tableTitle: string, rowTitle: string, index: number): string {
  return `${tableTitle}::${rowTitle}::${index}`;
}

function pinKey(prefix: string, value: string): string {
  return `${prefix}:${value}`;
}

function absoluteReportHref(reportId: string, relativePath: string): string {
  return `/reports/${reportId}/${relativePath}`;
}

function renderPinBoardShell(title = "핀 보드", subtitle = "중요한 파일과 작업을 다시 열 수 있습니다."): string {
  return `<section class="pin-board-shell">
  <div class="pin-board-head">
    <h2>${escapeHtml(title)}</h2>
    <p>${escapeHtml(subtitle)}</p>
  </div>
  <ul id="pin-board-list" class="pin-board-list"></ul>
  <p id="pin-board-empty" class="pin-board-empty">아직 핀된 항목이 없습니다.</p>
</section>`;
}

function renderInteractiveScript(params: {
  reportId: string;
  currentPin?: { key: string; label: string; href: string };
}): string {
  const payload = JSON.stringify(params);
  return `
(() => {
  const config = ${payload};
  const storageKey = "code-visualizer:pins:" + config.reportId;
  const listEl = document.getElementById("pin-board-list");
  const emptyEl = document.getElementById("pin-board-empty");
  const progressListEl = document.getElementById("task-progress-list");
  const progressEmptyEl = document.getElementById("task-progress-empty");

  function readPins() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch {
      return [];
    }
  }

  function writePins(items) {
    localStorage.setItem(storageKey, JSON.stringify(items));
  }

  function isPinned(items, key) {
    return items.some((item) => item.key === key);
  }

  function renderBoard() {
    if (!listEl || !emptyEl) return;
    const items = readPins();
    listEl.innerHTML = "";
    if (items.length === 0) {
      emptyEl.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = '<div class="pin-board-item"><button type="button" class="pin-toggle is-pinned" data-pin-key="' + item.key + '" data-pin-label="' + item.label + '" data-pin-href="' + item.href + '">핀 해제</button><a class="pin-board-link" href="' + item.href + '">' + item.label + '</a></div>';
      listEl.appendChild(li);
    }
    bindPinButtons();
  }

  function renderProgressBoard() {
    if (!progressListEl || !progressEmptyEl) return;
    const prefix = "code-visualizer:task:" + config.reportId + ":";
    const taskRows = Array.from(document.querySelectorAll("[data-task-state-key]"));
    const labelMap = new Map(taskRows.map((row) => [row.getAttribute("data-task-state-key"), {
      label: row.getAttribute("data-task-label") || "작업",
      href: row.getAttribute("data-task-href") || "#"
    }]));

    const items = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(prefix)) continue;
      try {
        const state = JSON.parse(localStorage.getItem(key) || "{}");
        const done = Object.values(state).filter(Boolean).length;
        const total = Object.keys(state).length;
        if (done === 0 || total === 0) continue;
        const meta = labelMap.get(key);
        items.push({
          key,
          label: meta?.label || key.replace(prefix, ""),
          href: meta?.href || "#",
          done,
          total
        });
      } catch {}
    }

    progressListEl.innerHTML = "";
    if (items.length === 0) {
      progressEmptyEl.hidden = false;
      return;
    }
    progressEmptyEl.hidden = true;
    for (const item of items) {
      const li = document.createElement("li");
      li.innerHTML = '<div class="task-progress-item"><a class="task-progress-link" href="' + item.href + '">' + item.label + '</a><span class="task-progress-meta">' + item.done + '/' + item.total + ' 완료</span></div>';
      progressListEl.appendChild(li);
    }
  }

  function syncButtons() {
    const items = readPins();
    document.querySelectorAll(".pin-toggle").forEach((button) => {
      const key = button.getAttribute("data-pin-key") || "";
      const pinned = isPinned(items, key);
      button.classList.toggle("is-pinned", pinned);
      button.textContent = pinned ? "핀 해제" : "핀";
    });
  }

  function togglePin(button) {
    const key = button.getAttribute("data-pin-key") || "";
    const label = button.getAttribute("data-pin-label") || "핀 항목";
    const href = button.getAttribute("data-pin-href") || "#";
    const items = readPins();
    const next = isPinned(items, key)
      ? items.filter((item) => item.key !== key)
      : [...items, { key, label, href }];
    writePins(next);
    renderBoard();
    syncButtons();
  }

  function bindPinButtons() {
    document.querySelectorAll(".pin-toggle").forEach((button) => {
      if (button.dataset.bound === "true") return;
      button.dataset.bound = "true";
      button.addEventListener("click", (event) => {
        event.preventDefault();
        togglePin(button);
      });
    });
  }

  bindPinButtons();
  renderBoard();
  renderProgressBoard();
  syncButtons();
})();
`.trim();
}

function renderTableCell(header: string, cell: string, linkMap: Map<string, string>): string {
  if (header === "수정 난이도" || header === "영향도") {
    const level = severityClass(cell);
    return `<td><span class="severity-badge severity-${level}">${escapeHtml(cell)}</span></td>`;
  }

  if (header === "대표 파일") {
    return `<td>${renderLinkedFileTokens(cell, linkMap, "file-chip")}</td>`;
  }

  if (header === "추천 시작점") {
    return `<td>${renderLinkedFileTokens(cell, linkMap, "startpoint-chip")}</td>`;
  }

  return `<td>${escapeHtml(cell)}</td>`;
}

function renderSection(section: VisualizationSection): string {
  if (section.kind === "diagram") {
    return `<section class="panel">
  <h3>${escapeHtml(section.title)}</h3>
  <div class="diagram">${section.content}</div>
</section>`;
  }

  if (section.kind === "list") {
    const items = section.content
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `<section class="panel">
  <h3>${escapeHtml(section.title)}</h3>
  <ul>${items}</ul>
</section>`;
  }

  return `<section class="panel">
  <h3>${escapeHtml(section.title)}</h3>
  <p>${escapeHtml(section.content).replaceAll("\n", "<br />")}</p>
</section>`;
}

function summarizeFile(file: RepoFile): string {
  const filePath = file.path.toLowerCase();
  if (filePath.includes("ui/")) return "이 파일은 화면이나 사용자 경험과 바로 맞닿아 있는 UI 쪽 파일입니다.";
  if (filePath.includes("server/")) return "이 파일은 동작 규칙과 API 흐름을 담당하는 서버 쪽 파일입니다.";
  if (filePath.includes("packages/")) return "이 파일은 여러 곳에서 공통으로 쓰는 규칙이나 헬퍼를 담는 파일입니다.";
  if (filePath.includes("readme") || filePath.includes("docs/") || filePath.endsWith(".md")) return "이 파일은 코드보다 배경 설명과 설계 의도를 이해하는 데 먼저 보면 좋은 문서입니다.";
  if (filePath.includes("cli/")) return "이 파일은 터미널 진입점이나 실행 흐름을 이해할 때 먼저 보면 좋은 CLI 파일입니다.";
  return "이 파일은 현재 시각화에서 핵심 진입점 중 하나로 선택된 파일입니다.";
}

function findSourceRows(report: VisualizationReport, filePath: string): string[] {
  const matches: string[] = [];
  for (const table of report.glance.tables) {
    for (const row of table.rows) {
      if (row.some((cell) => splitFileCandidates(cell).includes(filePath))) {
        matches.push(`${table.title} · ${row[0]}`);
      }
    }
  }
  return matches;
}

function relatedPreviewFiles(previewFiles: RepoFile[], currentFile: RepoFile): RepoFile[] {
  const currentDir = path.dirname(currentFile.path);
  const currentTop = currentFile.path.split("/")[0] ?? "";

  return previewFiles
    .filter((file) => file.path !== currentFile.path)
    .sort((left, right) => {
      const leftScore = Number(path.dirname(left.path) === currentDir) * 4 + Number(left.path.startsWith(`${currentTop}/`)) * 2;
      const rightScore = Number(path.dirname(right.path) === currentDir) * 4 + Number(right.path.startsWith(`${currentTop}/`)) * 2;
      return rightScore - leftScore || left.path.localeCompare(right.path);
    })
    .slice(0, 3);
}

function shortFileLabel(filePath: string): string {
  const parts = filePath.split("/");
  if (parts.length <= 2) {
    return filePath;
  }
  return `${parts[0]}/${parts[parts.length - 1]}`;
}

function renderPreviewFlow(currentFile: RepoFile, relatedFiles: RepoFile[], linkMap: Map<string, string>): string {
  const nodes = relatedFiles.slice(0, 3);
  const width = 920;
  const centerX = 460;
  const centerY = 210;
  const nodePositions = [
    { x: 120, y: 70 },
    { x: 680, y: 70 },
    { x: 120, y: 320 }
  ];

  const relatedSvg = nodes
    .map((file, index) => {
      const pos = nodePositions[index] ?? { x: 680, y: 320 };
      const href = linkMap.get(file.path);
      const body = `<rect x="${pos.x}" y="${pos.y}" rx="18" ry="18" width="260" height="72" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" />
<text x="${pos.x + 18}" y="${pos.y + 30}" font-family="ui-sans-serif, system-ui" font-size="13" fill="#64748b">관련 파일</text>
<text x="${pos.x + 18}" y="${pos.y + 52}" font-family="ui-sans-serif, system-ui" font-size="16" font-weight="700" fill="#0f172a">${escapeHtml(shortFileLabel(file.path))}</text>`;
      const clickable = href
        ? `<a class="preview-flow-link" href="../${escapeHtml(href)}">${body}</a>`
        : body;
      return `<line x1="${pos.x + 130}" y1="${pos.y + 36}" x2="${centerX}" y2="${centerY + 36}" stroke="#94a3b8" stroke-width="2.5" marker-end="url(#mini-arrow)" />
${clickable}`;
    })
    .join("\n");

  return `<svg class="preview-flow" viewBox="0 0 ${width} 430" width="100%" role="img" aria-label="이 파일 주변 흐름도">
  <defs>
    <marker id="mini-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="430" fill="#ffffff"></rect>
  <text x="34" y="38" font-family="ui-sans-serif, system-ui" font-size="24" font-weight="700" fill="#0f172a">이 파일 주변 흐름도</text>
  <text x="34" y="62" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">현재 파일을 가운데 두고, 같이 보면 이해가 빨라지는 파일을 연결했습니다.</text>
  ${relatedSvg}
  <rect x="${centerX - 150}" y="${centerY}" rx="22" ry="22" width="300" height="86" fill="#ccfbf1" stroke="#14b8a6" stroke-width="2.5" />
  <text x="${centerX - 132}" y="${centerY + 32}" font-family="ui-sans-serif, system-ui" font-size="13" fill="#0f766e">현재 보고 있는 파일</text>
  <text x="${centerX - 132}" y="${centerY + 58}" font-family="ui-sans-serif, system-ui" font-size="18" font-weight="700" fill="#0f172a">${escapeHtml(shortFileLabel(currentFile.path))}</text>
</svg>`;
}

function renderFilePreviewPage(report: VisualizationReport, file: RepoFile, previewFiles: RepoFile[], linkMap: Map<string, string>): string {
  const sourceRows = findSourceRows(report, file.path);
  const relatedFiles = relatedPreviewFiles(previewFiles, file);
  const sourceRowItems = sourceRows.length > 0
    ? sourceRows.map((row) => `<li>${escapeHtml(row)}</li>`).join("")
    : `<li>이 파일을 직접 참조한 표 행은 없지만, 시각화가 중요 파일로 골랐습니다.</li>`;
  const relatedFileItems = relatedFiles.length > 0
    ? relatedFiles
        .map((related) => {
          const href = linkMap.get(related.path);
          const body = href
            ? `<a class="preview-link" href="../${escapeHtml(href)}">${escapeHtml(related.path)}</a>`
            : escapeHtml(related.path);
          return `<li>${body}</li>`;
        })
        .join("")
    : `<li>같이 묶을 다른 대표 파일이 아직 없습니다.</li>`;
  const currentPreviewHref = absoluteReportHref(report.reportId, `files/${previewFileName(file.path)}`);

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(file.path)} - preview</title>
    <style>
      body {
        margin: 0;
        font-family: "SF Pro Display", "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #0f172a;
      }
      main {
        width: min(1100px, calc(100vw - 32px));
        margin: 32px auto;
      }
      .back-link {
        display: inline-flex;
        margin-bottom: 18px;
        color: #0f766e;
        text-decoration: none;
        font-weight: 700;
      }
      .pin-board-shell { margin: 0 0 18px; padding: 18px; border-radius: 20px; background: rgba(15,23,42,0.04); border: 1px solid #dbe4f0; }
      .pin-board-head h2 { margin: 0 0 6px; font-size: 18px; }
      .pin-board-head p { margin: 0 0 10px; color: #475569; }
      .pin-board-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .pin-board-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid #dbe4f0; }
      .pin-board-link { color: #0f172a; text-decoration: none; font-weight: 700; }
      .pin-board-empty { margin: 0; color: #64748b; }
      .shell {
        background: #ffffff;
        border: 1px solid #dbe4f0;
        border-radius: 24px;
        padding: 24px;
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
      }
      .path-chip {
        display: inline-flex;
        padding: 7px 11px;
        border-radius: 999px;
        background: rgba(15,118,110,0.10);
        color: #0f766e;
        font-family: "SF Mono", "JetBrains Mono", monospace;
        font-size: 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 16px;
        margin: 18px 0 22px;
      }
      .info-card {
        padding: 18px;
        border-radius: 18px;
        background: #f8fafc;
        border: 1px solid #dbe4f0;
      }
      .info-card h2 {
        margin: 0 0 8px;
        font-size: 18px;
      }
      .info-card p,
      .info-card li {
        margin: 0;
        line-height: 1.6;
      }
      .info-card ul {
        margin: 0;
        padding-left: 18px;
      }
      .preview-link {
        color: #0f766e;
        text-decoration: none;
        font-weight: 700;
      }
      .pin-toggle { border: 0; border-radius: 999px; padding: 6px 10px; background: rgba(15,118,110,0.10); color: #0f766e; font-weight: 700; cursor: pointer; }
      .pin-toggle.is-pinned { background: rgba(245,158,11,0.18); color: #b45309; }
      .flow-shell {
        margin: 0 0 22px;
        padding: 18px;
        border-radius: 20px;
        background: #ffffff;
        border: 1px solid #dbe4f0;
      }
      .preview-flow {
        border-radius: 18px;
        border: 1px solid #dbe4f0;
        background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
      }
      .preview-flow-link {
        cursor: pointer;
      }
      pre {
        overflow: auto;
        padding: 18px;
        border-radius: 18px;
        background: #0f172a;
        color: #e2e8f0;
        font-family: "SF Mono", "JetBrains Mono", monospace;
        font-size: 13px;
        line-height: 1.55;
      }
    </style>
  </head>
  <body>
    <main>
      ${renderPinBoardShell()}
      <a class="back-link" href="../index.html">← 메인 시각화로 돌아가기</a>
      <section class="shell">
        <p class="path-chip">${escapeHtml(file.path)}</p>
        <h1>${escapeHtml(file.path)}</h1>
        <button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("file", file.path))}" data-pin-label="${escapeHtml(`파일 · ${file.path}`)}" data-pin-href="${escapeHtml(currentPreviewHref)}">핀</button>
        <p>표에서 클릭해 들어온 파일 미리보기입니다. 전체 파일이 아니라 시각화에 필요한 범위만 보여줍니다.</p>
        <section class="grid">
          <article class="info-card">
            <h2>이 파일 한 줄 요약</h2>
            <p>${escapeHtml(summarizeFile(file))}</p>
          </article>
          <article class="info-card">
            <h2>표에서 온 위치</h2>
            <ul>${sourceRowItems}</ul>
          </article>
          <article class="info-card">
            <h2>같이 보면 좋은 파일</h2>
            <ul>${relatedFileItems}</ul>
          </article>
        </section>
        <section class="flow-shell">
          ${renderPreviewFlow(file, relatedFiles, linkMap)}
        </section>
        <pre><code>${escapeHtml(file.content)}</code></pre>
      </section>
    </main>
    <script>
${renderInteractiveScript({ reportId: report.reportId })}
    </script>
  </body>
</html>`;
}

function renderTaskPage(params: {
  report: VisualizationReport;
  tableTitle: string;
  headers: string[];
  row: string[];
  rowIndex: number;
  fileLinkMap: Map<string, string>;
  previewFiles: RepoFile[];
}): string {
  const { report, tableTitle, headers, row, fileLinkMap, previewFiles } = params;
  const rowMap = new Map(headers.map((header, index) => [header, row[index] ?? ""]));
  const title = row[0] ?? tableTitle;
  const deriveFromFolder = (folderValue: string): string[] => {
    const prefix = folderValue.trim();
    if (!prefix) {
      return [];
    }
    return previewFiles.filter((file) => file.path === prefix || file.path.startsWith(`${prefix}/`)).map((file) => file.path).slice(0, 3);
  };
  const folderFallback = deriveFromFolder(rowMap.get("대표 폴더") ?? "");
  const primaryFiles = splitFileCandidates(rowMap.get("대표 파일") ?? "");
  const startFiles = splitFileCandidates(rowMap.get("추천 시작점") ?? "");
  const resolvedPrimaryFiles = primaryFiles.length > 0 ? primaryFiles : folderFallback.slice(0, 1);
  const resolvedStartFiles = startFiles.length > 0 ? startFiles : folderFallback.slice(0, 2);
  const relatedFiles = [...new Set([...resolvedPrimaryFiles, ...resolvedStartFiles])];
  const firstAction = resolvedStartFiles[0] ?? resolvedPrimaryFiles[0] ?? "";
  const secondAction = relatedFiles[0] ?? resolvedPrimaryFiles[0] ?? firstAction;
  const thirdAction = relatedFiles[1] ?? relatedFiles[0] ?? resolvedPrimaryFiles[0] ?? firstAction;
  const checklistSteps = [
    {
      order: "1.",
      text: `${firstAction || "대표 파일"}부터 열어 현재 상태를 확인합니다.`,
      href: firstAction ? fileLinkMap.get(firstAction) : undefined
    },
    {
      order: "2.",
      text: `${rowMap.get("영향도") || "영향도"} 수준에 맞게 연결된 파일 범위를 좁힙니다.`,
      href: secondAction ? fileLinkMap.get(secondAction) : undefined
    },
    {
      order: "3.",
      text: `수정 후 관련 파일 프리뷰를 다시 보며 흐름이 자연스러운지 확인합니다.`,
      href: thirdAction ? fileLinkMap.get(thirdAction) : undefined
    }
  ];

  const fileList = (items: string[]) =>
    items.length > 0
      ? items
          .map((item) => {
            const href = fileLinkMap.get(item);
            return href
              ? `<li><a class="task-file-link" href="../${escapeHtml(href)}">${escapeHtml(item)}</a></li>`
              : `<li>${escapeHtml(item)}</li>`;
          })
          .join("")
      : "<li>직접 연결된 파일이 없습니다.</li>";

  const taskFlowNodes = [
    {
      title: "시작",
      subtitle: firstAction || "대표 파일 먼저",
      href: firstAction ? fileLinkMap.get(firstAction) : undefined
    },
    {
      title: "중간 점검",
      subtitle: rowMap.get("영향도") ? `영향도 ${rowMap.get("영향도")}` : "영향 범위 확인",
      href: secondAction ? fileLinkMap.get(secondAction) : undefined
    },
    {
      title: "마무리",
      subtitle: relatedFiles[0] ?? "관련 파일 재확인",
      href: thirdAction ? fileLinkMap.get(thirdAction) : undefined
    }
  ];
  const currentTaskHref = absoluteReportHref(report.reportId, `tasks/${taskPageName(tableTitle, title, params.rowIndex)}`);

  const taskFlow = `<svg class="task-flow" viewBox="0 0 860 220" width="100%" role="img" aria-label="작업 흐름도">
  <defs>
    <marker id="task-arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8"></path>
    </marker>
  </defs>
  <rect x="0" y="0" width="860" height="220" fill="#ffffff"></rect>
  <text x="28" y="34" font-family="ui-sans-serif, system-ui" font-size="22" font-weight="700" fill="#0f172a">작업 흐름도</text>
  <text x="28" y="58" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">이 작업을 손댈 때 보통 따라가면 되는 순서입니다.</text>
  ${taskFlowNodes
    .map((node, index) => {
      const x = 36 + index * 270;
      const arrow =
        index < taskFlowNodes.length - 1
          ? `<line x1="${x + 220}" y1="126" x2="${x + 252}" y2="126" stroke="#94a3b8" stroke-width="3" marker-end="url(#task-arrow)" />`
          : "";
      const nodeBody = `<rect x="${x}" y="86" rx="20" ry="20" width="220" height="86" fill="${index === 0 ? "#dbeafe" : index === 1 ? "#fef3c7" : "#ccfbf1"}" stroke="#cbd5e1" stroke-width="2" />
<text x="${x + 18}" y="118" font-family="ui-sans-serif, system-ui" font-size="16" font-weight="700" fill="#0f172a">${escapeHtml(node.title)}</text>
<text x="${x + 18}" y="144" font-family="ui-sans-serif, system-ui" font-size="13" fill="#334155">${escapeHtml(node.subtitle)}</text>`;
      const clickable = node.href ? `<a class="task-flow-link" href="../${escapeHtml(node.href)}">${nodeBody}</a>` : nodeBody;
      return `${arrow}${clickable}`;
    })
    .join("")}
</svg>`;

  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} - task</title>
    <style>
      body { margin: 0; font-family: "SF Pro Display", "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }
      main { width: min(1100px, calc(100vw - 32px)); margin: 32px auto; }
      .back-link { display: inline-flex; margin-bottom: 18px; color: #0f766e; text-decoration: none; font-weight: 700; }
      .pin-board-shell { margin: 0 0 18px; padding: 18px; border-radius: 20px; background: rgba(15,23,42,0.04); border: 1px solid #dbe4f0; }
      .pin-board-head h2 { margin: 0 0 6px; font-size: 18px; }
      .pin-board-head p { margin: 0 0 10px; color: #475569; }
      .pin-board-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 10px; }
      .pin-board-item { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 14px; background: #fff; border: 1px solid #dbe4f0; }
      .pin-board-link { color: #0f172a; text-decoration: none; font-weight: 700; }
      .pin-board-empty { margin: 0; color: #64748b; }
      .shell { background: #fff; border: 1px solid #dbe4f0; border-radius: 24px; padding: 24px; box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08); }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 18px; }
      .card { padding: 18px; border-radius: 18px; background: #f8fafc; border: 1px solid #dbe4f0; }
      .card h2 { margin: 0 0 8px; font-size: 18px; }
      .card p, .card li { margin: 0; line-height: 1.6; }
      .card ul { margin: 0; padding-left: 18px; }
      .badge { display: inline-flex; padding: 6px 10px; border-radius: 999px; font-weight: 700; font-size: 12px; }
      .task-file-link { color: #0f766e; text-decoration: none; font-weight: 700; }
      .pin-toggle { border: 0; border-radius: 999px; padding: 6px 10px; background: rgba(15,118,110,0.10); color: #0f766e; font-weight: 700; cursor: pointer; }
      .pin-toggle.is-pinned { background: rgba(245,158,11,0.18); color: #b45309; }
      .checklist-action-link { color: #0f766e; text-decoration: none; font-weight: 700; }
      .meta-row { display: flex; gap: 10px; flex-wrap: wrap; margin: 8px 0 0; }
      .meta-row .badge:nth-child(1) { background: rgba(245, 158, 11, 0.18); color: #b45309; }
      .meta-row .badge:nth-child(2) { background: rgba(16, 185, 129, 0.16); color: #047857; }
      .checklist-card ol { margin: 0; padding-left: 22px; }
      .checklist-card li { margin: 0 0 10px; }
      .task-progress { margin: 10px 0 0; color: #475569; font-weight: 700; }
      .flow-shell { margin-top: 18px; padding: 18px; border-radius: 20px; background: #fff; border: 1px solid #dbe4f0; }
      .task-flow { border-radius: 18px; border: 1px solid #dbe4f0; background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%); }
      .task-flow-link { cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      ${renderPinBoardShell()}
      <a class="back-link" href="../index.html">← 메인 시각화로 돌아가기</a>
      <section class="shell">
        <p>${escapeHtml(tableTitle)}</p>
        <h1>${escapeHtml(title)}</h1>
        <button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("task", title))}" data-pin-label="${escapeHtml(`작업 · ${title}`)}" data-pin-href="${escapeHtml(currentTaskHref)}">핀</button>
        <div class="meta-row">
          <span class="badge">수정 난이도: ${escapeHtml(rowMap.get("수정 난이도") || "정보 없음")}</span>
          <span class="badge">영향도: ${escapeHtml(rowMap.get("영향도") || "정보 없음")}</span>
        </div>
        <section class="grid">
          <article class="card">
            <h2>이 작업 한 줄 설명</h2>
            <p>${escapeHtml(rowMap.get("왜 여기 보면 되는지") || "이 작업의 목적 설명이 없습니다.")}</p>
          </article>
          <article class="card">
            <h2>먼저 볼 파일</h2>
            <ul>${fileList(resolvedPrimaryFiles)}</ul>
          </article>
          <article class="card">
            <h2>추천 시작점</h2>
            <ul>${fileList(resolvedStartFiles)}</ul>
          </article>
          <article class="card">
            <h2>관련 파일 프리뷰</h2>
            <ul>${fileList(relatedFiles)}</ul>
          </article>
          <article class="card checklist-card">
            <h2>우선순위 체크리스트</h2>
            <ol>${checklistSteps
              .map((step, index) => {
                const label = `${step.order} ${step.text}`;
                return step.href
                  ? `<li><label><input type="checkbox" class="task-check-input" data-check-id="${index}" /> <a class="checklist-action-link" href="../${escapeHtml(step.href)}">${escapeHtml(label)}</a></label></li>`
                  : `<li><label><input type="checkbox" class="task-check-input" data-check-id="${index}" /> ${escapeHtml(label)}</label></li>`;
              })
              .join("")}</ol>
            <p id="task-progress" class="task-progress">0/3 완료</p>
          </article>
        </section>
        <section class="flow-shell">
          ${taskFlow}
        </section>
      </section>
    </main>
    <script>
${renderInteractiveScript({ reportId: report.reportId })}
(() => {
  const storageKey = "code-visualizer:task:${report.reportId}:${taskKey(tableTitle, title, params.rowIndex)}";
  const boxes = Array.from(document.querySelectorAll(".task-check-input"));
  const progress = document.getElementById("task-progress");

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || "{}");
    } catch {
      return {};
    }
  }

  function writeState(state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

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

async function renderHtml(
  report: VisualizationReport,
  linkMap: Map<string, string>,
  taskLinkMap: Map<string, string>
): Promise<string> {
  const easySections = report.sections.filter((section) => (section.audience ?? "technical") === "easy");
  const technicalSections = report.sections.filter((section) => (section.audience ?? "technical") === "technical");
  const easySectionHtml = easySections.map(renderSection).join("\n");
  const technicalSectionHtml = technicalSections.map(renderSection).join("\n");
  const confidenceItems = report.confidence.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("");
  const artifactItems = report.artifacts.map((artifact) => `<li>${escapeHtml(artifact)}</li>`).join("");
  const glanceCards = report.glance.cards
    .map(
      (card) => `<article class="slide-card">
  <p class="slide-card-label">${escapeHtml(card.label)}</p>
  <p class="slide-card-value">${escapeHtml(card.value)}</p>
</article>`
    )
    .join("");
  const glanceTables = report.glance.tables
    .map((table) => {
      const headers = table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
      const rows = table.rows
        .map((row, rowIndex) => {
          const tone = inferRowTone(row);
          const [first, ...rest] = row;
          const remainingHeaders = table.headers.slice(1);
          const taskHref = taskLinkMap.get(taskKey(table.title, first ?? "", rowIndex));
          const pinMarkup = taskHref
            ? `<button type="button" class="pin-toggle" data-pin-key="${escapeHtml(pinKey("task", first ?? ""))}" data-pin-label="${escapeHtml(`작업 · ${first ?? ""}`)}" data-pin-href="${escapeHtml(absoluteReportHref(report.reportId, taskHref))}">핀</button>`
            : "";
          const firstCellContent = taskHref
            ? `<a class="task-row-link" href="${escapeHtml(taskHref)}">${escapeHtml(first ?? "")}</a>`
            : `<span>${escapeHtml(first ?? "")}</span>`;
          const stateKey = `code-visualizer:task:${report.reportId}:${taskKey(table.title, first ?? "", rowIndex)}`;
          const rowAttrs = taskHref
            ? ` class="glance-row tone-${tone}" data-task-href="${escapeHtml(taskHref)}" data-task-state-key="${escapeHtml(stateKey)}" data-task-label="${escapeHtml(first ?? "")}"`
            : ` class="glance-row tone-${tone}"`;
          return `<tr${rowAttrs}><td><div class="glance-cell-head">${toneBadge(tone)}${firstCellContent}${pinMarkup}</div></td>${rest
            .map((cell, index) => renderTableCell(remainingHeaders[index] ?? "", cell, linkMap))
            .join("")}</tr>`;
        })
        .join("");
      return `<section class="glance-table-block">
  <div class="glance-table-head">
    <h3>${escapeHtml(table.title)}</h3>
    <p>${escapeHtml(table.caption)}</p>
  </div>
  <div class="slide-table-shell">
    <table class="glance-table">
      <thead><tr>${headers}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</section>`;
    })
    .join("");
  const viewerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../viewer");
  const [template, themeCss] = await Promise.all([
    fs.readFile(path.join(viewerRoot, "template.html"), "utf8"),
    fs.readFile(path.join(viewerRoot, "theme.css"), "utf8")
  ]);

  return template
    .replaceAll("__TITLE__", escapeHtml(report.title))
    .replaceAll("__THEME_CSS__", themeCss)
    .replaceAll("__EASY_SUMMARY__", escapeHtml(report.summary.easy))
    .replaceAll("__TECHNICAL_SUMMARY__", escapeHtml(report.summary.technical))
    .replaceAll("__GLANCE_SLIDE_TITLE__", escapeHtml(report.glance.slideTitle))
    .replaceAll("__GLANCE_SLIDE_SUBTITLE__", escapeHtml(report.glance.slideSubtitle))
    .replaceAll("__GLANCE_CARDS__", glanceCards)
    .replaceAll("__GLANCE_TABLES__", glanceTables)
    .replaceAll("__MODE__", escapeHtml(report.mode))
    .replaceAll("__ADAPTER__", escapeHtml(report.adapter.name))
    .replaceAll("__CONFIDENCE_LEVEL__", escapeHtml(report.confidence.level))
    .replaceAll("__EASY_SECTION_HTML__", easySectionHtml)
    .replaceAll("__TECHNICAL_SECTION_HTML__", technicalSectionHtml)
    .replaceAll("__CONFIDENCE_ITEMS__", confidenceItems)
    .replaceAll("__ARTIFACT_ITEMS__", artifactItems)
    .replaceAll("__INTERACTIVE_SCRIPT__", renderInteractiveScript({ reportId: report.reportId }));
}

export async function writeReportBundle(reportRoot: string, report: VisualizationReport, previewFiles: RepoFile[] = []): Promise<string[]> {
  const outputDir = path.join(reportRoot, report.reportId);
  await fs.mkdir(outputDir, { recursive: true });
  const filesDir = path.join(outputDir, "files");
  const tasksDir = path.join(outputDir, "tasks");
  await fs.mkdir(filesDir, { recursive: true });
  await fs.mkdir(tasksDir, { recursive: true });

  const linkMap = new Map<string, string>();
  const taskLinkMap = new Map<string, string>();
  const previewArtifacts: string[] = [];
  const taskArtifacts: string[] = [];
  for (const file of previewFiles) {
    const filename = previewFileName(file.path);
    linkMap.set(file.path, `files/${filename}`);
  }
  for (const table of report.glance.tables) {
    table.rows.forEach((row, rowIndex) => {
      const filename = taskPageName(table.title, row[0] ?? "task", rowIndex);
      taskLinkMap.set(taskKey(table.title, row[0] ?? "", rowIndex), `tasks/${filename}`);
    });
  }
  for (const file of previewFiles) {
    const filename = previewFileName(file.path);
    const previewPath = path.join(filesDir, filename);
    const previewHtml = renderFilePreviewPage(report, file, previewFiles, linkMap);
    await fs.writeFile(previewPath, previewHtml, "utf8");
    previewArtifacts.push(previewPath);
  }
  for (const table of report.glance.tables) {
    for (const [rowIndex, row] of table.rows.entries()) {
      const filename = taskPageName(table.title, row[0] ?? "task", rowIndex);
      const taskPath = path.join(tasksDir, filename);
      const taskHtml = renderTaskPage({
        report,
        tableTitle: table.title,
        headers: table.headers,
        row,
        rowIndex,
        fileLinkMap: linkMap,
        previewFiles
      });
      await fs.writeFile(taskPath, taskHtml, "utf8");
      taskArtifacts.push(taskPath);
    }
  }

  const indexPath = path.join(outputDir, "index.html");
  const jsonPath = path.join(outputDir, "report.json");
  await fs.writeFile(indexPath, await renderHtml(report, linkMap, taskLinkMap), "utf8");
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  return [indexPath, jsonPath, ...previewArtifacts, ...taskArtifacts];
}
