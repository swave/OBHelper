import { describe, expect, it } from "vitest";

import { runPipeline } from "../../src/core/pipeline.js";
import type {
  ExtractedMainContent,
  FetchOptions,
  FetchResult,
  NormalizedDocument,
  SaveResult,
  SourcePlatform,
  WriteOptions
} from "../../src/core/types.js";
import type { ContentExtractor } from "../../src/extract/extractor.js";
import type { Fetcher } from "../../src/fetch/fetcher.js";
import type { DocumentWriter } from "../../src/obsidian/writer.js";
import type { ExtractorResolver } from "../../src/providers/extractor-registry.js";

class FakeFetcher implements Fetcher {
  public readonly id = "fake";

  public async fetch(options: FetchOptions): Promise<FetchResult> {
    return {
      requestedUrl: options.url,
      finalUrl: options.url,
      html: "<article><h1>T</h1><p>Body</p></article>",
      statusCode: 200,
      fetchedAt: "2026-02-25T00:00:00.000Z"
    };
  }
}

class FakeExtractor implements ContentExtractor {
  public readonly id = "fake-extractor";

  public async extract(): Promise<ExtractedMainContent> {
    return {
      title: "Pipeline Title",
      contentHtml: "<p>Body</p>",
      byline: "Agent"
    };
  }
}

class HangingExtractor implements ContentExtractor {
  public readonly id = "hanging-extractor";

  public async extract(): Promise<ExtractedMainContent> {
    return new Promise<ExtractedMainContent>(() => {
      // Intentionally never resolves to simulate parser deadlock/heavy pages.
    });
  }
}

class FakeRegistry implements ExtractorResolver {
  public resolve(sourcePlatform: SourcePlatform): ContentExtractor {
    expect(sourcePlatform).toBe("x");
    return new FakeExtractor();
  }
}

class FakeWriter implements DocumentWriter {
  public async write(document: NormalizedDocument, _options: WriteOptions): Promise<SaveResult> {
    expect(document.title).toBe("Pipeline Title");
    expect(document.sourcePlatform).toBe("x");

    return {
      outputPath: "/vault/Inbox/file.md",
      created: true,
      fileName: "file.md"
    };
  }
}

describe("runPipeline", () => {
  it("orchestrates fetch, extract, normalize, and write", async () => {
    const result = await runPipeline(
      {
        url: "https://x.com/someone/status/1",
        write: {
          vaultPath: "/vault"
        },
        fetch: {}
      },
      {
        fetcher: new FakeFetcher(),
        extractors: new FakeRegistry(),
        writer: new FakeWriter()
      }
    );

    expect(result.sourcePlatform).toBe("x");
    expect(result.saved.outputPath).toBe("/vault/Inbox/file.md");
    expect(result.normalized.markdownBody).toContain("Body");
  });

  it("rejects non-status x URLs", async () => {
    await expect(() =>
      runPipeline(
        {
          url: "https://x.com/someone",
          write: {
            vaultPath: "/vault"
          },
          fetch: {}
        },
        {
          fetcher: new FakeFetcher(),
          extractors: new FakeRegistry(),
          writer: new FakeWriter()
        }
      )
    ).rejects.toThrow("X provider currently supports only status URLs");
  });

  it("rejects non-article weixin URLs", async () => {
    await expect(() =>
      runPipeline(
        {
          url: "https://mp.weixin.qq.com/mp/profile_ext?action=home",
          write: {
            vaultPath: "/vault"
          },
          fetch: {}
        },
        {
          fetcher: new FakeFetcher(),
          extractors: new FakeRegistry(),
          writer: new FakeWriter()
        }
      )
    ).rejects.toThrow("Weixin provider currently supports only article URLs");
  });

  it("falls back when extraction stage times out", async () => {
    const writer: DocumentWriter = {
      write: async (document) => ({
        outputPath: `/vault/Inbox/${document.title}.md`,
        created: true,
        fileName: `${document.title}.md`
      })
    };
    const extractorRegistry: ExtractorResolver = {
      resolve: (sourcePlatform) => {
        expect(sourcePlatform).toBe("generic");
        return new HangingExtractor();
      }
    };

    const result = await runPipeline(
      {
        url: "https://example.com/post",
        write: {
          vaultPath: "/vault"
        },
        fetch: {
          timeoutMs: 15
        }
      },
      {
        fetcher: new FakeFetcher(),
        extractors: extractorRegistry,
        writer
      }
    );

    expect(result.normalized.markdownBody).toContain("Extraction timed out");
    expect(result.normalized.markdownBody).toContain("[Open source URL](https://example.com/post)");
  });
});
