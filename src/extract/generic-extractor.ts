import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

import { ObfronterError } from "../core/errors.js";
import type { CapturedCodeBlock, ExtractedMainContent, FetchResult } from "../core/types.js";
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

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function normalizeCodeIdentity(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeAnchorIdentity(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().toLowerCase();
}

function collectCodeBlocksFromBody(body: HTMLElement): string[] {
  const codeBlocks = Array.from(body.querySelectorAll("pre")) as Array<{ textContent: string | null }>;
  const values: string[] = [];
  for (const pre of codeBlocks) {
    const text = normalizeCodeIdentity(pre.textContent ?? "");
    if (text.length > 0) {
      values.push(text);
    }
  }
  return values;
}

function findAnchorNode(body: HTMLElement, anchorText: string | undefined): Element | undefined {
  if (!anchorText) {
    return undefined;
  }

  const normalizedAnchor = normalizeAnchorIdentity(anchorText);
  if (normalizedAnchor.length < 8) {
    return undefined;
  }

  const probe = normalizedAnchor.slice(0, Math.min(120, normalizedAnchor.length));
  const candidates = Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote"));
  for (const candidate of candidates) {
    const candidateText = normalizeAnchorIdentity(candidate.textContent ?? "");
    if (!candidateText) {
      continue;
    }

    const candidateProbe = candidateText.slice(0, Math.min(120, candidateText.length));
    if (candidateText.includes(probe) || probe.includes(candidateProbe)) {
      return candidate;
    }
  }

  return undefined;
}

function createRecoveredCodeNode(document: Document, codeText: string): HTMLElement {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = codeText;
  pre.append(code);
  pre.setAttribute("data-obhelper-recovered-code", "true");
  return pre;
}

function appendRecoveredCodeBlocks(contentHtml: string, capturedCodeBlocks: CapturedCodeBlock[] | undefined): string {
  if (!capturedCodeBlocks || capturedCodeBlocks.length === 0) {
    return contentHtml;
  }

  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const { document } = dom.window;
  const body = document.body;
  const existingCodeBlocks = collectCodeBlocksFromBody(body);
  const existingSet = new Set(existingCodeBlocks.map((entry) => normalizeCodeIdentity(entry)));
  const unresolved: string[] = [];

  for (const captured of capturedCodeBlocks) {
    const blockText = normalizeCodeIdentity(captured.text);
    if (blockText.length < 10 || existingSet.has(blockText)) {
      continue;
    }

    let inserted = false;
    const beforeNode = findAnchorNode(body, captured.beforeText);
    if (beforeNode?.parentNode) {
      beforeNode.parentNode.insertBefore(createRecoveredCodeNode(document, blockText), beforeNode.nextSibling);
      inserted = true;
    }

    if (!inserted) {
      const afterNode = findAnchorNode(body, captured.afterText);
      if (afterNode?.parentNode) {
        afterNode.parentNode.insertBefore(createRecoveredCodeNode(document, blockText), afterNode);
        inserted = true;
      }
    }

    if (!inserted) {
      unresolved.push(blockText);
    }

    existingSet.add(blockText);
  }

  if (unresolved.length > 0) {
    const recoveredSection = [
      "<section data-obhelper-recovered-code=\"true\">",
      "<h2>Recovered Code Blocks</h2>",
      ...unresolved.map((block) => `<pre><code>${escapeHtml(block)}</code></pre>`),
      "</section>"
    ].join("");
    body.insertAdjacentHTML("beforeend", recoveredSection);
  }

  const resolved = body.innerHTML.trim();
  return resolved.length > 0 ? resolved : contentHtml;
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
    const recoveredContent = appendRecoveredCodeBlocks(cleanedContent, input.capturedCodeBlocks);

    return {
      title: article.title,
      contentHtml: recoveredContent,
      byline: article.byline ?? undefined,
      excerpt: article.excerpt ?? undefined,
      publishedAt: article.publishedTime ?? undefined
    };
  }
}
