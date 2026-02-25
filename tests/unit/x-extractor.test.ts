import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { XExtractor } from "../../src/extract/x-extractor.js";

describe("XExtractor", () => {
  it("extracts tweet text, metadata, and media urls from x status html", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_status.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://x.com/testuser/status/1234567890",
      finalUrl: "https://x.com/testuser/status/1234567890",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:01:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.statusId).toBe("1234567890");
    expect(result.authorHandle).toBe("testuser");
    expect(result.byline).toBe("@testuser");
    expect(result.excerpt).toContain("Hello from fixture X post");
    expect(result.publishedAt).toBe("2026-02-25T12:00:00.000Z");
    expect(result.mediaUrls).toEqual([
      "https://pbs.twimg.com/media/FIXTURE_OG.jpg",
      "https://pbs.twimg.com/media/FIXTURE_TW.jpg",
      "https://x.com/testuser/status/1234567890/photo/1",
      "https://pbs.twimg.com/media/FIXTURE_INLINE.jpg"
    ]);
  });

  it("returns blocked-note extraction for login wall pages", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://x.com/testuser/status/999999",
      finalUrl: "https://x.com/testuser/status/999999",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("blocked");
    expect(result.statusId).toBe("999999");
    expect(result.authorHandle).toBe("testuser");
    expect(result.excerpt).toContain("Sign-in required");
    expect(result.contentHtml).toContain("Open source URL");
  });
});
