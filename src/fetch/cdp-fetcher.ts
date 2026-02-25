import { ObfronterError } from "../core/errors.js";
import type { FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";

interface CdpPageLike {
  goto: (
    url: string,
    options: { timeout: number; waitUntil: "networkidle" }
  ) => Promise<{ status: () => number } | null>;
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

export class CdpFetcher implements Fetcher {
  public readonly id = "cdp";

  public constructor(private readonly loadPlaywright: () => Promise<PlaywrightLike> = defaultLoadPlaywright) {}

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

    let browser: CdpBrowserLike;
    try {
      browser = await playwright.chromium.connectOverCDP(cdpEndpoint);
    } catch {
      throw new ObfronterError(
        "CDP_CONNECT_FAILED",
        `Failed to connect to Chrome DevTools endpoint: ${cdpEndpoint}`
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
          waitUntil: "networkidle"
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
