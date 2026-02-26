import { describe, expect, it } from "vitest";

import {
  detectSourcePlatform,
  isWeixinArticleUrl,
  isXStatusUrl,
  parseWeixinArticleRef,
  parseXStatusRef
} from "../../src/core/url-source.js";

describe("detectSourcePlatform", () => {
  it("detects x domains", () => {
    expect(detectSourcePlatform(new URL("https://x.com/someone/status/1"))).toBe("x");
    expect(detectSourcePlatform(new URL("https://twitter.com/someone/status/1"))).toBe("x");
  });

  it("detects weixin domains", () => {
    expect(detectSourcePlatform(new URL("https://mp.weixin.qq.com/s/abc"))).toBe("weixin");
  });

  it("detects weibo domains", () => {
    expect(detectSourcePlatform(new URL("https://weibo.com/123"))).toBe("weibo");
    expect(detectSourcePlatform(new URL("https://m.weibo.cn/status/abc"))).toBe("weibo");
  });

  it("falls back to generic", () => {
    expect(detectSourcePlatform(new URL("https://example.com/post"))).toBe("generic");
  });

  it("parses x status url details", () => {
    expect(parseXStatusRef(new URL("https://x.com/someone/status/12345"))).toEqual({
      authorHandle: "someone",
      statusId: "12345"
    });
    expect(parseXStatusRef(new URL("https://x.com/i/web/status/888"))).toEqual({
      statusId: "888"
    });
  });

  it("accepts only x status URLs in x-specific parser", () => {
    expect(isXStatusUrl(new URL("https://x.com/someone/status/12345"))).toBe(true);
    expect(isXStatusUrl(new URL("https://x.com/someone"))).toBe(false);
  });

  it("parses weixin article url details", () => {
    expect(
      parseWeixinArticleRef(
        new URL("https://mp.weixin.qq.com/s?__biz=Mzkx&mid=2247483647&idx=1&sn=abcd1234")
      )
    ).toEqual({
      biz: "Mzkx",
      mid: "2247483647",
      idx: "1",
      sn: "abcd1234"
    });

    expect(parseWeixinArticleRef(new URL("https://mp.weixin.qq.com/s/IhuDaFRvu6fELTFW2uLB0Q"))).toEqual({
      shortCode: "IhuDaFRvu6fELTFW2uLB0Q"
    });
  });

  it("accepts only weixin article URLs in weixin-specific parser", () => {
    expect(
      isWeixinArticleUrl(
        new URL("https://mp.weixin.qq.com/s?__biz=Mzkx&mid=2247483647&idx=1&sn=abcd1234")
      )
    ).toBe(true);
    expect(isWeixinArticleUrl(new URL("https://mp.weixin.qq.com/s/IhuDaFRvu6fELTFW2uLB0Q"))).toBe(true);
    expect(isWeixinArticleUrl(new URL("https://mp.weixin.qq.com/s"))).toBe(false);
    expect(isWeixinArticleUrl(new URL("https://mp.weixin.qq.com/mp/profile_ext?action=home"))).toBe(false);
  });
});
