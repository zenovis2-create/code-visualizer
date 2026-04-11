export type VisualizationMode = "diff" | "component" | "project" | "app";

export interface VisualizationRequest {
  mode: VisualizationMode;
  repoPath: string;
  query?: string;
  files?: string[];
  adapter?: string;
}

export interface AdapterHint {
  id: string;
  name: string;
  zones: ModuleGroup[];
  entrypoints: Entrypoint[];
  componentAliases: Record<string, string[]>;
}

export interface ModuleGroup {
  id: string;
  label: string;
  description: string;
  paths: string[];
}

export interface Entrypoint {
  label: string;
  path: string;
  role: string;
}

export interface RepoFile {
  path: string;
  content: string;
}

export interface GitDiffSummary {
  available: boolean;
  files: string[];
  notes: string[];
}

export interface CollectedContext {
  request: VisualizationRequest;
  repoName: string;
  repoPath: string;
  packageScripts: string[];
  tree: string[];
  selectedFiles: RepoFile[];
  diff: GitDiffSummary;
  adapterHint: AdapterHint;
  topLevelDirectories: string[];
  limits: string[];
}

export interface VisualizationSummary {
  easy: string;
  technical: string;
}

export interface GlanceCard {
  label: string;
  value: string;
}

export interface GlanceTable {
  title: string;
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface VisualizationGlance {
  slideTitle: string;
  slideSubtitle: string;
  cards: GlanceCard[];
  tables: GlanceTable[];
}

export type SectionKind = "text" | "diagram" | "list";

export interface VisualizationSection {
  title: string;
  kind: SectionKind;
  content: string;
  audience?: "easy" | "technical";
}

export interface Confidence {
  level: "high" | "medium" | "low";
  notes: string[];
}

export interface VisualizationReport {
  reportId: string;
  mode: VisualizationMode;
  title: string;
  summary: VisualizationSummary;
  glance: VisualizationGlance;
  sections: VisualizationSection[];
  artifacts: string[];
  url: string;
  confidence: Confidence;
  adapter: {
    id: string;
    name: string;
  };
}

export interface Adapter {
  id: string;
  name: string;
  detect(repoPath: string, tree: string[]): Promise<boolean> | boolean;
  collectHints(context: {
    repoPath: string;
    tree: string[];
    packageScripts: string[];
  }): AdapterHint;
  groupModules(context: CollectedContext): ModuleGroup[];
  findEntrypoints(context: CollectedContext): Entrypoint[];
}
