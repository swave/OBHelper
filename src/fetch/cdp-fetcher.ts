import { ObfronterError } from "../core/errors.js";
import type { FetchOptions, FetchResult } from "../core/types.js";
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

        return {
          requestedUrl: options.url,
          finalUrl: page.url(),
          html: await page.content(),
          statusCode: response?.status() ?? 200,
          fetchedAt: new Date().toISOString()
        };
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
}
