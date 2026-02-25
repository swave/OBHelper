import { describe, expect, it, vi } from "vitest";

import { waitForXStatusContentReady } from "../../src/fetch/x-ready.js";

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
