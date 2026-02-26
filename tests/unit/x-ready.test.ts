import { describe, expect, it, vi } from "vitest";

import { waitForFetchedPageContentReady, waitForXStatusContentReady } from "../../src/fetch/x-ready.js";

describe("waitForXStatusContentReady", () => {
  it("waits for selectors on x status urls", async () => {
    const waitForSelector = vi.fn(async () => undefined);
    const page = {
      waitForSelector,
      url: () => "https://x.com/elvissun/status/2025920521871716562"
    };

    await waitForXStatusContentReady({
      page,
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      timeoutMs: 30_000
    });

    expect(waitForSelector).toHaveBeenCalledWith(
      'article [data-testid="tweetText"], article time, article [lang]',
      {
        state: "attached",
        timeout: 8_000
      }
    );
  });

  it("does not wait for non-x urls", async () => {
    const waitForSelector = vi.fn(async () => undefined);
    const page = {
      waitForSelector,
      url: () => "https://example.com/post"
    };

    await waitForXStatusContentReady({
      page,
      requestedUrl: "https://example.com/post",
      timeoutMs: 30_000
    });

    expect(waitForSelector).not.toHaveBeenCalled();
  });

  it("caps timeout by requested timeout value", async () => {
    const waitForSelector = vi.fn(async () => undefined);
    const page = {
      waitForSelector,
      url: () => "https://x.com/elvissun/status/2025920521871716562"
    };

    await waitForXStatusContentReady({
      page,
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      timeoutMs: 2_000
    });

    expect(waitForSelector).toHaveBeenCalledWith(
      'article [data-testid="tweetText"], article time, article [lang]',
      {
        state: "attached",
        timeout: 2_000
      }
    );
  });
});

describe("waitForFetchedPageContentReady", () => {
  it("waits for generic dynamic code selectors on non-x urls", async () => {
    vi.useFakeTimers();
    try {
      const waitForSelector = vi.fn(async () => undefined);
      const page = {
        waitForSelector,
        url: () => "https://example.com/post"
      };

      const pending = waitForFetchedPageContentReady({
        page,
        requestedUrl: "https://example.com/post",
        timeoutMs: 30_000
      });
      await vi.advanceTimersByTimeAsync(1_000);
      await pending;

      expect(waitForSelector).toHaveBeenCalledWith(
        "pre, code, [data-testid='markdown-code-block']",
        {
          state: "attached",
          timeout: 5_000
        }
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("reuses x-specific readiness for x status urls", async () => {
    const waitForSelector = vi.fn(async () => undefined);
    const page = {
      waitForSelector,
      url: () => "https://x.com/elvissun/status/2025920521871716562"
    };

    await waitForFetchedPageContentReady({
      page,
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      timeoutMs: 30_000
    });

    expect(waitForSelector).toHaveBeenCalledWith(
      'article [data-testid="tweetText"], article time, article [lang]',
      {
        state: "attached",
        timeout: 8_000
      }
    );
  });

  it("applies hydration settle pass on generic pages even when selector is initially missing", async () => {
    vi.useFakeTimers();
    try {
      const waitForSelector = vi
        .fn()
        .mockRejectedValueOnce(new Error("not ready yet"))
        .mockResolvedValueOnce(undefined);
      const evaluate = vi.fn(async () => undefined);
      const page = {
        waitForSelector,
        evaluate,
        url: () => "https://example.com/post"
      };

      const pending = waitForFetchedPageContentReady({
        page,
        requestedUrl: "https://example.com/post",
        timeoutMs: 30_000
      });
      await vi.advanceTimersByTimeAsync(2_500);
      await pending;

      expect(waitForSelector).toHaveBeenCalledTimes(2);
      expect(evaluate).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
