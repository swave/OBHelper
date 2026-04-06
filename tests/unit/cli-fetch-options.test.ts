import { describe, expect, it } from "vitest";

import { resolveFetchCliOptions } from "../../src/cli-fetch-options.js";

describe("resolveFetchCliOptions", () => {
  it("throws when both cdp auto-launch toggles are enabled", () => {
    expect(() =>
      resolveFetchCliOptions({
        cdpAutoLaunchEnabled: true,
        cdpAutoLaunchDisabled: true
      })
    ).toThrow("Choose only one of --cdp-auto-launch or --no-cdp-auto-launch.");
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
