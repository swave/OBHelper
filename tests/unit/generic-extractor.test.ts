import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GenericExtractor } from "../../src/extract/generic-extractor.js";

describe("GenericExtractor", () => {
  it("extracts title and content from deterministic fixture html", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/article.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://example.com/post",
      finalUrl: "https://example.com/post",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z"
    });

    expect(result.title).toContain("Fixture Article");
    expect(result.contentHtml).toContain("deterministic fixture paragraph");
  });

  it("extracts content even when page includes heavy non-content blocks", async () => {
    const largeNoise = "x".repeat(200_000);
    const html = [
      "<!doctype html>",
      "<html><head><title>Heavy Page</title>",
      `<script>${largeNoise}</script>`,
      `<style>${largeNoise}</style>`,
      "</head><body>",
      "<article><h1>Heavy Page</h1><p>Real content survives cleanup.</p></article>",
      "</body></html>"
    ].join("");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://example.com/heavy",
      finalUrl: "https://example.com/heavy",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z"
    });

    expect(result.title).toContain("Heavy Page");
    expect(result.contentHtml).toContain("Real content survives cleanup.");
  });

  it("trims unrelated trailing sections for github.blog articles", async () => {
    const html = [
      "<!doctype html>",
      "<html><head><title>Agent HQ</title></head><body>",
      "<article>",
      "<h1>Pick your agent</h1>",
      "<p>Main body paragraph.</p>",
      "<h2>Related posts</h2>",
      "<p>Noise that should be removed.</p>",
      "<h2>Site-wide Links</h2>",
      "<p>More footer noise.</p>",
      "</article>",
      "</body></html>"
    ].join("");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/",
      finalUrl: "https://github.blog/news-insights/company-news/pick-your-agent-use-claude-and-codex-on-agent-hq/",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z"
    });

    expect(result.contentHtml).toContain("Main body paragraph.");
    expect(result.contentHtml).not.toContain("Related posts");
    expect(result.contentHtml).not.toContain("Noise that should be removed.");
    expect(result.contentHtml).not.toContain("Site-wide Links");
  });

  it("appends recovered code blocks when extracted content has none", async () => {
    const html = [
      "<!doctype html>",
      "<html><head><title>Agent</title></head><body>",
      "<article>",
      "<h1>Agent</h1>",
      "<p>Intro paragraph.</p>",
      "<p>Another paragraph.</p>",
      "</article>",
      "</body></html>"
    ].join("");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://example.com/agent",
      finalUrl: "https://example.com/agent",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z",
      capturedCodeBlocks: [
        {
          text: "mkdir agent\ncd agent\nbun init -y"
        }
      ]
    });

    expect(result.contentHtml).toContain("Recovered Code Blocks");
    expect(result.contentHtml).toContain("mkdir agent");
    expect(result.contentHtml).toContain("bun init -y");
    expect(result.contentHtml).toContain("<pre><code>");
  });

  it("inserts recovered code blocks near captured context anchors", async () => {
    const html = [
      "<!doctype html>",
      "<html><head><title>Agent</title></head><body>",
      "<article>",
      "<h1>Agent</h1>",
      "<p>Let's start by creating our project.</p>",
      "<p>Now that we have everything installed, let's start coding our agent out.</p>",
      "</article>",
      "</body></html>"
    ].join("");

    const extractor = new GenericExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://example.com/agent",
      finalUrl: "https://example.com/agent",
      html,
      statusCode: 200,
      fetchedAt: "2026-01-01T10:00:00.000Z",
      capturedCodeBlocks: [
        {
          text: "mkdir agent\ncd agent\nbun init -y",
          beforeText: "Let's start by creating our project.",
          afterText: "Now that we have everything installed, let's start coding our agent out."
        }
      ]
    });

    const beforeIndex = result.contentHtml.indexOf("Let's start by creating our project.");
    const codeIndex = result.contentHtml.indexOf("mkdir agent");
    const afterIndex = result.contentHtml.indexOf("Now that we have everything installed");

    expect(codeIndex).toBeGreaterThan(beforeIndex);
    expect(afterIndex).toBeGreaterThan(codeIndex);
    expect(result.contentHtml).not.toContain("Recovered Code Blocks");
  });
});
