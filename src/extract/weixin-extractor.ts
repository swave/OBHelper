import { JSDOM } from "jsdom";

import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";

const CONTENT_SELECTORS = ["#js_content", ".rich_media_content", "article"];
const TITLE_SELECTORS = ["#activity-name", ".rich_media_title", "h1"];
const AUTHOR_SELECTORS = ["#js_name", ".rich_media_meta_nickname", "#profileBt .profile_nickname"];
const PUBLISHED_AT_SELECTORS = ["#publish_time", ".rich_media_meta.rich_media_meta_text"];

const BLOCKED_MARKERS = [
  "该内容已被发布者删除",
  "此内容因违规无法查看",
  "访问过于频繁",
  "内容已被删除",
  "the content has been deleted",
  "content is unavailable"
];

function readMeta(document: Document, property: string): string | undefined {
  const node = document.querySelector(`meta[property=\"${property}\"]`) ??
    document.querySelector(`meta[name=\"${property}\"]`);

  return node?.getAttribute("content")?.trim() || undefined;
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function parseAbsoluteUrl(raw: string, pageUrl: URL): string | undefined {
  try {
    return new URL(raw, pageUrl).toString();
  } catch {
    return undefined;
  }
}

function readFirstText(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const text = normalizeWhitespace(document.querySelector(selector)?.textContent ?? "");
    if (text.length > 0) {
      return text;
    }
  }

  return undefined;
}

function findContentNode(document: Document): Element | null {
  for (const selector of CONTENT_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) {
      return node;
    }
  }

  return null;
}

function collectMediaUrls(contentNode: Element | null, pageUrl: URL): string[] {
  if (!contentNode) {
    return [];
  }

  const mediaUrls = new Set<string>();

  for (const node of contentNode.querySelectorAll("img")) {
    const dataSrc = node.getAttribute("data-src");
    const src = node.getAttribute("src");

    for (const candidate of [dataSrc, src]) {
      if (!candidate) {
        continue;
      }

      const resolved = parseAbsoluteUrl(candidate, pageUrl);
      if (resolved) {
        mediaUrls.add(resolved);
      }
    }
  }

  return [...mediaUrls];
}

function detectBlockedReason(document: Document): string | undefined {
  const bodyText = normalizeWhitespace(document.body?.textContent ?? "").toLowerCase();

  for (const marker of BLOCKED_MARKERS) {
    if (bodyText.includes(marker.toLowerCase())) {
      if (marker.includes("频繁")) {
        return "Weixin blocked access due to frequent requests.";
      }

      if (marker.includes("违规")) {
        return "This Weixin article is unavailable due to policy restrictions.";
      }

      return "This Weixin article is unavailable or deleted.";
    }
  }

  return undefined;
}

function buildBlockedHtml(finalUrl: string, reason: string): string {
  return [
    "<p>Weixin content could not be extracted automatically.</p>",
    `<p>Reason: ${reason}</p>`,
    `<p><a href=\"${finalUrl}\">Open source URL</a></p>`
  ].join("");
}

export class WeixinExtractor implements ContentExtractor {
  public readonly id = "weixin";

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    const finalUrl = new URL(input.finalUrl);
    const dom = new JSDOM(input.html, { url: finalUrl.toString() });
    const { document } = dom.window;

    const contentNode = findContentNode(document);
    const contentText = normalizeWhitespace(contentNode?.textContent ?? "");
    const documentTitle = normalizeWhitespace(document.title);

    const title =
      readFirstText(document, TITLE_SELECTORS) ??
      readMeta(document, "og:title") ??
      (documentTitle || undefined) ??
      "Weixin Article";

    const byline =
      readFirstText(document, AUTHOR_SELECTORS) ??
      readMeta(document, "author") ??
      readMeta(document, "og:article:author") ??
      undefined;

    const publishedAt =
      readMeta(document, "article:published_time") ??
      readMeta(document, "og:article:published_time") ??
      readFirstText(document, PUBLISHED_AT_SELECTORS) ??
      undefined;

    const mediaUrls = collectMediaUrls(contentNode, finalUrl);
    const blockedReason = detectBlockedReason(document);

    if (contentText.length > 0 && !blockedReason) {
      return {
        title,
        contentHtml: contentNode?.innerHTML ?? `<p>${contentText}</p>`,
        byline,
        excerpt: contentText.slice(0, 280),
        publishedAt,
        extractionStatus: "ok",
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined
      };
    }

    const reason = blockedReason ?? "Content extraction failed for this Weixin page.";

    return {
      title: `${title} (Blocked)`,
      contentHtml: buildBlockedHtml(input.finalUrl, reason),
      byline,
      excerpt: reason,
      publishedAt,
      extractionStatus: "blocked",
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined
    };
  }
}
