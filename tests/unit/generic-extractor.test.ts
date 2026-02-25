import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GenericExtractor } from "../../src/extract/generic-extractor.js";

describe("GenericExtractor", () => {
  it("extracts title and content from deterministic fixture html", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/article.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://example.com/post",
      finalUrl: "https://example.com/post",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z"
    });

    expect(result.title).toContain("Fixture Article");
    expect(result.contentHtml).toContain("deterministic fixture paragraph");
  });
});
