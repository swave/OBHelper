import { describe, expect, it } from "vitest";

import { resolveFetchCliOptions } from "../../src/cli-fetch-options.js";

describe("resolveFetchCliOptions", () => {
  it("throws for browser mode + http mode", () => {
    expect(() =>
      resolveFetchCliOptions({
        browserMode: true,
        httpMode: true
      })
    ).toThrow("Choose only one of --browser-mode or --http-mode.");
  });

  it("throws for http mode + explicit cdp endpoint flag", () => {
    expect(() =>
      resolveFetchCliOptions({
        httpMode: true,
        cdpEndpointFlag: "http://127.0.0.1:9222"
      })
    ).toThrow("Choose only one of --http-mode or --cdp-endpoint.");
  });

  it("ignores env cdp endpoint when http mode is enabled", () => {
    expect(
      resolveFetchCliOptions({
        httpMode: true,
        cdpEndpointEnv: "http://127.0.0.1:9222"
      })
    ).toEqual({
      cdpEndpoint: undefined
    });
  });

  it("prefers explicit cdp endpoint flag over env endpoint", () => {
    expect(
      resolveFetchCliOptions({
        cdpEndpointFlag: "http://127.0.0.1:9333",
        cdpEndpointEnv: "http://127.0.0.1:9222"
      })
    ).toEqual({
      cdpEndpoint: "http://127.0.0.1:9333"
    });
  });

  it("throws when cdp endpoint and session profile dir are both provided", () => {
    expect(() =>
      resolveFetchCliOptions({
        cdpEndpointFlag: "http://127.0.0.1:9222",
        sessionProfileDir: "/tmp/profile"
      })
    ).toThrow("Choose one browser session source: --session-profile-dir or --cdp-endpoint.");
  });
});
