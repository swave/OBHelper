import { describe, expect, it } from "vitest";

import { toNormalizedDocument } from "../../src/markdown/render.js";

describe("toNormalizedDocument", () => {
  it("preserves bold and list semantics in markdown output", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://x.com/example/status/1",
      sourcePlatform: "x",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Test",
        contentHtml: "<h1>Test</h1><p><strong>Bold phrase</strong> in paragraph.</p><ul><li><strong>First</strong> item</li><li>Second item</li></ul>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("**Bold phrase** in paragraph.");
    expect(normalized.markdownBody).toMatch(/-\s+\*\*First\*\* item/);
    expect(normalized.markdownBody).toMatch(/-\s+Second item/);
  });

  it("renders html tables as markdown tables with escaped pipe and inline content", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/table",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Table Test",
        contentHtml:
          "<table><thead><tr><th>Name</th><th>Rule</th></tr></thead><tbody><tr><td>Alpha|Beta</td><td><code>sha:&lt;head&gt;</code></td></tr><tr><td>Line one<br>Line two</td><td><a href=\"https://example.com\">Link</a></td></tr></tbody></table>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("| Name | Rule |");
    expect(normalized.markdownBody).toContain("| --- | --- |");
    expect(normalized.markdownBody).toContain("| Alpha\\|Beta | `sha:<head>` |");
    expect(normalized.markdownBody).toContain("| Line one<br>Line two | [Link](https://example.com) |");
  });

  it("uses first row as header when table has no th cells", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/table",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "No Header Table",
        contentHtml: "<table><tr><td>Feature</td><td>Status</td></tr><tr><td>CDP</td><td>Ready</td></tr></table>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("| Feature | Status |");
    expect(normalized.markdownBody).toContain("| CDP | Ready |");
  });

  it("renders pre blocks as fenced code blocks", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/pre",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Pre Test",
        contentHtml: "<p>Before</p><pre>line 1\n  line 2</pre><p>After</p>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("Before");
    expect(normalized.markdownBody).toContain("```\nline 1\n  line 2\n```");
    expect(normalized.markdownBody).toContain("After");
  });

  it("uses language hint from pre/code class names", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/pre-lang",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Pre Lang Test",
        contentHtml: "<pre><code class=\"language-typescript\">const marker = \"```\";\n</code></pre>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("````typescript");
    expect(normalized.markdownBody).toContain("const marker = \"```\";");
    expect(normalized.markdownBody).toContain("````");
  });

  it("promotes standalone multiline code tags to fenced code blocks", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/code",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Code Tag Test",
        contentHtml:
          "<p>Snippet:</p><p><code class=\"language-typescript\">const marker = '&lt;!-- review-agent-auto-rerun --&gt;';\nconst trigger = `sha:${headSha}`;</code></p>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("```typescript");
    expect(normalized.markdownBody).toContain("const marker = '<!-- review-agent-auto-rerun -->';");
    expect(normalized.markdownBody).toContain("const trigger = `sha:${headSha}`;");
    expect(normalized.markdownBody).toContain("```");
  });

  it("keeps inline code tags inline", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://example.com/code-inline",
      sourcePlatform: "generic",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Inline Code Tag Test",
        contentHtml: "<p>Run <code>npm i obfronter</code> to install.</p>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("Run `npm i obfronter` to install.");
  });

  it("preserves line breaks for weixin-style pre code blocks that use span + br", () => {
    const normalized = toNormalizedDocument({
      sourceUrl: "https://mp.weixin.qq.com/s/mock",
      sourcePlatform: "weixin",
      fetchedAt: "2026-02-26T12:00:00.000Z",
      extracted: {
        title: "Weixin Code Block",
        contentHtml:
          "<pre class=\"js_darkmode__27\"><code class=\"js_darkmode__28\"><span leaf=\"\">my-project/</span><span leaf=\"\"><br></span><span leaf=\"\">├── AGENTS.md       # Agent 入口</span><span leaf=\"\"><br></span><span leaf=\"\">└── repos/</span><span leaf=\"\"><br></span></code></pre>",
        extractionStatus: "ok"
      }
    });

    expect(normalized.markdownBody).toContain("```");
    expect(normalized.markdownBody).toContain("my-project/\n├── AGENTS.md       # Agent 入口\n└── repos/");
  });
});
