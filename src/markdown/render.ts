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
    publishedAt: input.extracted.publishedAt,
    extractionStatus: input.extracted.extractionStatus,
    authorHandle: input.extracted.authorHandle,
    statusId: input.extracted.statusId,
    mediaUrls: input.extracted.mediaUrls
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

  if (document.extractionStatus) {
    frontmatter.push(`extraction_status: ${document.extractionStatus}`);
  }

  if (document.authorHandle) {
    frontmatter.push(`author_handle: ${yamlEscape(document.authorHandle)}`);
  }

  if (document.statusId) {
    frontmatter.push(`status_id: ${yamlEscape(document.statusId)}`);
  }

  if (document.mediaUrls && document.mediaUrls.length > 0) {
    frontmatter.push("media_urls:");
    for (const mediaUrl of document.mediaUrls) {
      frontmatter.push(`  - ${yamlEscape(mediaUrl)}`);
    }
  }

  frontmatter.push("---", "");

  const body = document.markdownBody.length > 0 ? document.markdownBody : "(No content extracted)";

  return `${frontmatter.join("\n")}${body}\n`;
}
