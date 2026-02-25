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
          vaultPath: "/vault",
          subdirectory: "Inbox"
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
});
