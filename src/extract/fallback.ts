import { JSDOM } from "jsdom";

import { ObfronterError } from "../core/errors.js";
import type { ExtractedMainContent, FetchResult } from "../core/types.js";

function readMeta(document: Document, property: string): string | undefined {
  const node = document.querySelector(`meta[property=\"${property}\"]`) ??
    document.querySelector(`meta[name=\"${property}\"]`);

  return node?.getAttribute("content")?.trim() || undefined;
}

export function fallbackExtractBySelectors(
  input: FetchResult,
  selectors: string[]
): ExtractedMainContent {
  const dom = new JSDOM(input.html, { url: input.finalUrl });
  const { document } = dom.window;

  for (const selector of selectors) {
    const node = document.querySelector(selector);
    if (!node || !node.textContent?.trim()) {
      continue;
    }

    const title =
      readMeta(document, "og:title") ??
      document.querySelector("title")?.textContent?.trim() ??
      "Untitled";

    return {
      title,
      contentHtml: node.innerHTML,
      byline: readMeta(document, "author"),
      excerpt: readMeta(document, "description"),
      publishedAt: readMeta(document, "article:published_time")
    };
  }

  throw new ObfronterError(
    "EXTRACTION_FAILED",
    `Fallback selectors could not find main content from ${input.finalUrl}`
  );
}
