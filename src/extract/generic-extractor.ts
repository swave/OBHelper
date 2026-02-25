import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { ObfronterError } from "../core/errors.js";
import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";

export class GenericExtractor implements ContentExtractor {
  public readonly id = "generic";

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    const dom = new JSDOM(input.html, { url: input.finalUrl });
    const article = new Readability(dom.window.document).parse();

    if (!article?.content || !article?.title) {
      throw new ObfronterError(
        "EXTRACTION_FAILED",
        `Readability could not extract article content from ${input.finalUrl}`
      );
    }

    return {
      title: article.title,
      contentHtml: article.content,
      byline: article.byline ?? undefined,
      excerpt: article.excerpt ?? undefined,
      publishedAt: article.publishedTime ?? undefined
    };
  }
}
