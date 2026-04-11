import { describe, expect, test } from "vitest";
import { parseCliArgs } from "../src/cli.js";

describe("parseCliArgs", () => {
  test("parses mode, repo, query, and files", () => {
    const parsed = parseCliArgs([
      "--mode",
      "component",
      "--repo",
      "/tmp/repo",
      "--query",
      "ui",
      "--files",
      "a.ts,b.ts"
    ]);

    expect(parsed).toEqual({
      mode: "component",
      repoPath: "/tmp/repo",
      query: "ui",
      files: ["a.ts", "b.ts"]
    });
  });
});
