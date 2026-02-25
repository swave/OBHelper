import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { XExtractor } from "../../src/extract/x-extractor.js";

describe("XExtractor", () => {
  it("extracts tweet text, metadata, and media urls from x status html", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_status.html");
    const html = await readFile(fixturePath, "utf8");

    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(oEmbedFetch);
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
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("returns blocked-note extraction for login wall pages", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 403,
      json: async () => ({})
    }));
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

  it("extracts from i/web status URLs using canonical handle and lang nodes", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_status_iweb.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const result = await extractor.extract({
      requestedUrl: "https://x.com/i/web/status/555555",
      finalUrl: "https://x.com/i/web/status/555555",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-26T01:24:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.statusId).toBe("555555");
    expect(result.authorHandle).toBe("fixtureuser");
    expect(result.byline).toBe("@fixtureuser");
    expect(result.publishedAt).toBe("2026-02-26T01:23:45.000Z");
    expect(result.contentHtml).toContain("First line from lang node.");
    expect(result.contentHtml).toContain("Second line from lang node.");
    expect(result.mediaUrls).toEqual(["https://pbs.twimg.com/media/IWEB_OG.jpg"]);
  });

  it("maps rate-limit pages to blocked status with specific reason", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_rate_limited.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 429,
      json: async () => ({})
    }));
    const result = await extractor.extract({
      requestedUrl: "https://x.com/someuser/status/777777",
      finalUrl: "https://x.com/someuser/status/777777",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-26T01:25:00.000Z"
    });

    expect(result.extractionStatus).toBe("blocked");
    expect(result.statusId).toBe("777777");
    expect(result.authorHandle).toBe("someuser");
    expect(result.excerpt).toBe("X rate limit exceeded for this request.");
    expect(result.contentHtml).toContain("X rate limit exceeded for this request.");
  });

  it("uses oembed fallback when html page is blocked", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        author_name: "Elvis Sun",
        html: "<blockquote><p>Hello from oEmbed fallback tweet body.</p></blockquote>"
      })
    }));

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.authorHandle).toBe("elvissun");
    expect(result.statusId).toBe("2025920521871716562");
    expect(result.byline).toBe("@elvissun");
    expect(result.excerpt).toContain("Hello from oEmbed fallback tweet body");
    expect(result.contentHtml).toContain("Hello from oEmbed fallback tweet body");
  });
});
