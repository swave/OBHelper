import { JSDOM } from "jsdom";

import { parseXStatusRef } from "../core/url-source.js";
import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";

const BLOCKED_PAGE_MARKERS = [
  "log in to x",
  "sign in to x",
  "rate limit exceeded",
  "something went wrong",
  "enable javascript"
];

function readMeta(document: Document, property: string): string | undefined {
  const node = document.querySelector(`meta[property="${property}"]`) ??
    document.querySelector(`meta[name="${property}"]`);
  return node?.getAttribute("content")?.trim() || undefined;
}

function parseAbsoluteUrl(raw: string, baseUrl: URL): string | undefined {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function normalizeHandle(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }

  const normalized = input.replace(/^@+/, "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function resolveStatusRef(document: Document, finalUrl: URL): { statusId?: string; authorHandle?: string } {
  const fromFinalUrl = parseXStatusRef(finalUrl);
  if (fromFinalUrl) {
    return fromFinalUrl;
  }

  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (!canonicalHref) {
    return {};
  }

  try {
    const canonicalUrl = new URL(canonicalHref, finalUrl);
    return parseXStatusRef(canonicalUrl) ?? {};
  } catch {
    return {};
  }
}

function findPrimaryArticle(document: Document): Element | null {
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  if (tweetArticle) {
    return tweetArticle;
  }

  return document.querySelector("article");
}

function collectMediaUrls(document: Document, article: Element | null, pageUrl: URL): string[] {
  const mediaUrls = new Set<string>();

  const ogImage = readMeta(document, "og:image");
  if (ogImage) {
    const resolved = parseAbsoluteUrl(ogImage, pageUrl);
    if (resolved) {
      mediaUrls.add(resolved);
    }
  }

  const twitterImage = readMeta(document, "twitter:image");
  if (twitterImage) {
    const resolved = parseAbsoluteUrl(twitterImage, pageUrl);
    if (resolved) {
      mediaUrls.add(resolved);
    }
  }

  if (article) {
    for (const node of article.querySelectorAll('a[href*="/photo/"], a[href*="/video/"]')) {
      const href = node.getAttribute("href");
      if (!href) {
        continue;
      }

      const resolved = parseAbsoluteUrl(href, pageUrl);
      if (resolved) {
        mediaUrls.add(resolved);
      }
    }

    for (const node of article.querySelectorAll("img[src*=\"twimg.com/media\"]")) {
      const src = node.getAttribute("src");
      if (!src) {
        continue;
      }

      const resolved = parseAbsoluteUrl(src, pageUrl);
      if (resolved) {
        mediaUrls.add(resolved);
      }
    }
  }

  return [...mediaUrls];
}

function detectBlockedReason(document: Document): string {
  const bodyText = document.body?.textContent?.toLowerCase() ?? "";

  if (bodyText.includes("log in to x") || bodyText.includes("sign in to x")) {
    return "Sign-in required to access this post.";
  }

  if (bodyText.includes("rate limit exceeded")) {
    return "X rate limit exceeded for this request.";
  }

  if (bodyText.includes("something went wrong")) {
    return "X returned an error page for this post.";
  }

  if (bodyText.includes("enable javascript")) {
    return "X content requires JavaScript rendering with an authenticated session.";
  }

  for (const marker of BLOCKED_PAGE_MARKERS) {
    if (bodyText.includes(marker)) {
      return "X blocked extraction for this post.";
    }
  }

  return "Content extraction failed. The post may require login or an authenticated session.";
}

function buildBlockedHtml(finalUrl: string, reason: string): string {
  return [
    "<p>X content could not be extracted automatically.</p>",
    `<p>Reason: ${reason}</p>`,
    `<p><a href="${finalUrl}">Open source URL</a></p>`
  ].join("");
}

function buildTitle(input: { fallbackTitle?: string; authorHandle?: string; statusId?: string; blocked: boolean }): string {
  if (input.fallbackTitle) {
    return input.blocked ? `${input.fallbackTitle} (Blocked)` : input.fallbackTitle;
  }

  const handlePrefix = input.authorHandle ? `@${input.authorHandle} ` : "";
  const statusPart = input.statusId ? `status ${input.statusId}` : "status";
  const base = `X post ${handlePrefix}${statusPart}`.trim();
  return input.blocked ? `${base} (Blocked)` : base;
}

export class XExtractor implements ContentExtractor {
  public readonly id = "x";

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    const finalUrl = new URL(input.finalUrl);
    const dom = new JSDOM(input.html, { url: finalUrl.toString() });
    const { document } = dom.window;

    const statusRef = resolveStatusRef(document, finalUrl);
    const authorHandle = normalizeHandle(statusRef.authorHandle);
    const article = findPrimaryArticle(document);
    const tweetNode = article?.querySelector('[data-testid="tweetText"]') ??
      document.querySelector('article [data-testid="tweetText"]');
    const tweetText = tweetNode?.textContent?.trim() ?? "";
    const publishedAt = article?.querySelector("time")?.getAttribute("datetime") ??
      readMeta(document, "article:published_time");
    const mediaUrls = collectMediaUrls(document, article, finalUrl);
    const fallbackTitle = readMeta(document, "og:title") ?? readMeta(document, "twitter:title");

    if (tweetText.length > 0) {
      return {
        title: buildTitle({
          fallbackTitle,
          authorHandle,
          statusId: statusRef.statusId,
          blocked: false
        }),
        contentHtml: tweetNode?.innerHTML ?? `<p>${tweetText}</p>`,
        byline: authorHandle ? `@${authorHandle}` : undefined,
        excerpt: tweetText.slice(0, 280),
        publishedAt: publishedAt ?? undefined,
        extractionStatus: "ok",
        authorHandle,
        statusId: statusRef.statusId,
        mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined
      };
    }

    const blockedReason = detectBlockedReason(document);
    return {
      title: buildTitle({
        fallbackTitle,
        authorHandle,
        statusId: statusRef.statusId,
        blocked: true
      }),
      contentHtml: buildBlockedHtml(input.finalUrl, blockedReason),
      byline: authorHandle ? `@${authorHandle}` : undefined,
      excerpt: blockedReason,
      publishedAt: publishedAt ?? undefined,
      extractionStatus: "blocked",
      authorHandle,
      statusId: statusRef.statusId,
      mediaUrls: mediaUrls.length > 0 ? mediaUrls : undefined
    };
  }
}
