import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { XExtractor } from "../../src/extract/x-extractor.js";

describe("XExtractor", () => {
  it("extracts tweet text, metadata, and media urls from x status html", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_status.html");
    const html = await readFile(fixturePath, "utf8");

    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(oEmbedFetch);
    const result = await extractor.extract({
      requestedUrl: "https://x.com/testuser/status/1234567890",
      finalUrl: "https://x.com/testuser/status/1234567890",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:01:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.statusId).toBe("1234567890");
    expect(result.authorHandle).toBe("testuser");
    expect(result.byline).toBe("@testuser");
    expect(result.excerpt).toContain("Hello from fixture X post");
    expect(result.publishedAt).toBe("2026-02-25T12:00:00.000Z");
    expect(result.mediaUrls).toEqual([
      "https://pbs.twimg.com/media/FIXTURE_OG.jpg",
      "https://pbs.twimg.com/media/FIXTURE_TW.jpg",
      "https://x.com/testuser/status/1234567890/photo/1",
      "https://pbs.twimg.com/media/FIXTURE_INLINE.jpg"
    ]);
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("returns blocked-note extraction for login wall pages", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 403,
      json: async () => ({})
    }));
    const result = await extractor.extract({
      requestedUrl: "https://x.com/testuser/status/999999",
      finalUrl: "https://x.com/testuser/status/999999",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("blocked");
    expect(result.statusId).toBe("999999");
    expect(result.authorHandle).toBe("testuser");
    expect(result.excerpt).toContain("Sign-in required");
    expect(result.contentHtml).toContain("Open source URL");
  });

  it("extracts from i/web status URLs using canonical handle and lang nodes", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_status_iweb.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const result = await extractor.extract({
      requestedUrl: "https://x.com/i/web/status/555555",
      finalUrl: "https://x.com/i/web/status/555555",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-26T01:24:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.statusId).toBe("555555");
    expect(result.authorHandle).toBe("fixtureuser");
    expect(result.byline).toBe("@fixtureuser");
    expect(result.publishedAt).toBe("2026-02-26T01:23:45.000Z");
    expect(result.contentHtml).toContain("First line from lang node.");
    expect(result.contentHtml).toContain("Second line from lang node.");
    expect(result.mediaUrls).toEqual(["https://pbs.twimg.com/media/IWEB_OG.jpg"]);
  });

  it("maps rate-limit pages to blocked status with specific reason", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_rate_limited.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: false,
      status: 429,
      json: async () => ({})
    }));
    const result = await extractor.extract({
      requestedUrl: "https://x.com/someuser/status/777777",
      finalUrl: "https://x.com/someuser/status/777777",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-26T01:25:00.000Z"
    });

    expect(result.extractionStatus).toBe("blocked");
    expect(result.statusId).toBe("777777");
    expect(result.authorHandle).toBe("someuser");
    expect(result.excerpt).toBe("X rate limit exceeded for this request.");
    expect(result.contentHtml).toContain("X rate limit exceeded for this request.");
  });

  it("uses oembed fallback when html page is blocked", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        author_name: "Elvis Sun",
        html: "<blockquote><p>Hello from oEmbed fallback tweet body.</p></blockquote>"
      })
    }));

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.authorHandle).toBe("elvissun");
    expect(result.statusId).toBe("2025920521871716562");
    expect(result.byline).toBe("@elvissun");
    expect(result.excerpt).toContain("Hello from oEmbed fallback tweet body");
    expect(result.contentHtml).toContain("Hello from oEmbed fallback tweet body");
  });

  it("expands t.co-only oembed content into useful links", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          author_name: "Elvis",
          html: "<blockquote><p><a href=\"https://t.co/DotZ3V6XhJ\">https://t.co/DotZ3V6XhJ</a></p>&mdash; Elvis</blockquote>"
        })
      }),
      async (url) => (url === "https://t.co/DotZ3V6XhJ" ? "https://example.com/expanded-article" : undefined),
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com/expanded-article",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.excerpt).toContain("https://example.com/expanded-article");
    expect(result.contentHtml).toContain("Expanded links:");
    expect(result.contentHtml).toContain("https://example.com/expanded-article");
    expect(result.contentHtml).not.toContain("&mdash; Elvis");
  });

  it("extracts linked page content when oembed is link-only", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/x_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new XExtractor(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          author_name: "Elvis",
          html: "<blockquote><p><a href=\"https://t.co/DotZ3V6XhJ\">https://t.co/DotZ3V6XhJ</a></p></blockquote>"
        })
      }),
      async (url) => (url === "https://t.co/DotZ3V6XhJ" ? "https://example.com/expanded-article" : undefined),
      async () => ({
        ok: true,
        status: 200,
        url: "https://example.com/expanded-article",
        text: async () => "<html><head><title>Expanded Title</title></head><body><article><h1>Expanded Title</h1><p>Expanded body text from linked content.</p></article></body></html>"
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:03:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Expanded Title");
    expect(result.contentHtml).toContain("Linked content extracted from");
    expect(result.contentHtml).toContain("Expanded body text from linked content.");
    expect(result.excerpt).toContain("Expanded");
  });

  it("expands direct link-only tweet content into useful links", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async (url) => (url === "https://t.co/DotZ3V6XhJ" ? "https://example.com/expanded-article" : undefined),
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com/expanded-article",
        text: async () => ""
      })
    );
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Elvis on X" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
            <time datetime="2026-02-23T10:00:00.000Z"></time>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:04:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.excerpt).toContain("https://example.com/expanded-article");
    expect(result.contentHtml).toContain("Expanded links:");
    expect(result.contentHtml).toContain("https://example.com/expanded-article");
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("extracts linked page content for direct link-only tweets", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async (url) => (url === "https://t.co/DotZ3V6XhJ" ? "https://example.com/expanded-article" : undefined),
      async () => ({
        ok: true,
        status: 200,
        url: "https://example.com/expanded-article",
        text: async () => "<html><head><title>Expanded Title</title></head><body><article><h1>Expanded Title</h1><p>Expanded body text from linked content.</p></article></body></html>"
      })
    );
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Elvis on X" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
            <time datetime="2026-02-23T10:00:00.000Z"></time>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:05:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Expanded Title");
    expect(result.contentHtml).toContain("Linked content extracted from");
    expect(result.contentHtml).toContain("Expanded body text from linked content.");
    expect(result.excerpt).toContain("Expanded");
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("uses prefetched linked pages from fetch result for direct link-only tweets", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com/unreachable",
        text: async () => ""
      })
    );
    const html = `
      <html>
        <head>
          <meta property="og:title" content="Elvis on X" />
        </head>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
            <time datetime="2026-02-23T10:00:00.000Z"></time>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:06:00.000Z",
      linkedPages: [
        {
          url: "https://example.com/full-article",
          html: "<html><head><title>Up Next: The One-Person Million-Dollar Company</title></head><body><article><h1>Up Next: The One-Person Million-Dollar Company</h1><p>Long-form article text from linked page.</p></article></body></html>"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Up Next: The One-Person Million-Dollar Company");
    expect(result.contentHtml).toContain("Linked content extracted from");
    expect(result.contentHtml).toContain("Long-form article text from linked page.");
    expect(result.excerpt).toContain("Long-form");
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("accepts prefetched x article pages as linked content", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://x.com/elvissun/article/2025920521871716562",
        text: async () => ""
      })
    );
    const html = `
      <html>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:07:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><head><title>Up Next: The One-Person Million-Dollar Company</title></head><body><article><h1>Up Next: The One-Person Million-Dollar Company</h1><p>Full article body from X article page.</p></article></body></html>"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Up Next: The One-Person Million-Dollar Company");
    expect(result.contentHtml).toContain("Full article body from X article page.");
    expect(oEmbedFetch).not.toHaveBeenCalled();
  });

  it("prioritizes prefetched x article content over generic external links", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );
    const html = `
      <html>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:08:00.000Z",
      linkedPages: [
        {
          url: "https://example.com/landing",
          html: "<html><head><title>Landing</title></head><body><article><h1>Landing</h1><p>External marketing page.</p></article></body></html>"
        },
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><head><title>X</title></head><body><div id=\"react-root\"></div></body></html>",
          title: "Up Next: The One-Person Million-Dollar Company / X",
          text: [
            "To view keyboard shortcuts, press question mark",
            "Up Next: The One-Person Million-Dollar Company",
            "Want to publish your own Article?",
            "Upgrade to Premium",
            "Follow",
            "302",
            "1.5K",
            "[[IMAGE:https://pbs.twimg.com/media/test-inline.jpg]]",
            "Preferred article body.",
            "bash",
            "git worktree add ../feat-custom-templates -b feat/custom-templates origin/main"
          ].join("\n")
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Up Next: The One-Person Million-Dollar Company");
    expect(result.contentHtml).toContain('<img src="https://pbs.twimg.com/media/test-inline.jpg" alt="" />');
    expect(result.contentHtml).toContain("Preferred article body.");
    expect(result.contentHtml).toContain("git worktree add ../feat-custom-templates");
    expect(result.contentHtml).toContain("<pre><code class=\"language-bash\">");
    expect(result.contentHtml).not.toContain("Want to publish your own Article?");
    expect(result.contentHtml).not.toContain("Upgrade to Premium");
    expect(result.contentHtml).not.toContain(">302<");
    expect(result.contentHtml).not.toContain("External marketing page.");
  });

  it("uses linked-page html fallback to preserve inline image placement", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );
    const html = `
      <html>
        <body>
          <article data-testid="tweet">
            <div data-testid="tweetText">
              <a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a>
            </div>
          </article>
        </body>
      </html>
    `;

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:09:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><head><title>Up Next: The One-Person Million-Dollar Company / X</title></head><body><main><article><h1>Up Next: The One-Person Million-Dollar Company</h1><p>Paragraph before image.</p><img src=\"https://pbs.twimg.com/media/test-inline-position.jpg\" /><p>Paragraph after image.</p></article></main></body></html>",
          title: "Up Next: The One-Person Million-Dollar Company / X",
          text: "Up Next: The One-Person Million-Dollar Company\n\nParagraph before image.\n\nParagraph after image."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Up Next: The One-Person Million-Dollar Company");
    expect(result.contentHtml).toContain('<img src="https://pbs.twimg.com/media/test-inline-position.jpg" alt="" />');

    const beforeIndex = result.contentHtml.indexOf("Paragraph before image.");
    const imageIndex = result.contentHtml.indexOf("test-inline-position.jpg");
    const afterIndex = result.contentHtml.indexOf("Paragraph after image.");
    expect(beforeIndex).toBeGreaterThan(-1);
    expect(imageIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(imageIndex);
  });

  it("does not use image marker lines as fallback title", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:10:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main><img src=\"https://pbs.twimg.com/media/test-title.jpg\" /><p>Readable fallback title line.</p></main></body></html>",
          title: "X",
          text: "[[IMAGE:https://pbs.twimg.com/media/test-title.jpg]]\nReadable fallback title line.\nBody."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Readable fallback title line.");
    expect(result.title).not.toContain("[[IMAGE:");
  });

  it("prefers captured article headline for snapshot title", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:11:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main><div data-testid=\"twitter-article-title\">OpenClaw + Codex/ClaudeCode Agent Swarm: The One-Person Dev Team [Full Setup]</div><div class=\"longform-unstyled\">I don't use Codex or Claude Code directly anymore.</div></main></body></html>",
          title: "X",
          text: "I don't use Codex or Claude Code directly anymore."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("OpenClaw + Codex/ClaudeCode Agent Swarm");
    expect(result.contentHtml).toContain("Codex or Claude Code directly anymore.");
  });

  it("preserves bold and list semantics from rich linked article html", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:12:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><img src=\"https://pbs.twimg.com/media/test-rich.jpg\" /><div data-testid=\"twitter-article-title\">OpenClaw + Codex/ClaudeCode Agent Swarm: The One-Person Dev Team [Full Setup]</div><div data-testid=\"longformRichTextComponent\"><div class=\"longform-unstyled\"><span style=\"font-weight: bold;\">94 commits in one day</span> happened.</div><ul><li class=\"longform-unordered-list-item\"><div><span style=\"font-weight: bold;\">Codex Reviewer</span> catches edge cases.</div></li><li class=\"longform-unordered-list-item\"><div><span style=\"font-weight: bold;\">Gemini Code Assist Reviewer</span> catches scalability issues.</div></li></ul></div></main></body></html>",
          title: "X",
          text: "94 commits in one day happened."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("OpenClaw + Codex/ClaudeCode Agent Swarm");
    expect(result.contentHtml).toContain('<strong>94 commits in one day</strong>');
    expect(result.contentHtml).toContain("<ul><li>");
    expect(result.contentHtml).toContain("<strong>Codex Reviewer</strong>");
    expect(result.contentHtml).toContain("<strong>Gemini Code Assist Reviewer</strong>");
  });

  it("keeps class-based list blocks grouped and preserves bold styles on non-span wrappers", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:13:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><div data-testid=\"twitter-article-title\">OpenClaw + Codex/ClaudeCode Agent Swarm: The One-Person Dev Team [Full Setup]</div><div data-testid=\"longformRichTextComponent\"><div class=\"longform-unstyled\" style=\"font-weight:700\">Up Next: The One-Person Million-Dollar Company</div><div><div class=\"longform-unordered-list-item\"><div style=\"font-weight:700\">Codex Reviewer</div><div>catches edge cases.</div></div><div class=\"longform-unordered-list-item\"><div style=\"font-weight:700\">Gemini Code Assist Reviewer</div><div>catches scalability issues.</div></div></div></div></main></body></html>",
          title: "X",
          text: "Up Next: The One-Person Million-Dollar Company"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("<strong>Up Next: The One-Person Million-Dollar Company</strong>");
    expect(result.contentHtml).toContain("<ul><li>");
    expect(result.contentHtml).toContain("</li><li>");
    expect(result.contentHtml).toContain("<strong>Codex Reviewer</strong>");
    expect(result.contentHtml).toContain("<strong>Gemini Code Assist Reviewer</strong>");
  });

  it("converts dash-prefixed rich blocks into markdown-friendly unordered lists", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:14:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><div data-testid=\"twitter-article-title\">OpenClaw + Codex/ClaudeCode Agent Swarm: The One-Person Dev Team [Full Setup]</div><div class=\"longform-unstyled\">- <strong>94 commits in one day</strong> happened.</div><div class=\"longform-unstyled\">- <strong>7 PRs in 30 minutes</strong> shipped.</div></main></body></html>",
          title: "X",
          text: "94 commits in one day happened."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("<ul><li>");
    expect(result.contentHtml).toContain("<strong>94 commits in one day</strong> happened.");
    expect(result.contentHtml).toContain("<strong>7 PRs in 30 minutes</strong> shipped.");
  });

  it("preserves bold span text inside h2 blocks", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:15:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2><span style=\"font-weight:700\">Important Section Heading</span></h2><p>This body paragraph is long enough to pass the excerpt threshold for extraction.</p></main></body></html>",
          title: "X",
          text: "Important Section Heading"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("<h2>Important Section Heading</h2>");
  });

  it("flattens block wrappers inside h2 so markdown headings do not break into star lines", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:16:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2><strong><div>Why One AI Can't Do Both</div></strong></h2><p>This body paragraph is long enough to pass the excerpt threshold for extraction.</p></main></body></html>",
          title: "X",
          text: "Why One AI Can't Do Both"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("<h2>Why One AI Can&#39;t Do Both</h2>");
    expect(result.contentHtml).not.toContain("<h2><strong>");
    expect(result.contentHtml).not.toContain("<h2><strong><div>");
  });

  it("removes trailing author footer cards that contain profile image and personal link", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/elvissun/status/2025920521871716562",
      finalUrl: "https://x.com/elvissun/status/2025920521871716562",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/DotZ3V6XhJ">https://t.co/DotZ3V6XhJ</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-25T12:17:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/elvissun/article/2025920521871716562",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2>Up Next: The One-Person Million-Dollar Company</h2><p>If you want to see how far I take this, follow along.</p><ul><li><a href=\"/elvissun\"><img src=\"https://pbs.twimg.com/profile_images/1886389973236011008/7EZHFw9k_x96.jpg\" alt=\"\" /></a><a href=\"/elvissun\">@elvissun</a> 2x dad building the modern PR stack in public: <a href=\"https://t.co/JcWBKKpG6Y\">http://medialyst.ai</a></li></ul></main></body></html>",
          title: "X",
          text: "Up Next: The One-Person Million-Dollar Company"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("follow along");
    expect(result.contentHtml).not.toContain("medialyst.ai");
    expect(result.contentHtml).not.toContain("profile_images");
    expect(result.contentHtml).not.toContain("@elvissun");
  });

  it("deduplicates adjacent rich code blocks and removes standalone language label lines", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/ryancarson/status/2023452909883609111",
      finalUrl: "https://x.com/ryancarson/status/2023452909883609111",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/example">https://t.co/example</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-26T12:18:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/ryancarson/article/2023452909883609111",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2>4) Use a single rerun-comment writer with SHA dedupe</h2><p>Use exactly one workflow as canonical rerun requester and dedupe by marker + <code>sha:&lt;head&gt;</code>.</p><pre>typescript\nconst marker = '&lt;!-- review-agent-auto-rerun --&gt;';\nconst trigger = `sha:${headSha}`;</pre><pre>const marker = '&lt;!-- review-agent-auto-rerun --&gt;';\nconst trigger = `sha:${headSha}`;</pre><p>Then continue with next section.</p></main></body></html>",
          title: "X",
          text: "Use exactly one workflow as canonical rerun requester and dedupe by marker."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("Use exactly one workflow as canonical rerun requester and dedupe by marker");
    expect(result.contentHtml).toContain('<pre><code class="language-typescript">');
    expect(result.contentHtml).toContain("const marker = &#39;&lt;!-- review-agent-auto-rerun --&gt;&#39;;");
    expect(result.contentHtml.match(/<pre><code/g)?.length ?? 0).toBe(1);
    expect(result.contentHtml).not.toContain("<code>typescript");
    expect(result.contentHtml).not.toContain("typescript\nconst marker");
  });

  it("prefers prefetched x article content even when tweet is not link-only", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/ryancarson/status/2023452909883609111",
      finalUrl: "https://x.com/ryancarson/status/2023452909883609111",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText">I've been grinding with Codex through setup for Harness Engineering. <a href="https://t.co/example">https://t.co/example</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-26T12:19:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/ryancarson/article/2023452909883609111",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2>Code Factory</h2><p>Use exactly one workflow as canonical rerun requester and dedupe by marker + <code>sha:&lt;head&gt;</code>.</p><p>Additional long-form implementation details that exceed the short tweet summary by a wide margin and represent the main article content. This section intentionally includes enough detail to push article body length well past the fallback threshold: enforce head-SHA freshness, dedupe rerun requests, and preserve deterministic orchestration and policy checks across repeated synchronize events.</p></main></body></html>",
          title: "Code Factory",
          text: "Use exactly one workflow as canonical rerun requester and dedupe by marker."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toContain("Code Factory");
    expect(result.contentHtml).toContain("Linked content extracted from");
    expect(result.contentHtml).toContain("Use exactly one workflow as canonical rerun requester and dedupe by marker");
    expect(result.contentHtml).toContain("Additional long-form implementation details");
  });

  it("treats plaintext code label as language and dedupes adjacent duplicate block", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/ryancarson/status/2023452909883609111",
      finalUrl: "https://x.com/ryancarson/status/2023452909883609111",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/example">https://t.co/example</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-26T12:20:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/ryancarson/article/2023452909883609111",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2>8) Preserve incident memory with a harness-gap loop</h2><pre>plaintext\nproduction regression -> harness gap issue -> case added -> SLA tracked</pre><pre>production regression -> harness gap issue -> case added -> SLA tracked</pre><p>This keeps fixes from becoming one-off patches and grows long-term coverage.</p></main></body></html>",
          title: "X",
          text: "Preserve incident memory"
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain('<pre><code class="language-plaintext">');
    expect(result.contentHtml).toContain("production regression -&gt; harness gap issue -&gt; case added -&gt; SLA tracked");
    expect(result.contentHtml.match(/<pre><code/g)?.length ?? 0).toBe(1);
    expect(result.contentHtml).not.toContain("<code>plaintext");
  });

  it("promotes plain backtick spans to inline code tags to avoid html-like token breakage", async () => {
    const oEmbedFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({})
    }));
    const extractor = new XExtractor(
      oEmbedFetch,
      async () => undefined,
      async () => ({
        ok: false,
        status: 404,
        url: "https://example.com",
        text: async () => ""
      })
    );

    const result = await extractor.extract({
      requestedUrl: "https://x.com/ryancarson/status/2023452909883609111",
      finalUrl: "https://x.com/ryancarson/status/2023452909883609111",
      html: `
        <html><body><article data-testid="tweet"><div data-testid="tweetText"><a href="https://t.co/example">https://t.co/example</a></div></article></body></html>
      `,
      statusCode: 200,
      fetchedAt: "2026-02-26T12:21:00.000Z",
      linkedPages: [
        {
          url: "https://x.com/ryancarson/article/2023452909883609111",
          html: "<html><body><main data-testid=\"twitterArticleReadView\"><h2>4) Use a single rerun-comment writer with SHA dedupe</h2><p>Use exactly one workflow as canonical rerun requester and dedupe by marker + `sha:&lt;head&gt;`.</p><p>Additional long-form body line to pass extraction thresholds and ensure rich mode is selected for this fixture.</p></main></body></html>",
          title: "X",
          text: "Use exactly one workflow as canonical rerun requester and dedupe by marker."
        }
      ]
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.contentHtml).toContain("<code>sha:&lt;head&gt;</code>");
    expect(result.contentHtml).not.toContain("\\`sha:&lt;head&gt;\\`");
  });
});
