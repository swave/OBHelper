import { describe, expect, it, vi } from "vitest";

import { runFetchCommand } from "../../src/index.js";
import type { ExtractedMainContent, FetchOptions, FetchResult, NormalizedDocument, SaveResult, SourcePlatform, WriteOptions } from "../../src/core/types.js";
import type { ContentExtractor } from "../../src/extract/extractor.js";
import type { Fetcher } from "../../src/fetch/fetcher.js";
import type { DocumentWriter } from "../../src/obsidian/writer.js";
import type { ExtractorResolver } from "../../src/providers/extractor-registry.js";

class FakeFetcher implements Fetcher {
  public readonly id = "fake";
  public readonly fetch = vi.fn(async (options: FetchOptions): Promise<FetchResult> => ({
    requestedUrl: options.url,
    finalUrl: options.url,
    html: "<article><h1>Mock</h1><p>Body</p></article>",
    statusCode: 200,
    fetchedAt: "2026-02-26T00:00:00.000Z"
  }));
}

class FakeExtractor implements ContentExtractor {
  public readonly id = "fake-extractor";
  public async extract(): Promise<ExtractedMainContent> {
    return {
      title: "Mock Title",
      contentHtml: "<p>Mock body</p>"
    };
  }
}

class FakeRegistry implements ExtractorResolver {
  public resolve(_sourcePlatform: SourcePlatform): ContentExtractor {
    return new FakeExtractor();
  }
}

class FakeWriter implements DocumentWriter {
  public async write(_document: NormalizedDocument, _options: WriteOptions): Promise<SaveResult> {
    return {
      outputPath: "/tmp/vault/Inbox/mock.md",
      created: true,
      fileName: "mock.md"
    };
  }
}

describe("runFetchCommand", () => {
  it("requires session profile for x provider default browser mode", async () => {
    await expect(() =>
      runFetchCommand({
        url: "https://x.com/test/status/123",
        vaultPath: "/tmp/vault"
      })
    ).rejects.toThrow(
      "X provider defaults to browser mode. Provide --session-profile-dir, use --cdp-endpoint, or use --http-mode"
    );
  });

  it("uses cdp fetch mode without requiring session profile dir", async () => {
    const fakeFetcher = new FakeFetcher();
    const createDependencies = vi.fn(() => ({
      fetcher: fakeFetcher,
      extractors: new FakeRegistry(),
      writer: new FakeWriter()
    }));

    const result = await runFetchCommand(
      {
        url: "https://x.com/test/status/123",
        vaultPath: "/tmp/vault",
        cdpEndpoint: "http://127.0.0.1:9222"
      },
      {
        createDependencies
      }
    );

    expect(createDependencies).toHaveBeenCalledWith({ fetchMode: "cdp" });
    expect(fakeFetcher.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        cdpEndpoint: "http://127.0.0.1:9222"
      })
    );
    expect(result.sourcePlatform).toBe("x");
    expect(result.saved.outputPath).toContain("mock.md");
  });
});
