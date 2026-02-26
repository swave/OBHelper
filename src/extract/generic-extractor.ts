import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { ObfronterError } from "../core/errors.js";
import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";

function stripNonContentBlocks(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, "");
}

export class GenericExtractor implements ContentExtractor {
  public readonly id = "generic";

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    const dom = new JSDOM(stripNonContentBlocks(input.html), { url: input.finalUrl });
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
