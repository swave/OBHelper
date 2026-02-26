import { ObfronterError } from "../core/errors.js";
import type { BrowserChannel, FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";
import { waitForFetchedPageContentReady } from "./x-ready.js";

interface PlaywrightLike {
  chromium: {
    launchPersistentContext: (
      userDataDir: string,
      options: { headless: boolean; channel?: BrowserChannel }
    ) => Promise<{
      newPage: () => Promise<{
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
      }>;
      close: () => Promise<void>;
    }>;
  };
}

export class BrowserFetcher implements Fetcher {
  public readonly id = "browser";

  public async fetch(options: FetchOptions): Promise<FetchResult> {
    if (!options.sessionProfileDir) {
      throw new ObfronterError(
        "SESSION_REQUIRED",
        "Browser fetch mode requires --session-profile-dir so the user can provide authenticated cookies."
      );
    }

    const timeoutMs = options.timeoutMs ?? 30_000;
    const moduleName = "playwright";

    let playwright: PlaywrightLike;
    try {
      playwright = (await import(moduleName)) as PlaywrightLike;
    } catch {
      throw new ObfronterError(
        "PLAYWRIGHT_MISSING",
        "playwright is not installed. Install it and rerun in browser mode."
      );
    }

    let context: Awaited<ReturnType<PlaywrightLike["chromium"]["launchPersistentContext"]>>;
    try {
      context = await playwright.chromium.launchPersistentContext(options.sessionProfileDir, {
        headless: true,
        channel: options.browserChannel
      });
    } catch {
      const channel = options.browserChannel ?? "chromium";
      throw new ObfronterError(
        "BROWSER_LAUNCH_FAILED",
        `Failed to launch browser channel '${channel}'. Install that browser or choose another with --browser-channel.`
      );
    }

    try {
      const page = await context.newPage();
      const response = await page.goto(options.url, {
        timeout: timeoutMs,
        waitUntil: "domcontentloaded"
      });
      await waitForFetchedPageContentReady({
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
      await context.close();
    }
  }
}
