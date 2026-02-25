import { describe, expect, it } from "vitest";

import { resolveCookieHeader } from "../../src/core/cookie-header.js";

describe("resolveCookieHeader", () => {
  it("returns undefined when no cookie source is provided", async () => {
    await expect(resolveCookieHeader({})).resolves.toBeUndefined();
  });

  it("reads cookie from env var", async () => {
    await expect(
      resolveCookieHeader({
        cookieEnvName: "X_COOKIE",
        env: {
          X_COOKIE: "auth_token=a; ct0=b"
        }
      })
    ).resolves.toBe("auth_token=a; ct0=b");
  });

  it("reads raw cookie header from file", async () => {
    await expect(
      resolveCookieHeader({
        cookieFile: "/tmp/cookie.txt",
        readFileText: async () => "auth_token=a; ct0=b"
      })
    ).resolves.toBe("auth_token=a; ct0=b");
  });

  it("parses netscape cookie file into cookie header", async () => {
    const netscape = [
      "# Netscape HTTP Cookie File",
      ".x.com\tTRUE\t/\tTRUE\t0\tauth_token\taaa",
      ".x.com\tTRUE\t/\tTRUE\t0\tct0\tbbb"
    ].join("\n");

    await expect(
      resolveCookieHeader({
        cookieFile: "/tmp/cookies.txt",
        readFileText: async () => netscape
      })
    ).resolves.toBe("auth_token=aaa; ct0=bbb");
  });

  it("rejects when both cookie-file and cookie-env are provided", async () => {
    await expect(
      resolveCookieHeader({
        cookieFile: "/tmp/cookies.txt",
        cookieEnvName: "X_COOKIE"
      })
    ).rejects.toThrow("Choose only one of --cookie-file or --cookie-env");
  });

  it("rejects when cookie env is missing", async () => {
    await expect(
      resolveCookieHeader({
        cookieEnvName: "X_COOKIE",
        env: {}
      })
    ).rejects.toThrow("Environment variable not found or empty");
  });
});
