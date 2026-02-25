import { JSDOM } from "jsdom";

import { parseXStatusRef } from "../core/url-source.js";
import type { ExtractedMainContent, FetchLinkedPage, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";
import { GenericExtractor } from "./generic-extractor.js";

const BLOCKED_PAGE_MARKERS = [
  "log in to x",
  "sign in to x",
  "rate limit exceeded",
  "post is unavailable",
  "this post is unavailable",
  "account suspended",
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

function mergeStatusRefs(
  base: { statusId?: string; authorHandle?: string },
  incoming: { statusId?: string; authorHandle?: string }
): { statusId?: string; authorHandle?: string } {
  return {
    statusId: base.statusId ?? incoming.statusId,
    authorHandle: base.authorHandle ?? incoming.authorHandle
  };
}

function resolveStatusRef(input: FetchResult, document: Document, finalUrl: URL): { statusId?: string; authorHandle?: string } {
  let resolved: { statusId?: string; authorHandle?: string } = {};

  const fromFinalUrl = parseXStatusRef(finalUrl);
  if (fromFinalUrl) {
    resolved = mergeStatusRefs(resolved, fromFinalUrl);
  }

  try {
    const requestedUrl = new URL(input.requestedUrl);
    const fromRequestedUrl = parseXStatusRef(requestedUrl);
    if (fromRequestedUrl) {
      resolved = mergeStatusRefs(resolved, fromRequestedUrl);
    }
  } catch {
    // Fall through to canonical parsing.
  }

  const canonicalHref = document.querySelector('link[rel="canonical"]')?.getAttribute("href");
  if (!canonicalHref) {
    return resolved;
  }

  try {
    const canonicalUrl = new URL(canonicalHref, finalUrl);
    const fromCanonicalUrl = parseXStatusRef(canonicalUrl);
    if (fromCanonicalUrl) {
      resolved = mergeStatusRefs(resolved, fromCanonicalUrl);
    }
    return resolved;
  } catch {
    return resolved;
  }
}

function findPrimaryArticle(document: Document): Element | null {
  const tweetArticle = document.querySelector('article[data-testid="tweet"]');
  if (tweetArticle) {
    return tweetArticle;
  }

  return document.querySelector("article");
}

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function hasBlockedMarker(text: string): boolean {
  const normalized = text.toLowerCase();
  return BLOCKED_PAGE_MARKERS.some((marker) => normalized.includes(marker));
}

function extractTextFromLangNodes(article: Element | null): string | undefined {
  if (!article) {
    return undefined;
  }

  const chunks: string[] = [];
  for (const node of article.querySelectorAll("[lang]")) {
    const text = normalizeWhitespace(node.textContent ?? "");
    if (text.length > 0) {
      chunks.push(text);
    }
  }

  const unique = [...new Set(chunks)];
  if (unique.length === 0) {
    return undefined;
  }

  return unique.join("\n");
}

function extractTweetContent(document: Document, article: Element | null): { text: string; html: string } | undefined {
  const tweetNode = article?.querySelector('[data-testid="tweetText"]') ??
    document.querySelector('article [data-testid="tweetText"]');
  if (tweetNode) {
    const text = normalizeWhitespace(tweetNode.textContent ?? "");
    if (text.length > 0) {
      return {
        text,
        html: tweetNode.innerHTML
      };
    }
  }

  const langNodeText = extractTextFromLangNodes(article);
  if (langNodeText && !hasBlockedMarker(langNodeText)) {
    return {
      text: langNodeText,
      html: `<p>${escapeHtml(langNodeText)}</p>`
    };
  }

  const metaDescription = readMeta(document, "twitter:description") ?? readMeta(document, "og:description");
  const cleanedMeta = metaDescription ? normalizeWhitespace(metaDescription) : "";
  if (cleanedMeta.length > 0 && !hasBlockedMarker(cleanedMeta)) {
    return {
      text: cleanedMeta,
      html: `<p>${escapeHtml(cleanedMeta)}</p>`
    };
  }

  return undefined;
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

  if (bodyText.includes("post is unavailable") || bodyText.includes("this post is unavailable")) {
    return "This X post is unavailable.";
  }

  if (bodyText.includes("account suspended")) {
    return "The X account appears to be suspended.";
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

interface OEmbedPayload {
  html?: string;
  author_name?: string;
}

interface OEmbedResponseLike {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type OEmbedFetch = (url: string) => Promise<OEmbedResponseLike>;
type UrlExpander = (url: string) => Promise<string | undefined>;
type LinkedPageFetch = (url: string) => Promise<LinkedPageResponseLike>;

interface LinkedPageResponseLike {
  ok: boolean;
  status: number;
  url: string;
  text: () => Promise<string>;
}

function defaultOEmbedFetch(url: string): Promise<OEmbedResponseLike> {
  return fetch(url, {
    headers: {
      accept: "application/json"
    }
  });
}

async function defaultExpandUrl(url: string): Promise<string | undefined> {
  const headers = {
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
  };
  const request = {
    redirect: "follow" as const,
    signal: AbortSignal.timeout(15_000),
    headers
  };

  try {
    const headResponse = await fetch(url, {
      method: "HEAD",
      ...request
    });
    if (headResponse.url) {
      return headResponse.url;
    }
  } catch {
    // Some endpoints reject HEAD; fallback to GET below.
  }

  try {
    const getResponse = await fetch(url, {
      method: "GET",
      ...request
    });
    return getResponse.url || undefined;
  } catch {
    return undefined;
  }
}

function defaultLinkedPageFetch(url: string): Promise<LinkedPageResponseLike> {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9"
    }
  });
}

function isMostlyUrlText(text: string): boolean {
  const stripped = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[—–\-|:.,!?()"'`]/g, " ")
    .replace(/\s+/g, "")
    .trim();

  return stripped.length === 0;
}

function renderExpandedLinksBlock(urls: string[]): string {
  if (urls.length === 0) {
    return "";
  }

  const items = urls.map((url) => `<li><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></li>`).join("");
  return `<p>Expanded links:</p><ul>${items}</ul>`;
}

function isXLikeHost(inputUrl: string): boolean {
  try {
    const host = new URL(inputUrl).hostname.toLowerCase();
    return host === "x.com" || host.endsWith(".x.com") ||
      host === "twitter.com" || host.endsWith(".twitter.com") ||
      host === "t.co";
  } catch {
    return false;
  }
}

function isXArticleUrl(inputUrl: string): boolean {
  try {
    const parsed = new URL(inputUrl);
    const host = parsed.hostname.toLowerCase();
    if (!(host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) {
      return false;
    }

    return /\/article\/[0-9A-Za-z_]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function shouldSkipLinkedSource(inputUrl: string): boolean {
  return isXLikeHost(inputUrl) && !isXArticleUrl(inputUrl);
}

const X_SNAPSHOT_NOISE_LINES = new Set([
  "home",
  "explore",
  "notifications",
  "messages",
  "bookmarks",
  "jobs",
  "communities",
  "premium",
  "verified orgs",
  "profile",
  "more",
  "post",
  "follow",
  "following",
  "want to publish your own article?",
  "upgrade to premium",
  "to view keyboard shortcuts, press question mark",
  "view keyboard shortcuts",
  "log in",
  "sign up"
]);

const CODE_LANG_ALIASES: Record<string, string> = {
  bash: "bash",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  python: "python",
  py: "python",
  diff: "diff"
};

function isLikelyMetricLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^\d+(?:\.\d+)?[kmb]?$/i.test(trimmed)) {
    return true;
  }

  return /^follow(?:\s+\d+(?:\.\d+)?[kmb]?)+$/i.test(trimmed);
}

function shouldDropSnapshotLine(line: string): boolean {
  const normalized = line.toLowerCase();
  if (X_SNAPSHOT_NOISE_LINES.has(normalized)) {
    return true;
  }

  if (isLikelyMetricLine(line)) {
    return true;
  }

  if (/^@[a-z0-9_]{1,20}$/i.test(line)) {
    return true;
  }

  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:,\s+\d{4})?$/i.test(line)) {
    return true;
  }

  return line === "·" || line === "•";
}

function cleanLinkedTextSnapshot(raw: string): string[] {
  const lines = raw
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0)
    .filter((line) => !shouldDropSnapshotLine(line));

  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1] === line) {
      continue;
    }
    deduped.push(line);
  }

  return deduped;
}

function cleanLinkedTitle(rawTitle: string | undefined): string | undefined {
  if (!rawTitle) {
    return undefined;
  }

  const cleaned = normalizeWhitespace(rawTitle)
    .replace(/\s*[|/]\s*x$/i, "")
    .replace(/\s+on x$/i, "")
    .trim();

  if (!cleaned || cleaned.toLowerCase() === "x") {
    return undefined;
  }

  return cleaned;
}

function parseCodeLanguage(line: string): string | undefined {
  const normalized = line.trim().toLowerCase();
  return CODE_LANG_ALIASES[normalized];
}

function isLikelyCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return false;
  }

  if (/^(```|#\s|\/\/|\/\*|\*\/|\$ )/.test(trimmed)) {
    return true;
  }

  if (/^(git|npm|pnpm|yarn|npx|node|python|pip|curl|tmux|gh|docker|kubectl|cd|ls|cat|echo|export)\b/i.test(trimmed)) {
    return true;
  }

  if (/^[./~$][^\s].*/.test(trimmed)) {
    return true;
  }

  if (/^[-]{1,2}[a-z0-9][\w-]*/i.test(trimmed)) {
    return true;
  }

  if (/^[\[\]\{\}",:]+$/.test(trimmed)) {
    return true;
  }

  if (/^"[^"]+"\s*:/.test(trimmed)) {
    return true;
  }

  if (/^(if|for|while|case|then|else|elif|fi|do|done)\b/.test(trimmed)) {
    return true;
  }

  if (/\\$/.test(trimmed)) {
    return true;
  }

  if (/^[a-z_][a-z0-9_]*\s*=/.test(trimmed)) {
    return true;
  }

  return false;
}

function isCodeContinuationLine(previousLine: string | undefined, currentLine: string): boolean {
  const previous = previousLine?.trim();
  const current = currentLine.trim();
  if (!previous || current.length === 0) {
    return false;
  }

  if (previous.endsWith("\\")) {
    return true;
  }

  if ((previous.endsWith("{") || previous.endsWith(",")) && /^"[^"]+"/.test(current)) {
    return true;
  }

  return false;
}

function renderSnapshotBlocks(lines: string[]): { contentHtml: string; excerptText: string } {
  const html: string[] = [];
  const excerptParts: string[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const language = parseCodeLanguage(line);

    if (language && index + 1 < lines.length && isLikelyCodeLine(lines[index + 1])) {
      const codeLines: string[] = [];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        const lastCodeLine = codeLines[codeLines.length - 1];
        if (!isLikelyCodeLine(candidate) && !isCodeContinuationLine(lastCodeLine, candidate)) {
          break;
        }
        codeLines.push(candidate);
        cursor += 1;
      }
      if (codeLines.length > 0) {
        html.push(
          `<pre><code class="language-${language}">${escapeHtml(codeLines.join("\n"))}</code></pre>`
        );
        index = cursor;
        continue;
      }
    }

    if (isLikelyCodeLine(line) && index + 1 < lines.length && isLikelyCodeLine(lines[index + 1])) {
      const codeLines: string[] = [line];
      let cursor = index + 1;
      while (cursor < lines.length) {
        const candidate = lines[cursor];
        const lastCodeLine = codeLines[codeLines.length - 1];
        if (!isLikelyCodeLine(candidate) && !isCodeContinuationLine(lastCodeLine, candidate)) {
          break;
        }
        codeLines.push(candidate);
        cursor += 1;
      }
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      index = cursor;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      let cursor = index;
      while (cursor < lines.length && /^-\s+/.test(lines[cursor])) {
        const item = lines[cursor].replace(/^-\s+/, "").trim();
        if (item.length > 0) {
          items.push(item);
          excerptParts.push(item);
        }
        cursor += 1;
      }
      if (items.length > 0) {
        html.push(`<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`);
        index = cursor;
        continue;
      }
    }

    html.push(`<p>${escapeHtml(line)}</p>`);
    excerptParts.push(line);
    index += 1;
  }

  return {
    contentHtml: html.join(""),
    excerptText: normalizeWhitespace(excerptParts.join(" "))
  };
}

function tryExtractFromLinkedSnapshot(page: FetchLinkedPage): ExtractedMainContent | undefined {
  if (!isXArticleUrl(page.url) || !page.text) {
    return undefined;
  }

  const cleanedLines = cleanLinkedTextSnapshot(page.text);
  const cleanedText = cleanedLines.join(" ");
  if (cleanedText.length < 40 || hasBlockedMarker(cleanedText)) {
    return undefined;
  }

  const titleCandidate = cleanLinkedTitle(page.title) ?? cleanedLines[0]?.slice(0, 160);
  if (!titleCandidate) {
    return undefined;
  }

  const rendered = renderSnapshotBlocks(cleanedLines);

  return {
    title: titleCandidate,
    contentHtml: rendered.contentHtml,
    excerpt: normalizeWhitespace(rendered.excerptText).slice(0, 280)
  };
}

function parseOEmbedContentHtml(html: string): { contentHtml: string; text: string; links: string[] } | undefined {
  const dom = new JSDOM(html);
  const paragraph = dom.window.document.querySelector("blockquote p");
  const blockquote = dom.window.document.querySelector("blockquote");
  const contentNode = paragraph ?? blockquote ?? dom.window.document.body;
  const text = normalizeWhitespace(contentNode.textContent ?? "");

  if (!text || hasBlockedMarker(text)) {
    return undefined;
  }

  const links = [...contentNode.querySelectorAll("a[href]")]
    .map((link) => link.getAttribute("href")?.trim())
    .filter((href): href is string => Boolean(href));

  return {
    contentHtml: paragraph
      ? `<p>${paragraph.innerHTML}</p>`
      : blockquote
        ? blockquote.innerHTML
        : `<p>${escapeHtml(text)}</p>`,
    text,
    links
  };
}

function collectLinksFromHtml(html: string): string[] {
  const dom = new JSDOM(html);
  return [...dom.window.document.querySelectorAll("a[href]")]
    .map((link) => link.getAttribute("href")?.trim())
    .filter((href): href is string => Boolean(href));
}

function collectLinksFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/\S+/g);
  if (!matches) {
    return [];
  }

  return matches.map((url) => url.replace(/[).,!?:;]+$/g, ""));
}

export class XExtractor implements ContentExtractor {
  public readonly id = "x";
  private readonly genericExtractor = new GenericExtractor();

  public constructor(
    private readonly oEmbedFetch: OEmbedFetch = defaultOEmbedFetch,
    private readonly expandUrl: UrlExpander = defaultExpandUrl,
    private readonly linkedPageFetch: LinkedPageFetch = defaultLinkedPageFetch
  ) {}

  private async tryLinkedPageContent(expandedLinks: string[]): Promise<{
    sourceUrl: string;
    extracted: ExtractedMainContent;
  } | undefined> {
    for (const link of expandedLinks.slice(0, 3)) {
      if (shouldSkipLinkedSource(link)) {
        continue;
      }

      let response: LinkedPageResponseLike;
      try {
        response = await this.linkedPageFetch(link);
      } catch {
        continue;
      }

      if (!response.ok) {
        continue;
      }

      let html: string;
      try {
        html = await response.text();
      } catch {
        continue;
      }

      try {
        const extracted = await this.genericExtractor.extract({
          requestedUrl: link,
          finalUrl: response.url || link,
          html,
          statusCode: response.status,
          fetchedAt: new Date().toISOString()
        });

        if (normalizeWhitespace(extracted.excerpt ?? "").length > 20 || normalizeWhitespace(extracted.title).length > 0) {
          return {
            sourceUrl: response.url || link,
            extracted
          };
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async tryPrefetchedLinkedPageContent(linkedPages: FetchLinkedPage[] | undefined): Promise<{
    sourceUrl: string;
    extracted: ExtractedMainContent;
  } | undefined> {
    if (!linkedPages || linkedPages.length === 0) {
      return undefined;
    }

    const prioritizedPages = [...linkedPages]
      .sort((left, right) => Number(isXArticleUrl(right.url)) - Number(isXArticleUrl(left.url)))
      .slice(0, 3);

    for (const page of prioritizedPages) {
      if (shouldSkipLinkedSource(page.url)) {
        continue;
      }

      const snapshotExtracted = tryExtractFromLinkedSnapshot(page);
      if (snapshotExtracted) {
        return {
          sourceUrl: page.url,
          extracted: snapshotExtracted
        };
      }

      try {
        const extracted = await this.genericExtractor.extract({
          requestedUrl: page.url,
          finalUrl: page.url,
          html: page.html,
          statusCode: 200,
          fetchedAt: new Date().toISOString()
        });

        if (normalizeWhitespace(extracted.excerpt ?? "").length > 20 || normalizeWhitespace(extracted.title).length > 0) {
          return {
            sourceUrl: page.url,
            extracted
          };
        }
      } catch {
        continue;
      }
    }

    return undefined;
  }

  private async tryOEmbedFallback(input: {
    statusUrl: string;
    fallbackTitle?: string;
    statusRef: { statusId?: string; authorHandle?: string };
    authorHandle?: string;
    publishedAt?: string;
    mediaUrls: string[];
    linkedPages?: FetchLinkedPage[];
  }): Promise<ExtractedMainContent | undefined> {
    const endpoint = new URL("https://publish.twitter.com/oembed");
    endpoint.searchParams.set("url", input.statusUrl);
    endpoint.searchParams.set("omit_script", "true");
    endpoint.searchParams.set("dnt", "true");
    endpoint.searchParams.set("lang", "en");

    let response: OEmbedResponseLike;
    try {
      response = await this.oEmbedFetch(endpoint.toString());
    } catch {
      return undefined;
    }

    if (!response.ok) {
      return undefined;
    }

    let payload: OEmbedPayload;
    try {
      payload = (await response.json()) as OEmbedPayload;
    } catch {
      return undefined;
    }

    if (!payload.html) {
      return undefined;
    }

    const parsed = parseOEmbedContentHtml(payload.html);
    if (!parsed) {
      return undefined;
    }

    const oEmbedAuthor = normalizeWhitespace(payload.author_name ?? "");
    const title = buildTitle({
      fallbackTitle: input.fallbackTitle ?? (oEmbedAuthor ? `${oEmbedAuthor} on X` : undefined),
      authorHandle: input.authorHandle,
      statusId: input.statusRef.statusId,
      blocked: false
    });

    const expandedLinks = [...new Set(await Promise.all(parsed.links.map((url) => this.expandUrl(url))))].filter(
      (url): url is string => Boolean(url && !url.startsWith("https://t.co/"))
    );
    const prefetchedLinks = [...new Set((input.linkedPages ?? []).map((page) => page.url))];
    const linkOnly = isMostlyUrlText(parsed.text) && (expandedLinks.length > 0 || prefetchedLinks.length > 0);

    if (linkOnly) {
      const linkedPageContent = await this.tryPrefetchedLinkedPageContent(input.linkedPages) ??
        await this.tryLinkedPageContent(expandedLinks);
      if (linkedPageContent) {
        return {
          title: linkedPageContent.extracted.title,
          contentHtml: [
            `<p>Linked content extracted from <a href="${escapeHtml(linkedPageContent.sourceUrl)}">${escapeHtml(linkedPageContent.sourceUrl)}</a></p>`,
            linkedPageContent.extracted.contentHtml
          ].join(""),
          byline: input.authorHandle ? `@${input.authorHandle}` : (oEmbedAuthor || undefined),
          excerpt: normalizeWhitespace(linkedPageContent.extracted.excerpt ?? linkedPageContent.extracted.title).slice(0, 280),
          publishedAt: input.publishedAt ?? linkedPageContent.extracted.publishedAt,
          extractionStatus: "ok",
          authorHandle: input.authorHandle,
          statusId: input.statusRef.statusId,
          mediaUrls: [...new Set([...(input.mediaUrls || []), ...expandedLinks, ...prefetchedLinks])]
        };
      }
    }

    const linkTargets = [...new Set([...expandedLinks, ...prefetchedLinks])];
    const enrichedContentHtml = linkOnly
      ? `${parsed.contentHtml}${renderExpandedLinksBlock(linkTargets)}`
      : parsed.contentHtml;
    const excerpt = linkOnly ? linkTargets.join(" ") : parsed.text;

    return {
      title,
      contentHtml: enrichedContentHtml,
      byline: input.authorHandle ? `@${input.authorHandle}` : (oEmbedAuthor || undefined),
      excerpt: excerpt.slice(0, 280),
      publishedAt: input.publishedAt,
      extractionStatus: "ok",
      authorHandle: input.authorHandle,
      statusId: input.statusRef.statusId,
      mediaUrls: linkOnly
        ? [...new Set([...(input.mediaUrls || []), ...linkTargets])]
        : (input.mediaUrls.length > 0 ? input.mediaUrls : undefined)
    };
  }

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    const finalUrl = new URL(input.finalUrl);
    const dom = new JSDOM(input.html, { url: finalUrl.toString() });
    const { document } = dom.window;

    const statusRef = resolveStatusRef(input, document, finalUrl);
    const authorHandle = normalizeHandle(statusRef.authorHandle);
    const article = findPrimaryArticle(document);
    const tweetContent = extractTweetContent(document, article);
    const tweetText = tweetContent?.text ?? "";
    const publishedAt = article?.querySelector("time")?.getAttribute("datetime") ??
      readMeta(document, "article:published_time");
    const mediaUrls = collectMediaUrls(document, article, finalUrl);
    const fallbackTitle = readMeta(document, "og:title") ?? readMeta(document, "twitter:title");

    if (tweetText.length > 0) {
      const rawLinks = [
        ...collectLinksFromHtml(tweetContent?.html ?? ""),
        ...collectLinksFromText(tweetText)
      ];
      const expandedLinks = [...new Set(await Promise.all(rawLinks.map((url) => this.expandUrl(url))))].filter(
        (url): url is string => Boolean(url && !url.startsWith("https://t.co/"))
      );
      const prefetchedLinks = [...new Set((input.linkedPages ?? []).map((page) => page.url))];
      const linkOnly = isMostlyUrlText(tweetText) && (expandedLinks.length > 0 || prefetchedLinks.length > 0);

    if (linkOnly) {
        const linkedPageContent = await this.tryPrefetchedLinkedPageContent(input.linkedPages) ??
          await this.tryLinkedPageContent(expandedLinks);
        if (linkedPageContent) {
          return {
            title: linkedPageContent.extracted.title,
            contentHtml: [
              `<p>Linked content extracted from <a href="${escapeHtml(linkedPageContent.sourceUrl)}">${escapeHtml(linkedPageContent.sourceUrl)}</a></p>`,
              linkedPageContent.extracted.contentHtml
            ].join(""),
            byline: authorHandle ? `@${authorHandle}` : undefined,
            excerpt: normalizeWhitespace(linkedPageContent.extracted.excerpt ?? linkedPageContent.extracted.title).slice(0, 280),
            publishedAt: publishedAt ?? linkedPageContent.extracted.publishedAt,
            extractionStatus: "ok",
            authorHandle,
            statusId: statusRef.statusId,
            mediaUrls: [...new Set([...(mediaUrls || []), ...expandedLinks, ...prefetchedLinks])]
          };
        }
      }

      const linkTargets = [...new Set([...expandedLinks, ...prefetchedLinks])];
      const enrichedContentHtml = linkOnly
        ? `${tweetContent?.html ?? `<p>${escapeHtml(tweetText)}</p>`}${renderExpandedLinksBlock(linkTargets)}`
        : tweetContent?.html ?? `<p>${escapeHtml(tweetText)}</p>`;
      const excerpt = linkOnly ? linkTargets.join(" ") : tweetText;

      return {
        title: buildTitle({
          fallbackTitle,
          authorHandle,
          statusId: statusRef.statusId,
          blocked: false
        }),
        contentHtml: enrichedContentHtml,
        byline: authorHandle ? `@${authorHandle}` : undefined,
        excerpt: excerpt.slice(0, 280),
        publishedAt: publishedAt ?? undefined,
        extractionStatus: "ok",
        authorHandle,
        statusId: statusRef.statusId,
        mediaUrls: linkOnly
          ? [...new Set([...(mediaUrls || []), ...linkTargets])]
          : (mediaUrls.length > 0 ? mediaUrls : undefined)
      };
    }

    const oEmbedFallback = await this.tryOEmbedFallback({
      statusUrl: input.finalUrl,
      fallbackTitle,
      statusRef,
      authorHandle,
      publishedAt: publishedAt ?? undefined,
      mediaUrls,
      linkedPages: input.linkedPages
    });
    if (oEmbedFallback) {
      return oEmbedFallback;
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
