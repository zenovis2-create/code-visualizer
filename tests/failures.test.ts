import { describe, expect, test } from "vitest";
import path from "node:path";
import { generateVisualizationReport } from "../src/index.js";

describe("generateVisualizationReport failures", () => {
  test("throws when the repo path does not exist", async () => {
    await expect(
      generateVisualizationReport({
        mode: "project",
        repoPath: path.resolve("tests/fixtures/does-not-exist")
      })
    ).rejects.toThrow(/repo path/i);
  });

  test("falls back when diff mode has no git metadata", async () => {
    const report = await generateVisualizationReport({
      mode: "diff",
      repoPath: path.resolve("tests/fixtures/generic-repo")
    });

    expect(report.confidence.notes.join(" ")).toMatch(/git diff|fallback/i);
  });
});
