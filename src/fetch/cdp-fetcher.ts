import { ObfronterError } from "../core/errors.js";
import { detectSourcePlatform, isXStatusUrl } from "../core/url-source.js";
import type { FetchLinkedPage, FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";
import { waitForXStatusContentReady } from "./x-ready.js";

interface CdpPageLike {
  goto: (
    url: string,
    options: { timeout: number; waitUntil: "domcontentloaded" | "networkidle" }
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

async function collectLinkedPageTextSnapshot(
  page: CdpPageLike,
  timeoutMs: number,
  requireLongText: boolean
): Promise<{ title?: string; text?: string }> {
  const waitBudgetMs = Math.min(timeoutMs, 10_000);
  const deadline = Date.now() + waitBudgetMs;
  let bestTitle = "";
  let bestText = "";
  const mergedTextLines: string[] = [];
  const seenTextLines = new Set<string>();
  let attempts = 0;
  let nonEmptyTextSamples = 0;

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
        const toText = (node: Element): string => {
          const raw = (node as HTMLElement).innerText ?? node.textContent ?? "";
          return normalize(raw);
        };
        const articleRoot = document.querySelector("main article") ?? document.querySelector("article");
        const structuredBlocks = articleRoot
          ? [...articleRoot.querySelectorAll(
            "h1, h2, h3, p, li, blockquote, pre, [data-testid='markdown-code-block']"
          )]
            .map((node) => toText(node))
            .filter((text) => text.length > 0)
          : [];
        const structuredText = [...new Set(structuredBlocks)].join("\n\n");
        const bodyText = normalize(document.body?.innerText ?? "");

        return {
          title: normalize(document.title ?? ""),
          text: structuredText.length >= 120 ? structuredText : bodyText
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

      if (titleCandidate.length > bestTitle.length) {
        bestTitle = titleCandidate;
      }
      if (textCandidate.length > 0) {
        nonEmptyTextSamples += 1;
        for (const line of textCandidate.split("\n").map((entry) => entry.trim()).filter((entry) => entry.length > 0)) {
          if (seenTextLines.has(line)) {
            continue;
          }
          seenTextLines.add(line);
          mergedTextLines.push(line);
        }
      }
      const mergedText = mergedTextLines.join("\n");
      if (mergedText.length > bestText.length) {
        bestText = mergedText;
      }
      if (textCandidate.length > bestText.length) {
        bestText = textCandidate;
      }
    }

    const enoughText = requireLongText
      ? bestText.length >= 120 && nonEmptyTextSamples >= 3
      : bestText.length > 0 || bestTitle.length > 0;
    const stableNonEmptyText = requireLongText
      ? bestText.length >= 40 && nonEmptyTextSamples >= 3
      : nonEmptyTextSamples >= 1;
    if (enoughText || stableNonEmptyText || attempts >= 25 || Date.now() >= deadline) {
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
    ...(bestText.length > 0 ? { text: bestText } : {})
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
      await linkPage.goto(candidateUrl, {
        timeout: Math.min(input.timeoutMs, 20_000),
        waitUntil: "domcontentloaded"
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

      seenFinalUrls.add(finalUrl);
      linkedPages.push({
        url: finalUrl,
        html,
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
        const response = await page.goto(options.url, {
          timeout: timeoutMs,
          waitUntil: "domcontentloaded"
        });
        await waitForXStatusContentReady({
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

        return {
          requestedUrl: options.url,
          finalUrl: page.url(),
          html: await page.content(),
          statusCode: response?.status() ?? 200,
          fetchedAt: new Date().toISOString(),
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
