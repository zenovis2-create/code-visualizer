import { describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { generateVisualizationReport } from "../src/index.js";

const repoRoot = path.resolve("tests/fixtures/paperclip-mini");
const genericRepoRoot = path.resolve("tests/fixtures/generic-repo");

describe("generateVisualizationReport", () => {
  test("creates a diff report with easy and technical sections", async () => {
    const report = await generateVisualizationReport({
      mode: "diff",
      repoPath: repoRoot,
      files: ["server/src/index.ts", "ui/src/main.tsx"]
    });

    expect(report.mode).toBe("diff");
    expect(report.summary.easy).toMatch(/전에는|이제는|바뀌/);
    expect(report.summary.technical).toMatch(/파일|모듈|영향/);
    expect(report.glance.cards).toHaveLength(3);
    expect(report.glance.tables).toHaveLength(2);
    expect(report.glance.tables[0]?.title).toMatch(/판단표|바로 찾기/);
    expect(report.glance.tables[0]?.headers).toEqual([
      "하고 싶은 일",
      "먼저 볼 곳",
      "대표 파일",
      "수정 난이도",
      "영향도",
      "추천 시작점",
      "왜 여기 보면 되는지"
    ]);
    expect(report.glance.tables[1]?.title).toMatch(/비교표|역할/);
    expect(report.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["체감 변화", "비유로 이해", "기술자용 변경 구조"])
    );
    expect(report.sections.some((section) => section.kind === "diagram")).toBe(true);
    expect(report.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  test("creates a component report scoped to the requested subsystem", async () => {
    const report = await generateVisualizationReport({
      mode: "component",
      repoPath: repoRoot,
      query: "ui"
    });

    expect(report.adapter.id).toBe("paperclip");
    expect(report.glance.slideTitle).toMatch(/한눈|요약|슬라이드/);
    expect(report.glance.tables[0]?.headers).toContain("대표 파일");
    expect(report.glance.tables[0]?.rows.some((row) => row.join(" ").match(/ui\/src\/main\.tsx|직접 일치 파일 없음/))).toBe(true);
    expect(report.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["한눈에 보기", "어떤 때 여기 보면 되나"])
    );
    expect(report.summary.easy).toMatch(/화면|UI|사용자/);
  });

  test("creates a project report with layered maps", async () => {
    const report = await generateVisualizationReport({
      mode: "project",
      repoPath: repoRoot
    });

    const diagram = report.sections.find((section) => section.kind === "diagram");
    expect(diagram?.content).toMatch(/구조|지도|layer/i);
    expect(report.summary.technical).toMatch(/Server|UI|Packages|Skills/i);
    expect(report.glance.cards).toHaveLength(3);
    expect(report.glance.tables).toHaveLength(2);
    expect(report.glance.tables[0]?.rows.some((row) => row.join(" ").match(/UI|화면/))).toBe(true);
    expect(report.glance.tables[1]?.rows.some((row) => row.join(" ").match(/접수창구|운영실|검사팀/))).toBe(true);
    expect(report.sections.map((section) => section.title)).toEqual(
      expect.arrayContaining(["한눈에 보기", "비유로 이해", "어디부터 보면 되나", "기술자용 구조"])
    );

    const htmlPath = path.resolve(report.artifacts.find((artifact) => artifact.endsWith("index.html")) ?? "");
    const html = await fs.readFile(htmlPath, "utf8");
    expect(html).toMatch(/초보자용 빠른 이해/);
    expect(html).toMatch(/기술자용 펼쳐보기/);
    expect(html).toMatch(/한눈 요약 슬라이드/);
    expect(html.match(/<table/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toMatch(/빠른 판단표/);
    expect(html).toMatch(/역할 비교표/);
    expect(html).toMatch(/수정 난이도/);
    expect(html).toMatch(/영향도/);
    expect(html).toMatch(/추천 시작점/);
    expect(html.indexOf('<section class="glance-tables">')).toBeLessThan(html.indexOf('<section class="slide-cards">'));
    expect(html).toMatch(/glance-row tone-ui/);
    expect(html).toMatch(/glance-row tone-server/);
    expect(html).toMatch(/glance-badge/);
    expect(html).toMatch(/severity-badge severity-high/);
    expect(html).toMatch(/severity-badge severity-medium/);
    expect(html).toMatch(/startpoint-chip/);
    expect(html).toMatch(/href="files\//);
    expect(html).toMatch(/href="tasks\//);
    expect(html).toMatch(/task-row-link/);
    expect(html).toMatch(/data-task-href="tasks\//);
    expect(html).toMatch(/file-link/);
    expect(html).toMatch(/핀 보드/);
    expect(html).toMatch(/pin-toggle/);
    expect(html).toMatch(/localStorage/);
    expect(html).toMatch(/작업 진행 요약/);
    expect(html).toMatch(/task-progress-list/);
    expect(html).toMatch(/data-task-state-key=/);
    expect(report.artifacts.some((artifact) => artifact.includes("/files/"))).toBe(true);
    expect(report.artifacts.some((artifact) => artifact.includes("/tasks/"))).toBe(true);

    const previewPath = path.resolve(
      report.artifacts.find((artifact) => artifact.includes("/files/ui-src-main-tsx-")) ?? ""
    );
    const previewHtml = await fs.readFile(previewPath, "utf8");
    expect(previewHtml).toMatch(/이 파일 한 줄 요약/);
    expect(previewHtml).toMatch(/표에서 온 위치/);
    expect(previewHtml).toMatch(/같이 보면 좋은 파일/);
    expect(previewHtml).toMatch(/이 파일 주변 흐름도/);
    expect(previewHtml).toMatch(/preview-flow/);
    expect(previewHtml).toMatch(/preview-flow-link/);
    expect(previewHtml).toMatch(/href="\.\.\/files\/.*\.html"/);
    expect(previewHtml).toMatch(/화면을 바꾸고 싶다/);
    expect(previewHtml).toMatch(/ui\/src\/main\.tsx/);
    expect(previewHtml).toMatch(/pin-toggle/);

    const taskPath = path.resolve(
      report.artifacts.find((artifact) => artifact.includes("/tasks/")) ?? ""
    );
    const taskHtml = await fs.readFile(taskPath, "utf8");
    expect(taskHtml).toMatch(/이 작업 한 줄 설명/);
    expect(taskHtml).toMatch(/먼저 볼 파일/);
    expect(taskHtml).toMatch(/추천 시작점/);
    expect(taskHtml).toMatch(/관련 파일 프리뷰/);
    expect(taskHtml).toMatch(/우선순위 체크리스트/);
    expect(taskHtml).toMatch(/작업 흐름도/);
    expect(taskHtml).toMatch(/task-flow/);
    expect(taskHtml).toMatch(/1\./);
    expect(taskHtml).toMatch(/checklist-action-link/);
    expect(taskHtml).toMatch(/href="\.\.\/files\/.*\.html"/);
    expect(taskHtml).toMatch(/task-flow-link/);
    expect(taskHtml).toMatch(/type="checkbox"/);
    expect(taskHtml).toMatch(/data-check-id=/);
    expect(taskHtml).toMatch(/task-progress/);
    expect(taskHtml).toMatch(/pin-toggle/);
    expect(taskHtml).toMatch(/localStorage/);
    expect(taskHtml).toMatch(/메인 시각화로 돌아가기/);
  });

  test("creates an app report with entrypoints and flow", async () => {
    const report = await generateVisualizationReport({
      mode: "app",
      repoPath: genericRepoRoot
    });

    expect(report.adapter.id).toBe("generic");
    expect(report.summary.easy).toMatch(/프로그램|사용자|흐름/);
    expect(report.summary.technical).toMatch(/진입|런타임|모듈|entry/i);
    expect(report.glance.tables[0]?.rows.some((row) => row.join(" ").match(/시작|진입/))).toBe(true);
  });

  test("returns a confidence warning for an unmatched component query", async () => {
    const report = await generateVisualizationReport({
      mode: "component",
      repoPath: repoRoot,
      query: "payments"
    });

    expect(report.confidence.level).toBe("low");
    expect(report.confidence.notes.join(" ")).toMatch(/match|query|fallback/i);
  });
});
