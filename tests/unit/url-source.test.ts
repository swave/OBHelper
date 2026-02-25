import { describe, expect, it } from "vitest";

import { detectSourcePlatform } from "../../src/core/url-source.js";

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
});
