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

function stripStyleBlocks(html: string): string {
  return html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

function parseCodeLanguage(line: string): string | undefined {
  const normalized = line.trim().toLowerCase();
  return CODE_LANG_ALIASES[normalized];
}

function parseImageMarker(line: string): string | undefined {
  const match = line.trim().match(/^\[\[IMAGE:(https?:\/\/[^\]]+)\]\]$/i);
  return match?.[1];
}

function hasImageMarker(lines: string[]): boolean {
  return lines.some((line) => Boolean(parseImageMarker(line)));
}

function parseFirstUrlFromSrcset(srcset: string | null): string | undefined {
  if (!srcset) {
    return undefined;
  }

  const firstCandidate = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .find((entry) => Boolean(entry));
  return firstCandidate || undefined;
}

function extractSnapshotImageUrl(node: Element, pageUrl: URL): string | undefined {
  const testId = node.closest("[data-testid]")?.getAttribute("data-testid")?.toLowerCase() ?? "";
  const rawCandidates = [
    node.getAttribute("src"),
    node.getAttribute("data-src"),
    node.getAttribute("data-image-url"),
    parseFirstUrlFromSrcset(node.getAttribute("srcset"))
  ];

  for (const candidate of rawCandidates) {
    if (!candidate || candidate.trim().length === 0) {
      continue;
    }

    const resolved = parseAbsoluteUrl(candidate.trim(), pageUrl);
    if (resolved && (
      /twimg\.com\/media/i.test(resolved) ||
      testId === "tweetphoto"
    )) {
      return resolved;
    }
  }

  return undefined;
}

function hasBoldFontWeight(style: string): boolean {
  if (!/font-weight\s*:/i.test(style)) {
    return false;
  }

  if (/font-weight\s*:\s*(bold|bolder)/i.test(style)) {
    return true;
  }

  const numericMatch = style.match(/font-weight\s*:\s*(\d{3})/i);
  if (!numericMatch) {
    return false;
  }

  const weight = Number.parseInt(numericMatch[1], 10);
  return Number.isFinite(weight) && weight >= 600;
}

function isRichListItemNode(node: Element): boolean {
  if (node.tagName.toLowerCase() === "li") {
    return true;
  }

  return node.classList.contains("longform-unordered-list-item") ||
    node.classList.contains("longform-ordered-list-item");
}

function getRichListTag(node: Element): "ul" | "ol" {
  if (node.classList.contains("longform-ordered-list-item")) {
    return "ol";
  }

  if (node.classList.contains("longform-unordered-list-item")) {
    return "ul";
  }

  return node.parentElement?.tagName.toLowerCase() === "ol" ? "ol" : "ul";
}

function isNestedInsideRichListItem(node: Element): boolean {
  const nearestListItem = node.closest("li, .longform-unordered-list-item, .longform-ordered-list-item");
  return Boolean(nearestListItem && nearestListItem !== node);
}

function normalizeDraftInlineHtml(node: Element): string {
  const clone = node.cloneNode(true) as Element;
  const allElements = [clone, ...clone.querySelectorAll("*")];

  for (const element of allElements) {
    const tagName = element.tagName.toLowerCase();
    const style = element.getAttribute("style") ?? "";
    const isBold = hasBoldFontWeight(style);
    if (tagName === "span") {
      if (isBold) {
        const strong = clone.ownerDocument.createElement("strong");
        strong.innerHTML = element.innerHTML;
        if (element === clone) {
          element.replaceChildren(strong);
        } else {
          element.replaceWith(strong);
        }
        continue;
      }

      if (element !== clone) {
        element.replaceWith(...Array.from(element.childNodes));
      }
      continue;
    }

    if (isBold && tagName !== "strong" && tagName !== "b") {
      const strong = clone.ownerDocument.createElement("strong");
      strong.innerHTML = element.innerHTML;
      element.replaceChildren(strong);
    }

    for (const attr of element.getAttributeNames()) {
      if (tagName === "a" && attr.toLowerCase() === "href") {
        continue;
      }
      if (tagName === "img" && (attr.toLowerCase() === "src" || attr.toLowerCase() === "alt")) {
        continue;
      }
      element.removeAttribute(attr);
    }
  }

  return clone.innerHTML.trim();
}

function unwrapSingleDraftBlockWrapper(html: string): string {
  let unwrapped = html.trim();
  for (let index = 0; index < 2; index += 1) {
    if (/<\/(?:div|section)>\s*<(?:div|section)>/i.test(unwrapped)) {
      break;
    }
    const match = unwrapped.match(/^<(div|section)>([\s\S]*)<\/\1>$/i);
    if (!match) {
      break;
    }
    unwrapped = match[2].trim();
  }
  return unwrapped;
}

function sanitizeHeadingInlineHtml(inputHtml: string, fallbackText: string): string {
  const trimmed = inputHtml.trim();
  if (trimmed.length === 0) {
    return escapeHtml(normalizeWhitespace(fallbackText));
  }

  try {
    const dom = new JSDOM(`<body><div id="heading-root">${trimmed}</div></body>`);
    const root = dom.window.document.querySelector("#heading-root");
    if (!root) {
      return escapeHtml(normalizeWhitespace(fallbackText));
    }

    const blockSelector = "div, section, article, main, p, ul, ol, li, blockquote, pre, h1, h2, h3, h4, h5, h6";
    for (let pass = 0; pass < 3; pass += 1) {
      const blockNodes = [...root.querySelectorAll(blockSelector)];
      if (blockNodes.length === 0) {
        break;
      }
      for (const blockNode of blockNodes) {
        blockNode.replaceWith(...Array.from(blockNode.childNodes));
      }
    }

    const normalizedText = normalizeWhitespace(root.textContent ?? "");
    if (normalizedText.length === 0) {
      return escapeHtml(normalizeWhitespace(fallbackText));
    }

    // Keep headings as plain text to avoid markdown renderers showing literal ** markers.
    return escapeHtml(normalizedText);
  } catch {
    return escapeHtml(normalizeWhitespace(fallbackText));
  }
}

function tryExtractFromLinkedHtmlRich(page: FetchLinkedPage): ExtractedMainContent | undefined {
  if (!isXArticleUrl(page.url) || !page.html || page.html.trim().length === 0) {
    return undefined;
  }

  const sanitizedHtml = stripStyleBlocks(page.html);
  let dom: JSDOM;
  try {
    dom = new JSDOM(sanitizedHtml, { url: page.url });
  } catch {
    return undefined;
  }

  const root = dom.window.document.querySelector("[data-testid='twitterArticleReadView']") ??
    dom.window.document.querySelector("main article") ??
    dom.window.document.querySelector("article") ??
    dom.window.document.querySelector("main");
  if (!root) {
    return undefined;
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(page.url);
  } catch {
    return undefined;
  }

  const blocks = [...root.querySelectorAll(
    "[data-testid='twitter-article-title'], [data-testid='tweetPhoto'] img, [data-testid='longformRichTextComponent'] li, [data-testid='longformRichTextComponent'] .longform-unordered-list-item, [data-testid='longformRichTextComponent'] .longform-ordered-list-item, [data-testid='longformRichTextComponent'] .longform-unstyled, [data-testid='longformRichTextComponent'] pre, [data-testid='markdown-code-block'] pre, h1, h2, h3, p, blockquote, li, .longform-unordered-list-item, .longform-ordered-list-item, .longform-unstyled, pre, img"
  )]
    .filter((node) => {
      if (node.matches(".longform-unstyled") && isNestedInsideRichListItem(node)) {
        return false;
      }
      if (node.tagName.toLowerCase() === "p" && isNestedInsideRichListItem(node)) {
        return false;
      }
      return true;
    });
  if (blocks.length === 0) {
    return undefined;
  }

  const contentParts: string[] = [];
  const excerptParts: string[] = [];

  for (let index = 0; index < blocks.length;) {
    const node = blocks[index];
    const tagName = node.tagName.toLowerCase();

    if (tagName === "img") {
      const imageUrl = extractSnapshotImageUrl(node, pageUrl);
      if (imageUrl) {
        contentParts.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
      }
      index += 1;
      continue;
    }

    if (isRichListItemNode(node)) {
      const listParent = node.parentElement;
      const listTag = getRichListTag(node);
      const items: string[] = [];
      while (
        index < blocks.length &&
        isRichListItemNode(blocks[index]) &&
        blocks[index].parentElement === listParent &&
        getRichListTag(blocks[index]) === listTag
      ) {
        const itemNode = blocks[index];
        const itemHtml = unwrapSingleDraftBlockWrapper(normalizeDraftInlineHtml(itemNode));
        const itemText = normalizeWhitespace(itemNode.textContent ?? "");
        if (itemText.length > 0) {
          items.push(`<li>${itemHtml.length > 0 ? itemHtml : escapeHtml(itemText)}</li>`);
          excerptParts.push(itemText);
        }
        index += 1;
      }
      if (items.length > 0) {
        contentParts.push(`<${listTag}>${items.join("")}</${listTag}>`);
      }
      continue;
    }

    if (tagName === "pre") {
      const codeText = node.textContent?.replace(/\r/g, "").trim() ?? "";
      if (codeText.length > 0) {
        contentParts.push(`<pre><code>${escapeHtml(codeText)}</code></pre>`);
        excerptParts.push(codeText.slice(0, 200));
      }
      index += 1;
      continue;
    }

    if (node.matches(".longform-unstyled") && isNestedInsideRichListItem(node)) {
      index += 1;
      continue;
    }

    const rawText = normalizeWhitespace(node.textContent ?? "");
    if (rawText.length === 0) {
      index += 1;
      continue;
    }

    const unorderedMarkerMatch = rawText.match(/^-\s+(.+)$/);
    const orderedMarkerMatch = rawText.match(/^\d+\.\s+(.+)$/);
    if (unorderedMarkerMatch || orderedMarkerMatch) {
      const ordered = Boolean(orderedMarkerMatch);
      const markerPattern = ordered ? /^\s*\d+\.\s+/ : /^\s*-\s+/;
      const listTag = ordered ? "ol" : "ul";
      const items: string[] = [];

      while (index < blocks.length) {
        const listNode = blocks[index];
        if (isRichListItemNode(listNode) || listNode.tagName.toLowerCase() === "img" || listNode.tagName.toLowerCase() === "pre") {
          break;
        }

        const listText = normalizeWhitespace(listNode.textContent ?? "");
        const isMatchingListLine = ordered
          ? /^\d+\.\s+(.+)$/.test(listText)
          : /^-\s+(.+)$/.test(listText);
        if (!isMatchingListLine) {
          break;
        }

        const listInlineHtml = unwrapSingleDraftBlockWrapper(normalizeDraftInlineHtml(listNode));
        const itemHtml = listInlineHtml.replace(markerPattern, "").trim();
        const itemText = listText.replace(markerPattern, "").trim();
        if (itemText.length > 0) {
          items.push(`<li>${itemHtml.length > 0 ? itemHtml : escapeHtml(itemText)}</li>`);
          excerptParts.push(itemText);
        }
        index += 1;
      }

      if (items.length > 0) {
        contentParts.push(`<${listTag}>${items.join("")}</${listTag}>`);
        continue;
      }
    }

    const inlineHtml = unwrapSingleDraftBlockWrapper(normalizeDraftInlineHtml(node));
    const headingHtml = sanitizeHeadingInlineHtml(inlineHtml, rawText);
    if (node.getAttribute("data-testid") === "twitter-article-title" || tagName === "h1") {
      contentParts.push(`<h1>${headingHtml}</h1>`);
    } else if (tagName === "h2" || tagName === "h3") {
      contentParts.push(`<${tagName}>${headingHtml}</${tagName}>`);
    } else if (tagName === "blockquote") {
      contentParts.push(`<blockquote>${inlineHtml.length > 0 ? inlineHtml : escapeHtml(rawText)}</blockquote>`);
    } else {
      contentParts.push(`<p>${inlineHtml.length > 0 ? inlineHtml : escapeHtml(rawText)}</p>`);
    }
    excerptParts.push(rawText);
    index += 1;
  }

  if (contentParts.length === 0) {
    return undefined;
  }

  const hasNonTitleContent = contentParts.some((part) => !part.startsWith("<h1>"));
  if (!hasNonTitleContent) {
    return undefined;
  }

  const excerptText = normalizeWhitespace(excerptParts.join(" "));
  if (excerptText.length < 40 || hasBlockedMarker(excerptText)) {
    return undefined;
  }

  const titleFromArticle = normalizeWhitespace(
    root.querySelector("[data-testid='twitter-article-title']")?.textContent ?? ""
  );
  const titleCandidate = cleanLinkedTitle(page.title) ??
    (titleFromArticle.length > 0 ? titleFromArticle : undefined) ??
    excerptParts[0]?.slice(0, 160);
  if (!titleCandidate) {
    return undefined;
  }

  return {
    title: titleCandidate,
    contentHtml: contentParts.join(""),
    excerpt: excerptText.slice(0, 280)
  };
}

function chooseSnapshotLines(input: {
  textLines: string[];
  htmlLines: string[];
}): string[] {
  const { textLines, htmlLines } = input;
  if (textLines.length === 0) {
    return htmlLines;
  }
  if (htmlLines.length === 0) {
    return textLines;
  }

  const textLength = normalizeWhitespace(textLines.join(" ")).length;
  const htmlLength = normalizeWhitespace(htmlLines.join(" ")).length;
  const textHasImages = hasImageMarker(textLines);
  const htmlHasImages = hasImageMarker(htmlLines);

  if (htmlHasImages && !textHasImages && htmlLength >= 40) {
    return htmlLines;
  }

  if (textLength < 40 && htmlLength >= textLength) {
    return htmlLines;
  }

  return textLines;
}

function extractLinkedSnapshotLinesFromHtml(page: FetchLinkedPage): string[] {
  if (!page.html || page.html.trim().length === 0) {
    return [];
  }

  const sanitizedHtml = stripStyleBlocks(page.html);
  let dom: JSDOM;
  try {
    dom = new JSDOM(sanitizedHtml, { url: page.url });
  } catch {
    return [];
  }

  const candidates = [...dom.window.document.querySelectorAll("main article, article")];
  const mainRoot = dom.window.document.querySelector("main");
  if (mainRoot && !candidates.includes(mainRoot)) {
    candidates.push(mainRoot);
  }
  if (candidates.length === 0) {
    return [];
  }

  const bestRoot = [...candidates]
    .map((root) => ({
      root,
      score: normalizeWhitespace(root.textContent ?? "").length +
        (root.querySelectorAll("img").length * 300) +
        (root.querySelectorAll("[data-testid='markdown-code-block']").length * 120)
    }))
    .sort((left, right) => right.score - left.score)[0]?.root;

  if (!bestRoot) {
    return [];
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(page.url);
  } catch {
    return [];
  }

  const blocks = [...bestRoot.querySelectorAll(
    "h1, h2, h3, p, li, blockquote, pre, .longform-unstyled, img, [data-testid='twitter-article-title'], [data-testid='markdown-code-block'], [data-testid='tweetText'], [data-testid='tweetPhoto'] img"
  )];

  const lines: string[] = [];
  for (const block of blocks) {
    if (block.tagName.toLowerCase() === "img") {
      const imageUrl = extractSnapshotImageUrl(block, pageUrl);
      if (imageUrl) {
        lines.push(`[[IMAGE:${imageUrl}]]`);
      }
      continue;
    }

    const text = normalizeWhitespace(block.textContent ?? "");
    if (text.length > 0) {
      lines.push(text);
    }
  }

  if (lines.length === 0) {
    return [];
  }

  return cleanLinkedTextSnapshot(lines.join("\n"));
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
    const imageUrl = parseImageMarker(line);
    if (imageUrl) {
      html.push(`<p><img src="${escapeHtml(imageUrl)}" alt="" /></p>`);
      index += 1;
      continue;
    }

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
  if (!isXArticleUrl(page.url)) {
    return undefined;
  }

  const richExtracted = tryExtractFromLinkedHtmlRich(page);
  if (richExtracted) {
    return richExtracted;
  }

  const textLines = page.text ? cleanLinkedTextSnapshot(page.text) : [];
  const htmlLines = extractLinkedSnapshotLinesFromHtml(page);
  const cleanedLines = chooseSnapshotLines({
    textLines,
    htmlLines
  });
  if (cleanedLines.length === 0) {
    return undefined;
  }

  const cleanedText = cleanedLines.join(" ");
  if (cleanedText.length < 40 || hasBlockedMarker(cleanedText)) {
    return undefined;
  }

  const firstHtmlTextLine = htmlLines.find((line) => !parseImageMarker(line));
  const firstTextLine = cleanedLines.find((line) => !parseImageMarker(line));
  const titleCandidate = cleanLinkedTitle(page.title) ??
    firstHtmlTextLine?.slice(0, 160) ??
    firstTextLine?.slice(0, 160);
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
    const dom = new JSDOM(stripStyleBlocks(input.html), { url: finalUrl.toString() });
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
