import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { WeixinExtractor } from "../../src/extract/weixin-extractor.js";

describe("WeixinExtractor", () => {
  it("extracts main content, metadata, and images from a weixin article", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/weixin_article.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new WeixinExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://mp.weixin.qq.com/s?__biz=Mzkx&mid=2247483647&idx=1&sn=abcd1234",
      finalUrl: "https://mp.weixin.qq.com/s?__biz=Mzkx&mid=2247483647&idx=1&sn=abcd1234",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-27T10:01:00.000Z"
    });

    expect(result.extractionStatus).toBe("ok");
    expect(result.title).toBe("公众号文章标题");
    expect(result.byline).toBe("测试公众号");
    expect(result.publishedAt).toBe("2026-02-27T10:00:00.000Z");
    expect(result.excerpt).toContain("这是第一段正文");
    expect(result.mediaUrls).toEqual(["https://mmbiz.qpic.cn/mmbiz_jpg/FIXTURE1/0"]);
  });

  it("returns blocked-note extraction for deleted articles", async () => {
    const fixturePath = path.join(process.cwd(), "tests/fixtures/weixin_blocked.html");
    const html = await readFile(fixturePath, "utf8");

    const extractor = new WeixinExtractor();
    const result = await extractor.extract({
      requestedUrl: "https://mp.weixin.qq.com/s?__biz=Mzkx&mid=1&idx=1&sn=dead",
      finalUrl: "https://mp.weixin.qq.com/s?__biz=Mzkx&mid=1&idx=1&sn=dead",
      html,
      statusCode: 200,
      fetchedAt: "2026-02-27T10:02:00.000Z"
    });

    expect(result.extractionStatus).toBe("blocked");
    expect(result.title).toContain("(Blocked)");
    expect(result.excerpt).toContain("unavailable or deleted");
    expect(result.contentHtml).toContain("Open source URL");
  });
});
