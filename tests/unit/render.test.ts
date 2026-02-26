import { describe, expect, it } from "vitest";

import { toNormalizedDocument } from "../../src/markdown/render.js";

describe("toNormalizedDocument", () => {
  it("preserves bold and list semantics in markdown output", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://x.com/example/status/1",
      sourcePlatform: "x",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Test",
        contentHtml: "<h1>Test</h1><p><strong>Bold phrase</strong> in paragraph.</p><ul><li><strong>First</strong> item</li><li>Second item</li></ul>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("**Bold phrase** in paragraph.");
    expect(normalized.markdownBody).toMatch(/-\s+\*\*First\*\* item/);
    expect(normalized.markdownBody).toMatch(/-\s+Second item/);
  });
});
