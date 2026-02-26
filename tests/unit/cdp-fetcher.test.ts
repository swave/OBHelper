import { describe, expect, it, vi } from "vitest";

import { CdpFetcher } from "../../src/fetch/cdp-fetcher.js";

describe("CdpFetcher", () => {
  it("requires cdp endpoint", async () => {
    const fetcher = new CdpFetcher(undefined, async () => undefined);

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
    const waitForSelector = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => []);

    const newPage = vi.fn(async () => ({
      goto,
      waitForSelector,
      evaluate,
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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(connectOverCDP).toHaveBeenCalledWith("http://127.0.0.1:9222");
    expect(goto).toHaveBeenCalledWith("https://x.com/test/status/1", {
      timeout: 12_345,
      waitUntil: "domcontentloaded"
    });
    expect(waitForSelector).toHaveBeenCalledWith(
      'article [data-testid="tweetText"], article time, article [lang]',
      {
        state: "attached",
        timeout: 8_000
      }
    );
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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    await expect(() =>
      fetcher.fetch({
        url: "https://x.com/test/status/1",
        cdpEndpoint: "http://127.0.0.1:9222"
      })
    ).rejects.toThrow("no browser context is available");
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("falls back to discovered websocket debugger url", async () => {
    const goto = vi.fn(async () => ({
      status: () => 200
    }));
    const content = vi.fn(async () => "<html><body>ok</body></html>");
    const pageUrl = vi.fn(() => "https://x.com/test/status/1");
    const closePage = vi.fn(async () => undefined);
    const waitForSelector = vi.fn(async () => undefined);
    const evaluate = vi.fn(async () => []);
    const newPage = vi.fn(async () => ({
      goto,
      waitForSelector,
      evaluate,
      content,
      url: pageUrl,
      close: closePage
    }));

    const closeBrowser = vi.fn(async () => undefined);
    const connectOverCDP = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:9222"))
      .mockResolvedValueOnce({
        contexts: () => [{ newPage }],
        close: closeBrowser
      });

    const loadPlaywright = vi.fn(async () => ({
      chromium: {
        connectOverCDP
      }
    }));
    const fetchCdpVersion = vi.fn(async () => ({
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/mock-id"
    }));

    const fetcher = new CdpFetcher(loadPlaywright, fetchCdpVersion);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(fetchCdpVersion).toHaveBeenCalledWith("http://127.0.0.1:9222", 12_345);
    expect(connectOverCDP).toHaveBeenNthCalledWith(1, "http://127.0.0.1:9222");
    expect(connectOverCDP).toHaveBeenNthCalledWith(2, "ws://127.0.0.1:9222/devtools/browser/mock-id");
    expect(waitForSelector.mock.calls.length).toBeGreaterThan(0);
    expect(result.statusCode).toBe(200);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("captures linked page html via live browser session", async () => {
    const mainGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const mainWaitForSelector = vi.fn(async () => undefined);
    const mainEvaluate = vi.fn(async () => ["https://t.co/example"]);
    const mainContent = vi.fn(async () => "<html><body>tweet</body></html>");
    const mainUrl = vi.fn(() => "https://x.com/test/status/1");
    const mainClose = vi.fn(async () => undefined);
    const mainPage = {
      goto: mainGoto,
      waitForSelector: mainWaitForSelector,
      evaluate: mainEvaluate,
      content: mainContent,
      url: mainUrl,
      close: mainClose
    };

    const linkGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const linkWaitForSelector = vi.fn(async () => undefined);
    const linkEvaluate = vi.fn(async () => ({
      title: "Linked Title",
      text: "Linked body from live DOM."
    }));
    const linkContent = vi.fn(async () => "<html><body><article><h1>Linked Title</h1><p>Linked body.</p></article></body></html>");
    const linkUrl = vi.fn(() => "https://example.com/linked");
    const linkClose = vi.fn(async () => undefined);
    const linkPage = {
      goto: linkGoto,
      waitForSelector: linkWaitForSelector,
      evaluate: linkEvaluate,
      content: linkContent,
      url: linkUrl,
      close: linkClose
    };

    const newPage = vi
      .fn()
      .mockResolvedValueOnce(mainPage)
      .mockResolvedValueOnce(linkPage);

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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(linkGoto).toHaveBeenCalledWith("https://t.co/example", {
      timeout: 12_345,
      waitUntil: "domcontentloaded"
    });
    expect(result.linkedPages).toEqual([
      {
        url: "https://example.com/linked",
        html: "<html><body><article><h1>Linked Title</h1><p>Linked body.</p></article></body></html>",
        title: "Linked Title",
        text: "Linked body from live DOM."
      }
    ]);
    expect(linkClose).toHaveBeenCalledTimes(1);
    expect(mainClose).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("prefers structured rich html snapshot over page.content for linked pages", async () => {
    const mainGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const mainWaitForSelector = vi.fn(async () => undefined);
    const mainEvaluate = vi.fn(async () => ["https://t.co/example"]);
    const mainContent = vi.fn(async () => "<html><body>tweet</body></html>");
    const mainUrl = vi.fn(() => "https://x.com/test/status/1");
    const mainClose = vi.fn(async () => undefined);
    const mainPage = {
      goto: mainGoto,
      waitForSelector: mainWaitForSelector,
      evaluate: mainEvaluate,
      content: mainContent,
      url: mainUrl,
      close: mainClose
    };

    const linkGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const linkWaitForSelector = vi.fn(async () => undefined);
    const linkEvaluate = vi.fn(async () => ({
      title: "Linked Title",
      text: "Linked body from live DOM.",
      richHtml: "<main data-testid=\"twitterArticleReadView\"><div data-testid=\"twitter-article-title\">Linked Title</div><div class=\"longform-unstyled\"><span style=\"font-weight:700\">Bold line</span></div></main>"
    }));
    const linkContent = vi.fn(async () => "<html><body><article><h1>Fallback Content</h1></article></body></html>");
    const linkUrl = vi.fn(() => "https://example.com/linked");
    const linkClose = vi.fn(async () => undefined);
    const linkPage = {
      goto: linkGoto,
      waitForSelector: linkWaitForSelector,
      evaluate: linkEvaluate,
      content: linkContent,
      url: linkUrl,
      close: linkClose
    };

    const newPage = vi
      .fn()
      .mockResolvedValueOnce(mainPage)
      .mockResolvedValueOnce(linkPage);

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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(result.linkedPages).toEqual([
      {
        url: "https://example.com/linked",
        html: "<main data-testid=\"twitterArticleReadView\"><div data-testid=\"twitter-article-title\">Linked Title</div><div class=\"longform-unstyled\"><span style=\"font-weight:700\">Bold line</span></div></main>",
        title: "Linked Title",
        text: "Linked body from live DOM."
      }
    ]);
    expect(linkClose).toHaveBeenCalledTimes(1);
    expect(mainClose).toHaveBeenCalledTimes(1);
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });

  it("captures linked x article pages via t.co redirects", async () => {
    const mainGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const mainWaitForSelector = vi.fn(async () => undefined);
    const mainEvaluate = vi.fn(async () => ["https://t.co/example"]);
    const mainContent = vi.fn(async () => "<html><body>tweet</body></html>");
    const mainUrl = vi.fn(() => "https://x.com/test/status/1");
    const mainClose = vi.fn(async () => undefined);
    const mainPage = {
      goto: mainGoto,
      waitForSelector: mainWaitForSelector,
      evaluate: mainEvaluate,
      content: mainContent,
      url: mainUrl,
      close: mainClose
    };

    const linkGoto = vi.fn(async () => ({
      status: () => 200
    }));
    const linkWaitForSelector = vi.fn(async () => undefined);
    const linkEvaluate = vi.fn(async () => ({
      title: "Up Next: The One-Person Million-Dollar Company / X",
      text: "Up Next: The One-Person Million-Dollar Company\n\nBody from x article snapshot."
    }));
    const linkContent = vi.fn(async () => "<html><body><article><h1>X Article</h1><p>Body.</p></article></body></html>");
    const linkUrl = vi.fn(() => "https://x.com/test/article/12345");
    const linkClose = vi.fn(async () => undefined);
    const linkPage = {
      goto: linkGoto,
      waitForSelector: linkWaitForSelector,
      evaluate: linkEvaluate,
      content: linkContent,
      url: linkUrl,
      close: linkClose
    };

    const newPage = vi
      .fn()
      .mockResolvedValueOnce(mainPage)
      .mockResolvedValueOnce(linkPage);

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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    const result = await fetcher.fetch({
      url: "https://x.com/test/status/1",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(result.linkedPages).toEqual([
      {
        url: "https://x.com/test/article/12345",
        html: "<html><body><article><h1>X Article</h1><p>Body.</p></article></body></html>",
        title: "Up Next: The One-Person Million-Dollar Company / X",
        text: "Up Next: The One-Person Million-Dollar Company\n\nBody from x article snapshot."
      }
    ]);
  });

  it("retries status navigation after transient timeout", async () => {
    const mainGoto = vi
      .fn()
      .mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT"))
      .mockResolvedValueOnce({
        status: () => 200
      });
    const mainWaitForSelector = vi.fn(async () => undefined);
    const mainEvaluate = vi.fn(async () => []);
    const mainContent = vi.fn(async () => "<html><body>ok</body></html>");
    const mainUrl = vi.fn(() => "https://example.com/article");
    const mainClose = vi.fn(async () => undefined);
    const mainPage = {
      goto: mainGoto,
      waitForSelector: mainWaitForSelector,
      evaluate: mainEvaluate,
      content: mainContent,
      url: mainUrl,
      close: mainClose
    };

    const newPage = vi.fn().mockResolvedValue(mainPage);
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

    const fetcher = new CdpFetcher(loadPlaywright, async () => undefined);
    const result = await fetcher.fetch({
      url: "https://example.com/article",
      cdpEndpoint: "http://127.0.0.1:9222",
      timeoutMs: 12_345
    });

    expect(mainGoto).toHaveBeenCalledTimes(2);
    expect(mainGoto).toHaveBeenNthCalledWith(1, "https://example.com/article", {
      timeout: 12_345,
      waitUntil: "domcontentloaded"
    });
    expect(mainGoto).toHaveBeenNthCalledWith(2, "https://example.com/article", {
      timeout: 12_345,
      waitUntil: "commit"
    });
    expect(result.finalUrl).toBe("https://example.com/article");
    expect(closeBrowser).toHaveBeenCalledTimes(1);
  });
});
