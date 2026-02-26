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

const GITHUB_BLOG_TRIM_MARKERS = new Set([
  "related posts",
  "explore more from github",
  "we do newsletters, too",
  "site-wide links"
]);

function normalizeHeadingText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function trimGithubBlogTrailingNoise(contentHtml: string): string {
  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const { document } = dom.window;
  const body = document.body;
  const headings = Array.from(body.querySelectorAll("h1, h2, h3, h4, h5, h6")) as Element[];
  const cutoffHeading = headings.find((heading) =>
    GITHUB_BLOG_TRIM_MARKERS.has(normalizeHeadingText(heading.textContent ?? ""))
  );

  if (!cutoffHeading) {
    return contentHtml;
  }

  let cursor: ChildNode | null = cutoffHeading;
  while (cursor) {
    const next: ChildNode | null = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }

  const trimmed = body.innerHTML.trim();
  return trimmed.length > 0 ? trimmed : contentHtml;
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

    const finalUrl = new URL(input.finalUrl);
    const cleanedContent = finalUrl.hostname.toLowerCase() === "github.blog"
      ? trimGithubBlogTrailingNoise(article.content)
      : article.content;

    return {
      title: article.title,
      contentHtml: cleanedContent,
      byline: article.byline ?? undefined,
      excerpt: article.excerpt ?? undefined,
      publishedAt: article.publishedTime ?? undefined
    };
  }
}
