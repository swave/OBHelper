import { ObfronterError } from "../core/errors.js";
import { detectSourcePlatform, isXStatusUrl } from "../core/url-source.js";
import type { CapturedCodeBlock, FetchLinkedPage, FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";
import { waitForFetchedPageContentReady } from "./x-ready.js";

interface CdpPageLike {
  goto: (
    url: string,
    options: { timeout: number; waitUntil: "domcontentloaded" | "networkidle" | "commit" | "load" }
  ) => Promise<{ status: () => number } | null>;
  waitForSelector: (
    selector: string,
    options: { state: "attached"; timeout: number }
  ) => Promise<unknown>;
  evaluate: (callback: () => unknown) => Promise<unknown>;
  content: () => Promise<string>;
  url: () => string;
  close: () => Promise<void>;
}

interface CdpContextLike {
  newPage: () => Promise<CdpPageLike>;
}

interface CdpBrowserLike {
  contexts: () => CdpContextLike[];
  close: () => Promise<void>;
}

interface PlaywrightLike {
  chromium: {
    connectOverCDP: (endpointURL: string) => Promise<CdpBrowserLike>;
  };
}

interface CdpVersionResponse {
  webSocketDebuggerUrl?: string;
}

type FetchCdpVersion = (endpointURL: string, timeoutMs: number) => Promise<CdpVersionResponse | undefined>;

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeCapturedCodeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeAnchorText(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }

  const normalized = raw.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : undefined;
}

async function captureCodeBlocksFromPage(page: CdpPageLike): Promise<CapturedCodeBlock[]> {
  try {
    const snapshot = await page.evaluate(() => {
      const LINE_CONTAINER_TAGS = new Set(["DIV", "P", "LI"]);
      const ANCHOR_SELECTOR = "h1,h2,h3,h4,h5,h6,p,li,blockquote";
      const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

      const toText = (element: Element): string => {
        const clone = element.cloneNode(true) as Element;
        const directChildren = Array.from(clone.children);
        const looksLikeLineContainer =
          directChildren.length > 0 &&
          directChildren.every((child) => LINE_CONTAINER_TAGS.has(child.tagName.toUpperCase()));
        if (looksLikeLineContainer) {
          for (let index = 0; index < directChildren.length; index += 1) {
            if (index < directChildren.length - 1) {
              directChildren[index].insertAdjacentText("afterend", "\n");
            }
          }
        }

        for (const br of Array.from(clone.querySelectorAll("br"))) {
          br.replaceWith("\n");
        }

        return clone.textContent ?? "";
      };

      const findContextAnchor = (target: Element): { beforeText?: string; afterText?: string } => {
        const blocks = Array.from(document.querySelectorAll(ANCHOR_SELECTOR));
        let beforeText: string | undefined;
        let afterText: string | undefined;
        for (const block of blocks) {
          if (target.contains(block) || block.contains(target)) {
            continue;
          }

          const blockText = normalizeText(block.textContent ?? "");
          if (blockText.length < 8) {
            continue;
          }

          const position = block.compareDocumentPosition(target);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
            beforeText = blockText;
            continue;
          }

          if (!afterText && (position & Node.DOCUMENT_POSITION_PRECEDING)) {
            afterText = blockText;
            break;
          }
        }

        return {
          beforeText,
          afterText
        };
      };

      const blocks: Array<{ text: string; beforeText?: string; afterText?: string }> = [];
      const seen = new Set<string>();
      const candidates = Array.from(document.querySelectorAll("pre, [data-testid='markdown-code-block']"));
      for (const node of candidates) {
        const codeNode = node.matches("pre") ? (node.querySelector("code") ?? node) : node;
        const raw = toText(codeNode as Element)
          .replace(/\r\n?/g, "\n")
          .replace(/\u00A0/g, " ")
          .trim();
        if (raw.length < 10) {
          continue;
        }
        if (!raw.includes("\n") && raw.split(/\s+/).length < 3) {
          continue;
        }

        if (!seen.has(raw)) {
          seen.add(raw);
          const context = findContextAnchor(node);
          blocks.push({
            text: raw,
            ...(context.beforeText ? { beforeText: context.beforeText } : {}),
            ...(context.afterText ? { afterText: context.afterText } : {})
          });
        }
      }

      return blocks;
    });

    if (!Array.isArray(snapshot)) {
      return [];
    }

    const unique = new Map<string, CapturedCodeBlock>();
    for (const entry of snapshot) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const rawText = Reflect.get(entry, "text");
      if (typeof rawText !== "string") {
        continue;
      }

      const normalized = normalizeCapturedCodeText(rawText);
      if (normalized.length < 10) {
        continue;
      }
      if (!normalized.includes("\n") && normalized.split(/\s+/).length < 3) {
        continue;
      }

      const beforeText = normalizeAnchorText(
        typeof Reflect.get(entry, "beforeText") === "string"
          ? (Reflect.get(entry, "beforeText") as string)
          : undefined
      );
      const afterText = normalizeAnchorText(
        typeof Reflect.get(entry, "afterText") === "string"
          ? (Reflect.get(entry, "afterText") as string)
          : undefined
      );

      unique.set(normalized, {
        text: normalized,
        ...(beforeText ? { beforeText } : {}),
        ...(afterText ? { afterText } : {})
      });
    }

    return [...unique.values()];
  } catch {
    return [];
  }
}

async function defaultLoadPlaywright(): Promise<PlaywrightLike> {
  const moduleName = "playwright";

  try {
    return (await import(moduleName)) as PlaywrightLike;
  } catch {
    throw new ObfronterError(
      "PLAYWRIGHT_MISSING",
      "playwright is not installed. Install it and rerun in CDP mode."
    );
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function toVersionEndpoint(endpointURL: string): string {
  const trimmed = endpointURL.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/json/version")) {
    return trimmed;
  }

  return `${trimmed}/json/version`;
}

function isHttpEndpoint(endpointURL: string): boolean {
  const lower = endpointURL.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://");
}

async function defaultFetchCdpVersion(endpointURL: string, timeoutMs: number): Promise<CdpVersionResponse | undefined> {
  if (!isHttpEndpoint(endpointURL)) {
    return undefined;
  }

  const versionURL = toVersionEndpoint(endpointURL);

  try {
    const response = await fetch(versionURL, {
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(Math.min(timeoutMs, 8_000))
    });
    if (!response.ok) {
      return undefined;
    }

    const payload = await response.json() as Record<string, unknown>;
    const webSocketDebuggerUrl = typeof payload.webSocketDebuggerUrl === "string"
      ? payload.webSocketDebuggerUrl
      : undefined;

    return {
      webSocketDebuggerUrl
    };
  } catch {
    return undefined;
  }
}

function tryParseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function isXLikeHost(inputUrl: string): boolean {
  const parsed = tryParseUrl(inputUrl);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  return host === "x.com" || host.endsWith(".x.com") ||
    host === "twitter.com" || host.endsWith(".twitter.com");
}

function isXArticleUrl(inputUrl: string): boolean {
  const parsed = tryParseUrl(inputUrl);
  if (!parsed) {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (!(host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) {
    return false;
  }

  return /\/article\/[0-9A-Za-z_]+/i.test(parsed.pathname);
}

function shouldCollectLinkedPages(requestedUrl: string, finalUrl: string): boolean {
  const requested = tryParseUrl(requestedUrl);
  const final = tryParseUrl(finalUrl);
  const isXStatus = (url: URL | undefined): boolean => {
    if (!url) {
      return false;
    }

    return detectSourcePlatform(url) === "x" && isXStatusUrl(url);
  };

  return isXStatus(requested) || isXStatus(final);
}

function normalizeLinkCandidates(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && /^https?:\/\//i.test(entry));
}

function normalizeLinkedPageText(input: string): string {
  return input
    .replaceAll("\u00a0", " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function gotoWithRetry(input: {
  page: CdpPageLike;
  url: string;
  timeoutMs: number;
  maxAttempts?: number;
}): Promise<{ status: () => number } | null> {
  const waitUntilStrategies = ["domcontentloaded", "commit", "load"] as const;
  const maxAttempts = Math.max(1, Math.min(input.maxAttempts ?? waitUntilStrategies.length, waitUntilStrategies.length));

  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const waitUntil = waitUntilStrategies[attempt];
    try {
      return await input.page.goto(input.url, {
        timeout: input.timeoutMs,
        waitUntil
      });
    } catch (error) {
      lastError = error;
      const message = summarizeError(error).toLowerCase();
      const retryableTimeout = message.includes("timed_out") ||
        message.includes("timeout") ||
        message.includes("net::err_timed_out");

      if (!retryableTimeout || attempt >= maxAttempts - 1) {
        throw error;
      }

      await sleep(350 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Navigation failed");
}

async function collectLinkedPageTextSnapshot(
  page: CdpPageLike,
  timeoutMs: number,
  requireLongText: boolean
): Promise<{ title?: string; text?: string; richHtml?: string }> {
  const waitBudgetMs = Math.min(timeoutMs, 10_000);
  const deadline = Date.now() + waitBudgetMs;
  let bestTitle = "";
  let bestText = "";
  let bestRichHtml = "";
  let bestTextSampleCount = 0;
  let attempts = 0;
  let nonEmptyTextSamples = 0;
  let bestTextLengthCheckpoint = 0;
  let stagnantTextAttempts = 0;

  do {
    attempts += 1;
    let snapshot: unknown;
    try {
      snapshot = await page.evaluate(() => {
        const normalize = (value: string): string =>
          value
            .replaceAll("\u00a0", " ")
            .replace(/\r/g, "")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        const escapeHtml = (value: string): string =>
          value
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;");
        const escapeAttribute = (value: string): string => escapeHtml(value).replaceAll("\"", "&quot;");
        const hasBoldFontWeight = (value: string): boolean => {
          const normalized = value.trim().toLowerCase();
          if (normalized === "bold" || normalized === "bolder") {
            return true;
          }

          const numeric = Number.parseInt(normalized, 10);
          return Number.isFinite(numeric) && numeric >= 600;
        };
        const toText = (node: Element): string => {
          const raw = (node as HTMLElement).innerText ?? node.textContent ?? "";
          return normalize(raw);
        };
        const serializeNodeInnerHtmlWithComputedBold = (node: Element): string => {
          const rawInnerHtml = (node as HTMLElement).innerHTML?.trim() ?? "";
          if (rawInnerHtml.length === 0) {
            return "";
          }

          const clone = node.cloneNode(true) as Element;
          const sourceElements = [node, ...Array.from(node.querySelectorAll("*"))];
          const cloneElements = [clone, ...Array.from(clone.querySelectorAll("*"))];
          const pairCount = Math.min(sourceElements.length, cloneElements.length);

          for (let index = 0; index < pairCount; index += 1) {
            const sourceElement = sourceElements[index];
            const cloneElement = cloneElements[index];
            const computedWeight = window.getComputedStyle(sourceElement).fontWeight ?? "";
            if (!hasBoldFontWeight(computedWeight)) {
              continue;
            }

            const cloneTag = cloneElement.tagName.toLowerCase();
            if (cloneTag === "strong" || cloneTag === "b") {
              continue;
            }

            const strong = document.createElement("strong");
            strong.innerHTML = cloneElement.innerHTML;
            if (cloneTag === "span") {
              if (cloneElement === clone) {
                cloneElement.replaceChildren(strong);
              } else {
                cloneElement.replaceWith(strong);
              }
              continue;
            }

            cloneElement.replaceChildren(strong);
          }

          return clone.innerHTML.trim();
        };
        const isRichListItemNode = (node: Element): boolean => {
          if (node.tagName.toLowerCase() === "li") {
            return true;
          }
          return node.classList.contains("longform-unordered-list-item") ||
            node.classList.contains("longform-ordered-list-item");
        };
        const isNestedInsideRichListItem = (node: Element): boolean => {
          const nearestListItem = node.closest("li, .longform-unordered-list-item, .longform-ordered-list-item");
          return Boolean(nearestListItem && nearestListItem !== node);
        };
        const walkElementsDeep = (root: Node, visit: (element: Element) => void): void => {
          for (const childNode of Array.from(root.childNodes)) {
            if (!(childNode instanceof Element)) {
              continue;
            }
            visit(childNode);
            const shadowRoot = (childNode as HTMLElement).shadowRoot;
            if (shadowRoot) {
              walkElementsDeep(shadowRoot, visit);
            }
            walkElementsDeep(childNode, visit);
          }
        };
        const collectElementsDeep = (root: Node, predicate: (element: Element) => boolean): Element[] => {
          const collected: Element[] = [];
          if (root instanceof Element && predicate(root)) {
            collected.push(root);
          }
          walkElementsDeep(root, (element) => {
            if (predicate(element)) {
              collected.push(element);
            }
          });
          return collected;
        };
        const isBlockNode = (node: Element): boolean => {
          const tagName = node.tagName.toLowerCase();
          if (tagName === "h1" || tagName === "h2" || tagName === "h3" || tagName === "p" || tagName === "li" || tagName === "blockquote" || tagName === "pre" || tagName === "img" || tagName === "source") {
            return true;
          }
          const testId = node.getAttribute("data-testid")?.toLowerCase() ?? "";
          if (testId === "twitter-article-title" || testId === "markdown-code-block") {
            return true;
          }
          if (node.classList.contains("longform-unstyled") || node.classList.contains("longform-unordered-list-item") || node.classList.contains("longform-ordered-list-item")) {
            return true;
          }
          return node.getAttribute("style")?.includes("background-image") ?? false;
        };
        const toAbsoluteUrl = (rawUrl: string): string => {
          try {
            return new URL(rawUrl, window.location.href).toString();
          } catch {
            return "";
          }
        };
        const toHttpUrl = (rawUrl: string): string => {
          const resolved = toAbsoluteUrl(rawUrl);
          return /^https?:\/\//i.test(resolved) ? resolved : "";
        };
        const firstSrcsetUrl = (rawSrcset: string | null): string => {
          if (!rawSrcset) {
            return "";
          }

          const first = rawSrcset
            .split(",")
            .map((entry) => entry.trim().split(/\s+/)[0])
            .find((entry) => entry && entry.length > 0);
          return first ?? "";
        };
        const extractBackgroundImageUrl = (styleValue: string | null): string => {
          if (!styleValue) {
            return "";
          }

          const match = styleValue.match(/url\((['"]?)(.*?)\1\)/i);
          if (!match) {
            return "";
          }

          return match[2]?.trim() ?? "";
        };
        const extractInlineImageUrl = (node: Element): string => {
          const imageNode = node as HTMLImageElement;
          const candidateUrls = [
            imageNode.currentSrc,
            node.getAttribute("src"),
            node.getAttribute("data-src"),
            node.getAttribute("data-image-url"),
            firstSrcsetUrl(node.getAttribute("srcset")),
            extractBackgroundImageUrl(node.getAttribute("style"))
          ];

          for (const candidate of candidateUrls) {
            if (!candidate || candidate.trim().length === 0) {
              continue;
            }

            const resolved = toHttpUrl(candidate.trim());
            if (resolved.length > 0 && (
              /twimg\.com\/media/i.test(resolved) ||
              (node.closest("[data-testid]")?.getAttribute("data-testid")?.toLowerCase() ?? "") === "tweetphoto"
            )) {
              return resolved;
            }
          }

          return "";
        };
        const candidateContainerRoot = document.body ?? document.documentElement;
        const contentRootCandidates = collectElementsDeep(
          candidateContainerRoot,
          (node) => node.getAttribute("data-testid")?.toLowerCase() === "twitterarticlereadview" ||
            node.matches("main article, article, main")
        );
        const scoreRoot = (root: Element): number => {
          const textScore = toText(root).length;
          const titleScore = collectElementsDeep(root, (node) => node.getAttribute("data-testid")?.toLowerCase() === "twitter-article-title").length * 200;
          const codeScore = collectElementsDeep(root, (node) => node.getAttribute("data-testid")?.toLowerCase() === "markdown-code-block").length * 120;
          return textScore + titleScore + codeScore;
        };
        const contentRoot = contentRootCandidates.length > 0
          ? [...contentRootCandidates].sort((left, right) => scoreRoot(right) - scoreRoot(left))[0]
          : candidateContainerRoot;
        const blockNodes = collectElementsDeep(contentRoot, (node) => isBlockNode(node))
          .filter((node) => {
            if (node.matches(".longform-unstyled") && isNestedInsideRichListItem(node)) {
              return false;
            }
            if (node.tagName.toLowerCase() === "p" && isNestedInsideRichListItem(node)) {
              return false;
            }
            return true;
          });
        const structuredBlocks = blockNodes
          .map((node) => {
            const tagName = node.tagName.toLowerCase();
            const shouldTreatAsImage = tagName === "img" ||
              tagName === "source" ||
              node.getAttribute("style")?.includes("background-image");
            if (shouldTreatAsImage) {
              const resolved = extractInlineImageUrl(node);
              return resolved.length > 0 ? `[[IMAGE:${resolved}]]` : "";
            }
            const text = toText(node);
            if (text.length === 0) {
              return "";
            }
            if (isRichListItemNode(node)) {
              return `- ${text}`;
            }
            return text;
          })
          .filter((text) => text.length > 0)
          .filter((text, index, all) => index === 0 || text !== all[index - 1]);
        const richHtmlParts: string[] = [];
        const appendRichHtml = (value: string): void => {
          const trimmed = value.trim();
          if (trimmed.length === 0) {
            return;
          }
          if (richHtmlParts[richHtmlParts.length - 1] === trimmed) {
            return;
          }
          richHtmlParts.push(trimmed);
        };
        let emittedTitle = false;
        for (const node of blockNodes) {
          const tagName = node.tagName.toLowerCase();
          const testId = node.getAttribute("data-testid")?.toLowerCase() ?? "";
          const shouldTreatAsImage = tagName === "img" ||
            tagName === "source" ||
            node.getAttribute("style")?.includes("background-image");
          if (shouldTreatAsImage) {
            const resolved = extractInlineImageUrl(node);
            if (resolved.length > 0) {
              appendRichHtml(`<img src="${escapeAttribute(resolved)}" alt="" />`);
            }
            continue;
          }

          const rawText = toText(node);
          if (rawText.length === 0) {
            continue;
          }
          const styledInnerHtml = serializeNodeInnerHtmlWithComputedBold(node);
          const safeInnerHtml = styledInnerHtml.length > 0 ? styledInnerHtml : escapeHtml(rawText);

          if (!emittedTitle && (testId === "twitter-article-title" || tagName === "h1")) {
            appendRichHtml(`<div data-testid="twitter-article-title">${safeInnerHtml}</div>`);
            emittedTitle = true;
            continue;
          }

          if (testId === "markdown-code-block" || tagName === "pre") {
            appendRichHtml(`<pre>${escapeHtml(rawText.replace(/\r/g, ""))}</pre>`);
            continue;
          }

          if (isRichListItemNode(node)) {
            const className = node.classList.contains("longform-ordered-list-item")
              ? "longform-ordered-list-item"
              : node.classList.contains("longform-unordered-list-item")
                ? "longform-unordered-list-item"
                : "";
            const classAttribute = className.length > 0 ? ` class="${className}"` : "";
            appendRichHtml(`<li${classAttribute}>${safeInnerHtml}</li>`);
            continue;
          }

          if (tagName === "blockquote") {
            appendRichHtml(`<blockquote>${safeInnerHtml}</blockquote>`);
            continue;
          }

          if (tagName === "h1" || tagName === "h2" || tagName === "h3") {
            appendRichHtml(`<${tagName}>${safeInnerHtml}</${tagName}>`);
            continue;
          }

          if (tagName === "p") {
            appendRichHtml(`<p>${safeInnerHtml}</p>`);
            continue;
          }

          appendRichHtml(`<div class="longform-unstyled">${safeInnerHtml}</div>`);
        }

        const richHtml = richHtmlParts.length > 0
          ? `<main data-testid="twitterArticleReadView">${richHtmlParts.join("")}</main>`
          : "";
        const structuredText = structuredBlocks.join("\n\n");
        const bodyText = normalize(document.body?.innerText ?? "");

        return {
          title: normalize(document.title ?? ""),
          text: structuredText.length >= 120 ? structuredText : bodyText,
          richHtml
        };
      });
    } catch {
      break;
    }

    if (snapshot && typeof snapshot === "object") {
      const record = snapshot as Record<string, unknown>;
      const titleCandidate = typeof record.title === "string"
        ? normalizeLinkedPageText(record.title)
        : "";
      const textCandidate = typeof record.text === "string"
        ? normalizeLinkedPageText(record.text)
        : "";
      const richHtmlCandidate = typeof record.richHtml === "string"
        ? record.richHtml.trim()
        : "";

      if (titleCandidate.length > bestTitle.length) {
        bestTitle = titleCandidate;
      }
      if (richHtmlCandidate.length > bestRichHtml.length) {
        bestRichHtml = richHtmlCandidate;
      }
      if (textCandidate.length > 0) {
        nonEmptyTextSamples += 1;
      }
      if (textCandidate.length > bestText.length || (
        textCandidate.length === bestText.length && nonEmptyTextSamples > bestTextSampleCount
      )) {
        bestText = textCandidate;
        bestTextSampleCount = nonEmptyTextSamples;
      }

      if (bestText.length > bestTextLengthCheckpoint) {
        bestTextLengthCheckpoint = bestText.length;
        stagnantTextAttempts = 0;
      } else {
        stagnantTextAttempts += 1;
      }
    }

    const enoughText = requireLongText
      ? bestText.length >= 300 && nonEmptyTextSamples >= 3
      : bestText.length > 0 || bestTitle.length > 0;
    const stableNonEmptyText = requireLongText
      ? bestText.length >= 600 && nonEmptyTextSamples >= 3
      : nonEmptyTextSamples >= 1;
    const stalledLongText = requireLongText
      ? bestText.length >= 40 && nonEmptyTextSamples >= 3 && stagnantTextAttempts >= 4
      : false;
    if (enoughText || stableNonEmptyText || stalledLongText || attempts >= 25 || Date.now() >= deadline) {
      break;
    }

    if (requireLongText) {
      try {
        await page.evaluate(() => {
          window.scrollBy(0, Math.max(window.innerHeight * 0.6, 500));
          return undefined;
        });
      } catch {
        // Best effort only.
      }
    }

    await sleep(requireLongText ? 700 : 400);
  } while (true);

  return {
    ...(bestTitle.length > 0 ? { title: bestTitle } : {}),
    ...(bestText.length > 0 ? { text: bestText } : {}),
    ...(bestRichHtml.length > 0 ? { richHtml: bestRichHtml } : {})
  };
}

async function collectLinkedPageSnapshots(input: {
  context: CdpContextLike;
  page: CdpPageLike;
  requestedUrl: string;
  timeoutMs: number;
}): Promise<FetchLinkedPage[]> {
  if (!shouldCollectLinkedPages(input.requestedUrl, input.page.url())) {
    return [];
  }

  try {
    await input.page.waitForSelector("a[href*='t.co/'], a[href*='/article/']", {
      state: "attached",
      timeout: Math.min(input.timeoutMs, 5_000)
    });
  } catch {
    // Continue and attempt best-effort evaluation.
  }

  let evaluatedLinks: unknown;
  try {
    evaluatedLinks = await input.page.evaluate(() => {
      const anchorLinks = [...document.querySelectorAll("article [data-testid='tweetText'] a[href]")]
        .map((link) => link.getAttribute("href")?.trim())
        .filter((href): href is string => Boolean(href))
        .map((href) => {
          try {
            return new URL(href, window.location.href).toString();
          } catch {
            return "";
          }
        })
        .filter((href) => href.length > 0);
      const articleLinks = [...document.querySelectorAll("a[href*='/article/']")]
        .map((link) => link.getAttribute("href")?.trim())
        .filter((href): href is string => Boolean(href))
        .map((href) => {
          try {
            return new URL(href, window.location.href).toString();
          } catch {
            return "";
          }
        })
        .map((href) => {
          const articleMatch = href.match(/^(https?:\/\/[^/]+\/[^/]+\/article\/[0-9A-Za-z_]+)/i);
          return articleMatch?.[1] ?? "";
        })
        .filter((href) => href.length > 0);
      const tcoLinks = [...document.querySelectorAll("a[href*='t.co/']")]
        .map((link) => link.getAttribute("href")?.trim())
        .filter((href): href is string => Boolean(href))
        .map((href) => {
          try {
            return new URL(href, window.location.href).toString();
          } catch {
            return "";
          }
        })
        .filter((href) => href.length > 0);
      const tweetText = (document.querySelector("article [data-testid='tweetText']")?.textContent ?? "").trim();
      const textLinks = tweetText.match(/https?:\/\/\S+/g) ?? [];
      const normalizedTextLinks = textLinks.map((url) => url.replace(/[).,!?:;]+$/g, ""));
      const metaDescription = (
        document.querySelector("meta[property='og:description']")?.getAttribute("content") ??
        document.querySelector("meta[name='twitter:description']")?.getAttribute("content") ??
        ""
      ).trim();
      const metaLinks = metaDescription.match(/https?:\/\/\S+/g) ?? [];
      const normalizedMetaLinks = metaLinks.map((url) => url.replace(/[).,!?:;]+$/g, ""));

      return [...new Set([...articleLinks, ...anchorLinks, ...tcoLinks, ...normalizedTextLinks, ...normalizedMetaLinks])];
    });
  } catch {
    return [];
  }

  const linkCandidates = normalizeLinkCandidates(evaluatedLinks).slice(0, 3);
  if (linkCandidates.length === 0) {
    return [];
  }

  const linkedPages: FetchLinkedPage[] = [];
  const seenFinalUrls = new Set<string>();

  for (const candidateUrl of linkCandidates) {
    let linkPage: CdpPageLike | undefined;
    try {
      linkPage = await input.context.newPage();
      await gotoWithRetry({
        page: linkPage,
        url: candidateUrl,
        timeoutMs: Math.min(input.timeoutMs, 20_000)
      });

      const finalUrl = linkPage.url();
      if (!finalUrl || seenFinalUrls.has(finalUrl)) {
        continue;
      }

      if (isXLikeHost(finalUrl) && !isXArticleUrl(finalUrl)) {
        continue;
      }

      const html = await linkPage.content();
      if (html.trim().length === 0) {
        continue;
      }
      const textSnapshot = await collectLinkedPageTextSnapshot(linkPage, input.timeoutMs, isXArticleUrl(finalUrl));
      const effectiveHtml = textSnapshot.richHtml?.trim() || html;

      seenFinalUrls.add(finalUrl);
      linkedPages.push({
        url: finalUrl,
        html: effectiveHtml,
        ...(textSnapshot.title ? { title: textSnapshot.title } : {}),
        ...(textSnapshot.text ? { text: textSnapshot.text } : {})
      });
    } catch {
      // Continue trying other candidates.
    } finally {
      if (linkPage) {
        await linkPage.close();
      }
    }
  }

  return linkedPages;
}

export class CdpFetcher implements Fetcher {
  public readonly id = "cdp";

  public constructor(
    private readonly loadPlaywright: () => Promise<PlaywrightLike> = defaultLoadPlaywright,
    private readonly fetchCdpVersion: FetchCdpVersion = defaultFetchCdpVersion
  ) {}

  public async fetch(options: FetchOptions): Promise<FetchResult> {
    const cdpEndpoint = options.cdpEndpoint?.trim();
    if (!cdpEndpoint) {
      throw new ObfronterError(
        "CDP_ENDPOINT_REQUIRED",
        "CDP fetch mode requires --cdp-endpoint to connect to Chrome DevTools."
      );
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const playwright = await this.loadPlaywright();

    const endpointCandidates: string[] = [cdpEndpoint];
    const version = await this.fetchCdpVersion(cdpEndpoint, timeoutMs);
    const discoveredWs = version?.webSocketDebuggerUrl?.trim();
    if (discoveredWs && !endpointCandidates.includes(discoveredWs)) {
      endpointCandidates.push(discoveredWs);
    }

    let browser: CdpBrowserLike | undefined;
    let lastConnectError: unknown;
    for (const endpoint of endpointCandidates) {
      try {
        browser = await playwright.chromium.connectOverCDP(endpoint);
        break;
      } catch (error) {
        lastConnectError = error;
      }
    }

    if (!browser) {
      const attempted = endpointCandidates.join(", ");
      const reason = lastConnectError ? ` (${summarizeError(lastConnectError)})` : "";
      throw new ObfronterError(
        "CDP_CONNECT_FAILED",
        `Failed to connect to Chrome DevTools endpoint: ${cdpEndpoint}. Tried: ${attempted}${reason}`
      );
    }

    try {
      const context = browser.contexts()[0];
      if (!context) {
        throw new ObfronterError(
          "CDP_CONTEXT_UNAVAILABLE",
          "Connected to Chrome DevTools, but no browser context is available."
        );
      }

      const page = await context.newPage();
      try {
        const response = await gotoWithRetry({
          page,
          url: options.url,
          timeoutMs
        });
        await waitForFetchedPageContentReady({
          page,
          requestedUrl: options.url,
          timeoutMs
        });
        const linkedPages = await collectLinkedPageSnapshots({
          context,
          page,
          requestedUrl: options.url,
          timeoutMs
        });
        const capturedCodeBlocks = await captureCodeBlocksFromPage(page);

        return {
          requestedUrl: options.url,
          finalUrl: page.url(),
          html: await page.content(),
          statusCode: response?.status() ?? 200,
          fetchedAt: new Date().toISOString(),
          ...(capturedCodeBlocks.length > 0 ? { capturedCodeBlocks } : {}),
          ...(linkedPages.length > 0 ? { linkedPages } : {})
        };
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
}
