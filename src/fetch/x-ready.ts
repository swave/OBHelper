import { detectSourcePlatform, isXStatusUrl } from "../core/url-source.js";

const X_CONTENT_SELECTOR = 'article [data-testid="tweetText"], article time, article [lang]';
const MAX_X_READY_WAIT_MS = 8_000;

interface WaitablePageLike {
  waitForSelector: (
    selector: string,
    options: { state: "attached"; timeout: number }
  ) => Promise<unknown>;
  url: () => string;
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
