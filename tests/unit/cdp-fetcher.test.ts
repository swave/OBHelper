import { describe, expect, it, vi } from "vitest";

import { CdpFetcher } from "../../src/fetch/cdp-fetcher.js";

describe("CdpFetcher", () => {
  it("requires cdp endpoint", async () => {
    const fetcher = new CdpFetcher();

    await expect(() =>
      fetcher.fetch({
        url: "https://x.com/test/status/1"
      })
    ).rejects.toThrow("CDP fetch mode requires --cdp-endpoint");
  });

  it("connects over cdp and fetches page content", async () => {
    const goto = vi.fn(async () => ({
      status: () => 200
    }));
    const content = vi.fn(async () => "<html><body>ok</body></html>");
    const pageUrl = vi.fn(() => "https://x.com/test/status/1");
    const closePage = vi.fn(async () => undefined);

    const newPage = vi.fn(async () => ({
      goto,
      content,
      url: pageUrl,
      close: closePage
    }));

    const closeBrowser = vi.fn(async () => undefined);
    const connectOverCDP = vi.fn(async () => ({
      contexts: () => [{ newPage }],
      close: closeBrowser
    }));
    const loadPlaywright = vi.fn(async () => ({
      chromium: {
        connectOverCDP
      }
    }));

    const fetcher = new CdpFetcher(loadPlaywright);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(goto).toHaveBeenCalledWith("https://x.com/test/status/1", {
      timeout: 12_345,
      waitUntil: "networkidle"
    });
    expect(closePage).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      requestedUrl: "https://x.com/test/status/1",
      finalUrl: "https://x.com/test/status/1",
      html: "<html><body>ok</body></html>",
      statusCode: 200,
      fetchedAt: expect.any(String)
    });
  });

  it("fails when browser context is unavailable", async () => {
    const closeBrowser = vi.fn(async () => undefined);
    const loadPlaywright = vi.fn(async () => ({
      chromium: {
        connectOverCDP: vi.fn(async () => ({
          contexts: () => [],
          close: closeBrowser
        }))
      }
    }));

    const fetcher = new CdpFetcher(loadPlaywright);
    await expect(() =>
      fetcher.fetch({
        url: "https://x.com/test/status/1",
        cdpEndpoint: "http://127.0.0.1:9222"
      })
    ).rejects.toThrow("no browser context is available");
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});
