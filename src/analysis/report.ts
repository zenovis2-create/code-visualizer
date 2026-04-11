import type {
  Adapter,
  CollectedContext,
  Confidence,
  Entrypoint,
  ModuleGroup,
  VisualizationGlance,
  VisualizationReport,
  VisualizationRequest,
  VisualizationSection
} from "../types.js";
import { slugify, unique } from "../utils.js";

interface AnalysisResult {
  title: string;
  summary: VisualizationReport["summary"];
  glance: VisualizationGlance;
  sections: VisualizationSection[];
  confidence: Confidence;
}

function section(title: string, kind: VisualizationSection["kind"], content: string, audience: "easy" | "technical"): VisualizationSection {
  return { title, kind, content, audience };
}

function glanceTable(title: string, caption: string, headers: string[], rows: string[][]): VisualizationGlance["tables"][number] {
  return {
    title,
    caption,
    headers,
    rows
  };
}

function glance(slideTitle: string, slideSubtitle: string, cards: VisualizationGlance["cards"], tables: VisualizationGlance["tables"]): VisualizationGlance {
  return {
    slideTitle,
    slideSubtitle,
    cards,
    tables
  };
}

function koreanGroupLabel(label: string): string {
  const lookup: Record<string, string> = {
    Server: "서버/API",
    UI: "화면/UI",
    Packages: "공용 부품",
    Skills: "에이전트 규칙",
    Docs: "문서/설계",
    CLI: "터미널 명령",
    Tests: "검증",
    Source: "핵심 코드",
    App: "실행 계층"
  };
  return lookup[label] ?? label;
}

function koreanGroupList(groups: ModuleGroup[]): string[] {
  return groups.filter((group) => group.paths.length > 0).map((group) => `${koreanGroupLabel(group.label)}(${group.label})`);
}

function plainMetaphorForProject(groups: ModuleGroup[]): string {
  const labels = groups.map((group) => group.label);
  if (labels.includes("Server") || labels.includes("UI")) {
    return "이 프로젝트는 하나의 회사처럼 보면 쉽습니다. UI는 접수창구, Server는 운영실, Packages는 공용 규칙집, Skills는 상담 매뉴얼, Docs는 사내 문서, Tests는 검사팀에 가깝습니다.";
  }
  return "이 프로젝트는 하나의 가게처럼 볼 수 있습니다. Source는 실제 일하는 공간이고, Docs는 메뉴판, Tests는 점검표 역할을 합니다.";
}

function metaphorForGroup(label: string): string {
  const lookup: Record<string, string> = {
    Server: "운영실",
    UI: "접수창구",
    Packages: "공용 규칙집",
    Skills: "상담 매뉴얼",
    Docs: "사내 문서",
    CLI: "관리자 콘솔",
    Tests: "검사팀",
    Source: "핵심 작업장",
    App: "실행 무대"
  };
  return lookup[label] ?? label;
}

function quickGuideForGroups(groups: ModuleGroup[]): string[] {
  const lines: string[] = [];
  for (const group of groups) {
    if (group.label === "UI") lines.push("화면이나 버튼, 사용자 경험을 바꾸려면 UI부터 보면 됩니다.");
    if (group.label === "Server") lines.push("동작 규칙, API, 백엔드 흐름을 바꾸려면 Server를 보면 됩니다.");
    if (group.label === "Packages") lines.push("여러 곳에서 같이 쓰는 공통 로직은 Packages를 보면 됩니다.");
    if (group.label === "Skills") lines.push("에이전트 답변 방식이나 운영 규칙은 Skills를 보면 됩니다.");
    if (group.label === "Docs") lines.push("왜 이렇게 설계됐는지 배경을 알고 싶으면 Docs를 보면 됩니다.");
    if (group.label === "CLI") lines.push("터미널 명령이나 실행 진입점을 바꾸려면 CLI를 보면 됩니다.");
    if (group.label === "Tests") lines.push("안전하게 고치려면 마지막에 Tests를 같이 보면 됩니다.");
    if (group.label === "Source") lines.push("핵심 코드 흐름은 Source부터 읽으면 됩니다.");
  }
  return lines.slice(0, 5);
}

function pickStartingFiles(context: CollectedContext): string[] {
  const preferredPatterns = [/server\/src\/index\.(ts|js)$/, /ui\/src\/main\.(tsx|ts|js)$/, /cli\/src\/index\.(ts|js)$/, /packages\/shared\/src\/index\.(ts|js)$/, /^README\.md$/, /^package\.json$/];
  const fromSelected = context.selectedFiles.map((file) => file.path);
  const fromTree = context.tree;
  const picked: string[] = [];
  for (const pattern of preferredPatterns) {
    const match = [...fromSelected, ...fromTree].find((item) => pattern.test(item));
    if (match && !picked.includes(match)) {
      picked.push(match);
    }
  }
  return picked.slice(0, 4);
}

function firstMatchingFile(files: string[], includesText: string, fallback: string): string {
  return files.find((file) => file.includes(includesText)) ?? fallback;
}

function stageBadge(title: string, subtitle: string, x: number, y: number, fill: string): string {
  return `<rect x="${x}" y="${y}" rx="20" ry="20" width="250" height="88" fill="${fill}" stroke="#cbd5e1" stroke-width="2" />
<text x="${x + 20}" y="${y + 32}" font-family="ui-sans-serif, system-ui" font-size="18" font-weight="700" fill="#0f172a">${title}</text>
<text x="${x + 20}" y="${y + 58}" font-family="ui-sans-serif, system-ui" font-size="14" fill="#334155">${subtitle}</text>`;
}

function layeredDiagramSvg(title: string, layers: { title: string; subtitle: string; fill: string }[], footer: string): string {
  const width = 920;
  const blocks = layers
    .map((layer, index) => stageBadge(layer.title, layer.subtitle, 48, 86 + index * 108, layer.fill))
    .join("\n");
  const arrows = layers
    .slice(0, -1)
    .map((_, index) => {
      const y = 174 + index * 108;
      return `<line x1="173" y1="${y}" x2="173" y2="${y + 40}" stroke="#475569" stroke-width="3" marker-end="url(#down-arrow)" />`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${width} 460" width="100%" role="img" aria-label="${title}">
  <defs>
    <marker id="down-arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"></path>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="460" fill="#ffffff"></rect>
  <text x="48" y="40" font-family="ui-sans-serif, system-ui" font-size="24" font-weight="700" fill="#0f172a">${title}</text>
  <text x="48" y="66" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">${footer}</text>
  ${blocks}
  ${arrows}
</svg>`;
}

function diagramSvg(title: string, nodes: string[], subtitle: string): string {
  const width = 940;
  const boxWidth = 200;
  const boxHeight = 64;
  const gap = 28;
  const totalWidth = nodes.length * boxWidth + Math.max(0, nodes.length - 1) * gap;
  const offsetX = Math.max(20, Math.floor((width - totalWidth) / 2));

  const rectangles = nodes
    .map((node, index) => {
      const x = offsetX + index * (boxWidth + gap);
      const y = 88;
      const arrow = index < nodes.length - 1 ? `<line x1="${x + boxWidth}" y1="${y + 32}" x2="${x + boxWidth + gap}" y2="${y + 32}" stroke="#475569" stroke-width="2" marker-end="url(#arrow)" />` : "";
      return `${arrow}<rect x="${x}" y="${y}" rx="16" ry="16" width="${boxWidth}" height="${boxHeight}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="2" />
<text x="${x + 20}" y="${y + 28}" font-family="ui-sans-serif, system-ui" font-size="16" fill="#0f172a">${node}</text>`;
    })
    .join("\n");

  return `<svg viewBox="0 0 ${width} 220" width="100%" role="img" aria-label="${title}">
  <defs>
    <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"></path>
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="220" fill="#ffffff"></rect>
  <text x="20" y="34" font-family="ui-sans-serif, system-ui" font-size="22" font-weight="700" fill="#0f172a">${title}</text>
  <text x="20" y="58" font-family="ui-sans-serif, system-ui" font-size="14" fill="#475569">${subtitle}</text>
  ${rectangles}
</svg>`;
}

function groupLabels(groups: ModuleGroup[]): string[] {
  return groups.filter((group) => group.paths.length > 0).map((group) => group.label);
}

function fileBullets(context: CollectedContext): string {
  return context.selectedFiles.length > 0
    ? context.selectedFiles.map((file) => `- ${file.path}`).join("\n")
    : "- 직접 집어 설명할 파일이 없어 구조 지도 중심으로 보여줍니다.";
}

function determineComponentGroups(context: CollectedContext, groups: ModuleGroup[]): ModuleGroup[] {
  const query = context.request.query?.toLowerCase();
  if (!query) {
    return groups.slice(0, 2);
  }

  const aliases = context.adapterHint.componentAliases;
  const matchedGroupIds = Object.entries(aliases)
    .filter(([, aliasList]) => aliasList.some((alias) => query.includes(alias)))
    .map(([groupId]) => groupId);

  const byAlias = groups.filter((group) => matchedGroupIds.includes(group.id));
  if (byAlias.length > 0) {
    return byAlias;
  }

  const byPath = groups.filter((group) => group.paths.some((groupPath) => context.selectedFiles.some((file) => file.path.startsWith(`${groupPath}/`) || file.path === groupPath)));
  return byPath;
}

function entryFlow(entrypoints: Entrypoint[], groups: ModuleGroup[]): string[] {
  const nodes = unique([
    ...entrypoints.map((entrypoint) => entrypoint.label),
    ...groupLabels(groups).slice(0, 3)
  ]);
  return nodes.length > 0 ? nodes : ["Input", "Core Logic", "Output"];
}

function analyzeDiff(context: CollectedContext, groups: ModuleGroup[]): AnalysisResult {
  const touchedFiles = context.selectedFiles.map((file) => file.path);
  const impactedGroups = groups.filter((group) => group.paths.some((groupPath) => touchedFiles.some((file) => file.startsWith(`${groupPath}/`) || file === groupPath)));
  const groupLabelsList = impactedGroups.length > 0 ? koreanGroupList(impactedGroups).join(", ") : "여러 군데에 퍼진 공통 부품";
  const notes = [...context.diff.notes, ...context.limits];
  const firstTouched = touchedFiles[0] ?? "대표 파일";
  const secondTouched = touchedFiles[1] ?? firstTouched;

  return {
    title: `${context.repoName}: recent change view`,
    summary: {
      easy: `전에는 바뀐 내용이 ${groupLabelsList} 안에 흩어져 보였고, 이제는 ${touchedFiles.length || 1}개 파일 기준으로 변화 지점이 더 또렷하게 보입니다.`,
      technical: `변경 파일: ${touchedFiles.join(", ") || "대표 파일 기준"}. 영향 범위: ${groupLabelsList}. 이 요약은 ${context.diff.available ? "git diff" : "fallback"} 기준으로 만들었습니다.`
    },
    glance: glance(
      "한눈 요약 슬라이드",
      "변경의 체감 차이, 바로 볼 위치, 영향 범위를 첫 화면에서 잡는 카드형 요약입니다.",
      [
        { label: "전에는", value: "변경 이유가 여러 코드 조각에 흩어져 보임" },
        { label: "이제는", value: `${touchedFiles.length || 1}개 파일 중심으로 변화 지점이 또렷함` },
        { label: "영향 범위", value: groupLabelsList }
      ],
      [
        glanceTable(
          "빠른 판단표",
          "변경을 이해하려면 무엇부터 보면 되는지 바로 정하는 표입니다.",
          ["하고 싶은 일", "먼저 볼 곳", "대표 파일", "수정 난이도", "영향도", "추천 시작점", "왜 여기 보면 되는지"],
          [
            ["무엇이 바뀌었는지 파악", impactedGroups[0] ? koreanGroupLabel(impactedGroups[0].label) : "변경 파일", firstTouched, "낮음", "중간", firstTouched, "가장 먼저 바뀐 자리를 보면 전체 방향이 잡힙니다."],
            ["영향 범위 확인", groupLabelsList, touchedFiles.slice(0, 2).join(", ") || firstTouched, "중간", "높음", `${firstTouched}, ${secondTouched}`, "파급되는 구역을 빠르게 좁힐 수 있습니다."],
            ["읽는 순서 결정", "체감 변화", firstTouched, "낮음", "중간", `${firstTouched}, ${secondTouched}`, "초보자 설명부터 읽고 기술 구조로 내려가면 됩니다."]
          ]
        ),
        glanceTable(
          "역할 비교표",
          "변경 전/후를 코드가 아니라 체감 기준으로 비교하는 표입니다.",
          ["구분", "전에는", "이제는", "의미"],
          [
            ["변화 읽기", "흩어진 단서 추론", `${touchedFiles.length || 1}개 파일 중심`, "변경 이유를 더 빨리 잡습니다."],
            ["영향 보기", "어디까지 퍼지는지 불명확", groupLabelsList, "확인할 범위를 줄여 줍니다."],
            ["초보자 이해", "코드 세부부터 봐야 함", "비유와 그림부터 봐도 됨", "첫 진입 장벽이 낮아집니다."]
          ]
        )
      ]
    ),
    sections: [
      section("체감 변화", "text", `전에는 변경 이유를 코드 여러 군데를 오가며 추론해야 했습니다.\n이제는 ${groupLabelsList} 쪽에서 무엇이 바뀌었는지 바로 좁혀 볼 수 있습니다.`, "easy"),
      section("비유로 이해", "text", `집 전체를 뜯어고친 게 아니라, ${groupLabelsList} 사이 전달선을 정리한 것에 가깝습니다. 사용자는 같은 기능을 보더라도 내부에서는 더 분명한 흐름을 갖게 됩니다.`, "easy"),
      section(
        "한 장 그림",
        "diagram",
        layeredDiagramSvg(
          "변화가 보이는 순서",
          [
            { title: "전에는", subtitle: "여러 코드 조각을 이어서 의도를 추정", fill: "#e2e8f0" },
            { title: "바뀐 핵심", subtitle: `${groupLabelsList} 쪽 파일 ${touchedFiles.length || 1}개`, fill: "#ccfbf1" },
            { title: "이제는", subtitle: "변경 이유와 영향 범위를 더 빨리 읽을 수 있음", fill: "#dbeafe" }
          ],
          "코드를 처음 보는 사람이 변경 이유를 읽는 흐름"
        ),
        "easy"
      ),
      section("기술자용 변경 구조", "list", fileBullets(context), "technical"),
      section("기술자용 참고", "list", notes.length > 0 ? notes.map((note) => `- ${note}`).join("\n") : "- git 정보와 파일 선택 신호가 충분했습니다.", "technical")
    ],
    confidence: {
      level: context.diff.available ? "high" : "medium",
      notes: notes.length > 0 ? notes : ["git diff를 기준으로 변경 파일과 영향 범위를 연결했습니다."]
    }
  };
}

function analyzeComponent(context: CollectedContext, groups: ModuleGroup[]): AnalysisResult {
  const componentGroups = determineComponentGroups(context, groups);
  const matched = componentGroups.length > 0;
  const focusGroups = matched ? componentGroups : groups.slice(0, 2);
  const focusLabel = matched
    ? focusGroups.map((group) => group.label).join(", ")
    : context.request.query ?? "requested component";
  const confidence: Confidence = matched
    ? {
        level: "high",
        notes: [`질문한 범위를 ${focusLabel} 쪽으로 매칭했습니다.`]
      }
    : {
        level: "low",
        notes: [`질문 "${context.request.query ?? ""}"이 알려진 서브시스템과 딱 맞지 않아, 가장 가까운 그룹으로 fallback했습니다.`]
      };
  const firstSelected = context.selectedFiles[0]?.path ?? "직접 일치 파일 없음";
  const secondSelected = context.selectedFiles[1]?.path ?? firstSelected;

  return {
    title: `${context.repoName}: component focus`,
    summary: {
      easy: `${focusLabel}는 이 프로젝트에서 사용자가 직접 보거나, 그 바로 뒤에서 움직이는 부분입니다. 그래서 이 영역만 봐도 전체 흐름의 큰 줄기를 이해할 수 있습니다.`,
      technical: `대상 범위: ${focusLabel}. 선택된 파일: ${context.selectedFiles.map((file) => file.path).join(", ") || "직접 일치 파일 없음"}. 묶인 그룹: ${focusGroups.map((group) => koreanGroupLabel(group.label)).join(", ")}.`
    },
    glance: glance(
      "한눈 요약 슬라이드",
      "질문한 부분만 떼어 보여주는 소형 PPT 첫 장입니다.",
      [
        { label: "지금 보는 곳", value: focusLabel },
        { label: "가장 가까운 그룹", value: focusGroups.map((group) => koreanGroupLabel(group.label)).join(", ") || "가까운 그룹 fallback" },
        { label: "이럴 때 보면 됨", value: `${focusLabel} 관련 화면/동작을 빠르게 파악할 때` }
      ],
      [
        glanceTable(
          "빠른 판단표",
          "질문한 부분을 이해하려면 어디를 먼저 열어야 하는지 정하는 표입니다.",
          ["하고 싶은 일", "먼저 볼 곳", "대표 파일", "수정 난이도", "영향도", "추천 시작점", "왜 여기 보면 되는지"],
          [
            ["정체 파악", focusLabel, firstSelected, "낮음", "중간", firstSelected, "질문한 범위의 중심을 먼저 고정합니다."],
            ["주변 연결 보기", focusGroups.map((group) => koreanGroupLabel(group.label)).join(", ") || "fallback 그룹", context.selectedFiles.slice(0, 2).map((file) => file.path).join(", ") || firstSelected, "중간", "중간", `${firstSelected}, ${secondSelected}`, "연결부를 보면 이 부분의 역할이 보입니다."],
            ["코드 진입", "기술자용 세부 경로", firstSelected, "중간", "낮음", firstSelected, "바로 첫 파일을 열 수 있습니다."]
          ]
        ),
        glanceTable(
          "역할 비교표",
          "질문한 부분이 프로젝트 안에서 어떤 역할인지 비교하는 표입니다.",
          ["비교 대상", "이 부분", "주변", "설명"],
          [
            ["사용자 체감", `${focusLabel} 관련 화면/동작`, "연결된 지원 구역", "사용자가 느끼는 부분과 뒤에서 받치는 부분을 나눕니다."],
            ["코드 읽기", context.selectedFiles[0]?.path ?? "직접 일치 파일 없음", context.selectedFiles[1]?.path ?? "추가 파일 없음", "읽기 시작점을 좁혀 줍니다."],
            ["역할 비유", focusLabel, focusGroups.map((group) => metaphorForGroup(group.label)).join(", ") || "주변 그룹", "사람 기준 역할로 바꿔 이해합니다."]
          ]
        )
      ]
    ),
    sections: [
      section("한눈에 보기", "text", focusGroups.map((group) => `${koreanGroupLabel(group.label)}: ${group.description}`).join("\n"), "easy"),
      section(
        "어떤 때 여기 보면 되나",
        "list",
        [
          `- ${focusLabel} 관련 화면이나 경험을 바꾸고 싶을 때`,
          `- ${focusLabel} 주변 동작이 어디와 연결되는지 보고 싶을 때`,
          `- 전체 코드가 아니라 이 부분만 빠르게 파악하고 싶을 때`
        ].join("\n"),
        "easy"
      ),
      section(
        "주변 연결 그림",
        "diagram",
        layeredDiagramSvg(
          `${focusLabel} 중심 지도`,
          [
            { title: "입력/시작점", subtitle: context.adapterHint.entrypoints.map((entrypoint) => entrypoint.label).join(", ") || "직접 시작점 없음", fill: "#dbeafe" },
            { title: focusLabel, subtitle: focusGroups.map((group) => koreanGroupLabel(group.label)).join(", "), fill: "#ccfbf1" },
            { title: "영향/주변", subtitle: "이 부분이 바뀌면 연결된 흐름도 함께 확인", fill: "#fef3c7" }
          ],
          "질문한 부분을 중심으로 본 쉬운 연결도"
        ),
        "easy"
      ),
      section("기술자용 세부 경로", "list", fileBullets(context), "technical"),
      section("기술자용 참고", "list", confidence.notes.map((note) => `- ${note}`).join("\n"), "technical")
    ],
    confidence
  };
}

function analyzeProject(context: CollectedContext, groups: ModuleGroup[]): AnalysisResult {
  const usedGroups = groups.filter((group) => group.paths.length > 0);
  const labels = usedGroups.map((group) => group.label);
  const quickGuide = quickGuideForGroups(usedGroups);
  const startingFiles = pickStartingFiles(context);
  const uiStart = firstMatchingFile(startingFiles, "ui/", "ui/src/main.tsx");
  const serverStart = firstMatchingFile(startingFiles, "server/", "server/src/index.ts");
  const packagesStart = firstMatchingFile(startingFiles, "packages/", "packages/shared/src/index.ts");
  const docsStart = firstMatchingFile(startingFiles, "README", "README.md");
  const cliStart = firstMatchingFile(startingFiles, "cli/", "cli/src/index.ts");
  return {
    title: `${context.repoName}: layered project map`,
    summary: {
      easy: `이 프로젝트는 한 덩어리로 읽기보다, ${koreanGroupList(usedGroups).join(", ")}처럼 역할별 구역으로 나눠 보면 훨씬 빨리 이해됩니다.`,
      technical: `역할 그룹: ${labels.join(", ")}. 최상위 디렉터리: ${context.topLevelDirectories.join(", ")}. Adapter: ${context.adapterHint.name}.`
    },
    glance: glance(
      "한눈 요약 슬라이드",
      "리포 전체를 읽기 전에, 역할 구역과 시작 위치를 카드와 표로 먼저 잡습니다.",
      [
        { label: "겉에서 보이는 층", value: usedGroups.filter((group) => ["UI", "CLI"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음" },
        { label: "중간 처리 층", value: usedGroups.filter((group) => ["Server", "Skills"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음" },
        { label: "바닥 지원 층", value: usedGroups.filter((group) => ["Packages", "Docs", "Tests"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음" }
      ],
      [
        glanceTable(
          "빠른 판단표",
          "무엇을 바꾸고 싶은지에 따라 어디를 먼저 열지 결정하는 표입니다.",
          ["하고 싶은 일", "먼저 볼 곳", "대표 파일", "수정 난이도", "영향도", "추천 시작점", "왜 여기 보면 되는지"],
          [
            ["화면을 바꾸고 싶다", "UI", uiStart, "중간", "중간", uiStart, "사용자가 직접 보는 부분이기 때문입니다."],
            ["동작 규칙을 바꾸고 싶다", "Server", serverStart, "높음", "높음", serverStart, "실제 처리 규칙과 API 흐름이 모여 있습니다."],
            ["공통 로직을 알고 싶다", "Packages", packagesStart, "중간", "높음", packagesStart, "여러 곳에서 재사용하는 규칙이 들어 있습니다."],
            ["왜 이렇게 만들었는지 알고 싶다", "Docs", docsStart, "낮음", "중간", docsStart, "배경 설명과 설계 의도가 문서화돼 있습니다."],
            ["코드 첫 진입점이 궁금하다", "CLI / Server", `${cliStart}, ${docsStart}`, "낮음", "중간", `${cliStart}, ${docsStart}`, "처음 파일을 열 때 길을 잃지 않게 해줍니다."]
          ]
        ),
        glanceTable(
          "역할 비교표",
          "각 구역을 사람 기준 역할로 번역해 바로 비교하는 표입니다.",
          ["구역", "사람 기준 비유", "대표 폴더", "언제 보면 되나"],
          usedGroups.map((group) => [
            koreanGroupLabel(group.label),
            metaphorForGroup(group.label),
            group.paths[0] ?? group.label,
            quickGuideForGroups([group])[0]?.replace(/\.$/, "") ?? "이 역할이 궁금할 때"
          ])
        )
      ]
    ),
    sections: [
      section("한눈에 보기", "text", `${context.repoName}은 크게 ${koreanGroupList(usedGroups).join(", ")} 구역으로 나뉩니다. 처음엔 모든 파일을 읽지 말고, 내가 알고 싶은 목적에 맞는 구역 하나만 잡는 게 맞습니다.`, "easy"),
      section("비유로 이해", "text", plainMetaphorForProject(usedGroups), "easy"),
      section("어디부터 보면 되나", "list", quickGuide.map((line) => `- ${line}`).join("\n"), "easy"),
      section(
        "한 장 구조 지도",
        "diagram",
        layeredDiagramSvg(
          "초보자용 구조 지도",
          [
            { title: "겉에서 보이는 곳", subtitle: usedGroups.filter((group) => ["UI", "CLI"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음", fill: "#dbeafe" },
            { title: "중간에서 연결하는 곳", subtitle: usedGroups.filter((group) => ["Server", "Skills"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음", fill: "#ccfbf1" },
            { title: "밑에서 받쳐주는 곳", subtitle: usedGroups.filter((group) => ["Packages", "Docs", "Tests"].includes(group.label)).map((group) => koreanGroupLabel(group.label)).join(", ") || "없음", fill: "#fef3c7" }
          ],
          "복잡한 파일 나열 대신 역할별로 본 쉬운 지도"
        ),
        "easy"
      ),
      section("기술자용 구조", "list", usedGroups.map((group) => `- ${group.label}: ${group.paths.join(", ") || "no matching paths"}`).join("\n"), "technical"),
      section("기술자용 시작 파일", "list", startingFiles.map((file) => `- ${file}`).join("\n") || fileBullets(context), "technical"),
      section(
        "기술자용 참고",
        "list",
        [...context.limits, "큰 리포는 한 장의 촘촘한 그래프 대신, 역할 구역별 요약으로 나눠 보여줍니다."]
          .map((note) => `- ${note}`)
          .join("\n"),
        "technical"
      )
    ],
    confidence: {
      level: context.adapterHint.id === "paperclip" ? "high" : "medium",
      notes: context.adapterHint.id === "paperclip" ? ["paperclip 전용 구역 규칙을 적용했습니다."] : ["전용 어댑터가 없어 generic 그룹 규칙으로 묶었습니다."]
    }
  };
}

function analyzeApp(context: CollectedContext, groups: ModuleGroup[]): AnalysisResult {
  const entrypoints = context.adapterHint.entrypoints;
  const nodes = entryFlow(entrypoints, groups);
  const firstEntry = entrypoints[0]?.path ?? "package scripts";
  const firstSelected = context.selectedFiles[0]?.path ?? firstEntry;
  const secondSelected = context.selectedFiles[1]?.path ?? firstSelected;
  return {
    title: `${context.repoName}: app runtime story`,
    summary: {
      easy: `이 리포트는 프로그램을 코드 덩어리가 아니라 사용자 기준 흐름으로 설명합니다. 어디서 시작해 어떤 계층을 거쳐 결과가 나오는지 한 줄로 따라가면 됩니다.`,
      technical: `진입점: ${entrypoints.map((entrypoint) => `${entrypoint.path} (${entrypoint.role})`).join(", ") || "none inferred"}. 핵심 그룹: ${groups.map((group) => group.label).join(", ")}.`
    },
    glance: glance(
      "한눈 요약 슬라이드",
      "프로그램이 어디서 시작하고 어디를 거쳐 결과를 내는지 PPT 첫 장처럼 보여줍니다.",
      [
        { label: "시작점", value: entrypoints.map((entrypoint) => entrypoint.label).join(", ") || "스크립트 시작" },
        { label: "중간 처리", value: groups.slice(0, 2).map((group) => koreanGroupLabel(group.label)).join(", ") || "핵심 처리 계층" },
        { label: "결과", value: "사용자에게 보이거나 다음 단계로 전달" }
      ],
      [
        glanceTable(
          "빠른 판단표",
          "프로그램 흐름을 이해할 때 어느 단계부터 볼지 정하는 표입니다.",
          ["하고 싶은 일", "먼저 볼 곳", "대표 파일", "수정 난이도", "영향도", "추천 시작점", "왜 여기 보면 되는지"],
          [
            ["프로그램 시작점 찾기", "시작", firstEntry, "낮음", "중간", firstEntry, "진입점을 잡아야 전체 흐름이 보입니다."],
            ["중간 처리 이해", groups.slice(0, 2).map((group) => koreanGroupLabel(group.label)).join(", ") || "핵심 처리 계층", firstSelected, "중간", "높음", `${firstEntry}, ${firstSelected}`, "실제 동작이 여기서 만들어집니다."],
            ["결과 확인", "UI/출력 단계", secondSelected, "낮음", "중간", secondSelected, "사용자 체감 결과를 보는 위치입니다."]
          ]
        ),
        glanceTable(
          "역할 비교표",
          "시작-처리-결과 단계를 한 줄에서 비교하는 표입니다.",
          ["단계", "사람 기준 설명", "코드 기준 위치", "메모"],
          [
            ["시작", "버튼을 누르거나 명령을 실행하는 순간", entrypoints.map((entrypoint) => entrypoint.path).join(", ") || "package scripts", "여기서 프로그램이 출발합니다."],
            ["처리", "안쪽 운영실이 계산하는 단계", groups.slice(0, 2).map((group) => koreanGroupLabel(group.label)).join(", ") || "핵심 처리 계층", "중간 계산과 규칙 적용이 일어납니다."],
            ["결과", "사용자에게 보이거나 다음 단계로 전달", "UI/출력 단계", "눈에 보이는 결과를 확인하는 구간입니다."]
          ]
        )
      ]
    ),
    sections: [
      section("사용자 기준 이야기", "text", `프로그램은 ${entrypoints.map((entrypoint) => entrypoint.path).join(", ") || "실행 스크립트"}에서 시작해서 ${nodes.join(" -> ")} 흐름으로 읽으면 됩니다.`, "easy"),
      section("비유로 이해", "text", "손님이 창구에서 요청하고, 안쪽 운영실이 처리한 뒤, 공용 규칙을 참고해 결과를 돌려주는 흐름으로 보면 됩니다.", "easy"),
      section(
        "한 장 흐름도",
        "diagram",
        layeredDiagramSvg(
          "프로그램이 움직이는 순서",
          [
            { title: "시작", subtitle: entrypoints.map((entrypoint) => entrypoint.label).join(", ") || "스크립트에서 시작", fill: "#dbeafe" },
            { title: "처리", subtitle: groups.slice(0, 2).map((group) => koreanGroupLabel(group.label)).join(", ") || "핵심 처리 계층", fill: "#ccfbf1" },
            { title: "결과", subtitle: "사용자에게 보이거나 다음 단계로 전달", fill: "#fef3c7" }
          ],
          "사람 기준으로 읽는 런타임 이야기"
        ),
        "easy"
      ),
      section(
        "기술자용 구조",
        "list",
        entrypoints.length > 0
          ? entrypoints.map((entrypoint) => `- ${entrypoint.path}: ${entrypoint.role}`).join("\n")
          : "- 뚜렷한 진입점 파일이 없어 package scripts 기준으로 추론했습니다.",
        "technical"
      ),
      section("기술자용 참고", "list", context.limits.length > 0 ? context.limits.map((note) => `- ${note}`).join("\n") : "- 진입점과 모듈 힌트가 충분해 안정적으로 흐름을 추론했습니다.", "technical")
    ],
    confidence: {
      level: entrypoints.length > 0 ? "medium" : "low",
      notes: entrypoints.length > 0 ? ["파일 구조와 package scripts를 기준으로 런타임 흐름을 추론했습니다."] : ["뚜렷한 진입점 파일이 없어 스크립트와 파일 이름으로 런타임 흐름을 추론했습니다."]
    }
  };
}

export function analyzeContext(context: CollectedContext, adapter: Adapter, request: VisualizationRequest): Omit<VisualizationReport, "artifacts" | "url" | "reportId"> {
  const grouped = adapter.groupModules(context);
  const withEntrypoints: CollectedContext = {
    ...context,
    adapterHint: {
      ...context.adapterHint,
      entrypoints: adapter.findEntrypoints(context)
    }
  };
  const analysis =
    request.mode === "diff"
      ? analyzeDiff(withEntrypoints, grouped)
      : request.mode === "component"
        ? analyzeComponent(withEntrypoints, grouped)
        : request.mode === "project"
          ? analyzeProject(withEntrypoints, grouped)
          : analyzeApp(withEntrypoints, grouped);

  return {
    mode: request.mode,
    title: analysis.title,
    summary: analysis.summary,
    glance: analysis.glance,
    sections: analysis.sections,
    confidence: analysis.confidence,
    adapter: {
      id: adapter.id,
      name: adapter.name
    }
  };
}

export function createReportId(title: string): string {
  return `${Date.now()}-${slugify(title)}`;
}
