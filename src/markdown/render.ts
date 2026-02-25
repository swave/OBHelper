import TurndownService from "turndown";

import type { ExtractedMainContent, NormalizedDocument, SourcePlatform } from "../core/types.js";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});

function yamlEscape(value: string): string {
  return JSON.stringify(value);
}

export function toNormalizedDocument(input: {
  sourceUrl: string;
  sourcePlatform: SourcePlatform;
  fetchedAt: string;
  extracted: ExtractedMainContent;
}): NormalizedDocument {
  const markdownBody = turndown.turndown(input.extracted.contentHtml).trim();

  return {
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform,
    fetchedAt: input.fetchedAt,
    title: input.extracted.title.trim() || "Untitled",
    markdownBody,
    byline: input.extracted.byline,
    excerpt: input.extracted.excerpt,
    publishedAt: input.extracted.publishedAt
  };
}

export function renderMarkdownFile(document: NormalizedDocument): string {
  const frontmatter = [
    "---",
    `title: ${yamlEscape(document.title)}`,
    `source_platform: ${document.sourcePlatform}`,
    `source_url: ${yamlEscape(document.sourceUrl)}`,
    `fetched_at: ${yamlEscape(document.fetchedAt)}`
  ];

  if (document.byline) {
    frontmatter.push(`byline: ${yamlEscape(document.byline)}`);
  }

  if (document.excerpt) {
    frontmatter.push(`excerpt: ${yamlEscape(document.excerpt)}`);
  }

  if (document.publishedAt) {
    frontmatter.push(`published_at: ${yamlEscape(document.publishedAt)}`);
  }

  frontmatter.push("---", "");

  const body = document.markdownBody.length > 0 ? document.markdownBody : "(No content extracted)";

  return `${frontmatter.join("\n")}${body}\n`;
}
