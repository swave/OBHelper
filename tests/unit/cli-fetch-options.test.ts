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
      cdpEndpoint: undefined,
      cdpAutoLaunch: false
    });
  });

  it("prefers explicit cdp endpoint flag over env endpoint", () => {
    expect(
      resolveFetchCliOptions({
        cdpEndpointFlag: "http://127.0.0.1:9333",
        cdpEndpointEnv: "http://127.0.0.1:9222"
      })
    ).toEqual({
      cdpEndpoint: "http://127.0.0.1:9333",
      cdpAutoLaunch: false
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

  it("throws for http mode + cdp auto launch", () => {
    expect(() =>
      resolveFetchCliOptions({
        httpMode: true,
        cdpAutoLaunchEnabled: true
      })
    ).toThrow("Choose only one of --http-mode or --cdp-auto-launch.");
  });

  it("throws when cdp auto launch is enabled without a cdp endpoint", () => {
    expect(() =>
      resolveFetchCliOptions({
        cdpAutoLaunchEnabled: true
      })
    ).toThrow("--cdp-auto-launch requires --cdp-endpoint");
  });

  it("keeps cdp auto launch when endpoint comes from env", () => {
    expect(
      resolveFetchCliOptions({
        cdpEndpointEnv: "http://127.0.0.1:9222",
        cdpAutoLaunchEnabled: true
      })
    ).toEqual({
      cdpEndpoint: "http://127.0.0.1:9222",
      cdpAutoLaunch: true
    });
  });

  it("uses stored cdp auto launch only when a cdp endpoint exists", () => {
    expect(
      resolveFetchCliOptions({
        cdpEndpointEnv: "http://127.0.0.1:9222",
        cdpAutoLaunchDefault: true
      })
    ).toEqual({
      cdpEndpoint: "http://127.0.0.1:9222",
      cdpAutoLaunch: true
    });

    expect(
      resolveFetchCliOptions({
        cdpAutoLaunchDefault: true
      })
    ).toEqual({
      cdpEndpoint: undefined,
      cdpAutoLaunch: false
    });
  });

  it("lets explicit disable override stored cdp auto launch", () => {
    expect(
      resolveFetchCliOptions({
        cdpEndpointEnv: "http://127.0.0.1:9222",
        cdpAutoLaunchDefault: true,
        cdpAutoLaunchDisabled: true
      })
    ).toEqual({
      cdpEndpoint: "http://127.0.0.1:9222",
      cdpAutoLaunch: false
    });
  });
});
