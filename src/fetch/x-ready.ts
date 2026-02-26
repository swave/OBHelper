import { detectSourcePlatform, isXStatusUrl } from "../core/url-source.js";

const X_CONTENT_SELECTOR = 'article [data-testid="tweetText"], article time, article [lang]';
const MAX_X_READY_WAIT_MS = 8_000;
const GENERIC_DYNAMIC_SELECTOR = "pre, code, [data-testid='markdown-code-block']";
const MAX_GENERIC_READY_WAIT_MS = 5_000;
const GENERIC_SETTLE_MS = 1_000;

interface WaitablePageLike {
  waitForSelector: (
    selector: string,
    options: { state: "attached"; timeout: number }
  ) => Promise<unknown>;
  evaluate?: (callback: () => unknown) => Promise<unknown>;
  url: () => string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function tryParseUrl(input: string): URL | undefined {
  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function isXLikeUrl(url: URL | undefined): boolean {
  if (!url) {
    return false;
  }

  return detectSourcePlatform(url) === "x";
}

function isXStatusLikeUrl(url: URL | undefined): boolean {
  if (!url) {
    return false;
  }

  return detectSourcePlatform(url) === "x" && isXStatusUrl(url);
}

export async function waitForXStatusContentReady(input: {
  page: WaitablePageLike;
  requestedUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const requestedUrl = tryParseUrl(input.requestedUrl);
  const currentUrl = tryParseUrl(input.page.url());

  // Avoid waiting on non-X pages.
  if (!isXLikeUrl(requestedUrl) && !isXLikeUrl(currentUrl)) {
    return;
  }

  // Wait only for X status-like navigations.
  if (!isXStatusLikeUrl(requestedUrl) && !isXStatusLikeUrl(currentUrl)) {
    return;
  }

  try {
    await input.page.waitForSelector(X_CONTENT_SELECTOR, {
      state: "attached",
      timeout: Math.min(input.timeoutMs, MAX_X_READY_WAIT_MS)
    });
  } catch {
    // Continue with whatever HTML is currently available.
  }
}

export async function waitForFetchedPageContentReady(input: {
  page: WaitablePageLike;
  requestedUrl: string;
  timeoutMs: number;
}): Promise<void> {
  const requestedUrl = tryParseUrl(input.requestedUrl);
  const currentUrl = tryParseUrl(input.page.url());

  if (isXStatusLikeUrl(requestedUrl) || isXStatusLikeUrl(currentUrl)) {
    await waitForXStatusContentReady(input);
    return;
  }

  const waitBudgetMs = Math.min(input.timeoutMs, MAX_GENERIC_READY_WAIT_MS);
  const settleDelayMs = Math.min(GENERIC_SETTLE_MS, Math.max(300, Math.floor(waitBudgetMs / 3)));
  let hasDynamicCodeCandidate = false;
  try {
    await input.page.waitForSelector(GENERIC_DYNAMIC_SELECTOR, {
      state: "attached",
      timeout: waitBudgetMs
    });
    hasDynamicCodeCandidate = true;
  } catch {
    // Keep going: many sites hydrate lazily and may need brief settling/scroll.
  }

  // Trigger common intersection-observer/lazy-render flows on generic pages.
  if (typeof input.page.evaluate === "function") {
    try {
      await input.page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        const maxScroll = Math.max(0, root.scrollHeight - root.clientHeight);
        root.scrollTop = Math.floor(maxScroll * 0.45);
      });
      await sleep(220);
      await input.page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        root.scrollTop = root.scrollHeight;
      });
      await sleep(220);
      await input.page.evaluate(() => {
        const root = document.scrollingElement || document.documentElement;
        root.scrollTop = 0;
      });
    } catch {
      // Ignore evaluate errors and continue with current DOM snapshot.
    }
  }

  // Re-check briefly after hydration pass.
  if (!hasDynamicCodeCandidate) {
    try {
      await input.page.waitForSelector(GENERIC_DYNAMIC_SELECTOR, {
        state: "attached",
        timeout: Math.max(600, Math.floor(waitBudgetMs / 2))
      });
      hasDynamicCodeCandidate = true;
    } catch {
      // Still proceed with a short settle to avoid premature snapshots.
    }
  }

  await sleep(settleDelayMs);
}
