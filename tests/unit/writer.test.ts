import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ObsidianWriter, sanitizeFileName } from "../../src/obsidian/writer.js";

describe("sanitizeFileName", () => {
  it("removes invalid filename characters", () => {
    expect(sanitizeFileName('bad:/\\name*?"<>|')).toBe("bad name");
  });
});

describe("ObsidianWriter", () => {
  it("writes markdown with frontmatter to vault subdirectory", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obfronter-test-"));
    const writer = new ObsidianWriter();

    const first = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "My Test Note",
        markdownBody: "Hello markdown",
        byline: "By Test"
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    expect(first.fileName).toBe("2026-01-01-My Test Note.md");

    const fileContent = await readFile(first.outputPath, "utf8");
    expect(fileContent).toContain("source_platform: generic");
    expect(fileContent).toContain("Hello markdown");

    const second = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "My Test Note",
        markdownBody: "Second",
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    expect(second.fileName).toBe("2026-01-01-My Test Note-2.md");
  });
});
