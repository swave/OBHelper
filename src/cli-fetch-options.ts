import { ObfronterError } from "./core/errors.js";

type ResolveFetchCliOptionsInput = {
  browserMode?: boolean;
  httpMode?: boolean;
  cdpEndpointFlag?: string;
  cdpEndpointEnv?: string;
  cdpAutoLaunchEnabled?: boolean;
  cdpAutoLaunchDisabled?: boolean;
  cdpAutoLaunchDefault?: boolean;
  sessionProfileDir?: string;
};

export type ResolveFetchCliOptionsResult = {
  cdpEndpoint?: string;
  cdpAutoLaunch: boolean;
};

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function resolveFetchCliOptions(input: ResolveFetchCliOptionsInput): ResolveFetchCliOptionsResult {
  const browserMode = Boolean(input.browserMode);
  const httpMode = Boolean(input.httpMode);
  const cdpAutoLaunchEnabled = Boolean(input.cdpAutoLaunchEnabled);
  const cdpAutoLaunchDisabled = Boolean(input.cdpAutoLaunchDisabled);
  const cdpEndpointFromFlag = normalizeOptionalString(input.cdpEndpointFlag);
  const cdpEndpointFromEnv = normalizeOptionalString(input.cdpEndpointEnv);
  const sessionProfileDir = normalizeOptionalString(input.sessionProfileDir);

  if (browserMode && httpMode) {
    throw new ObfronterError("INVALID_MODE", "Choose only one of --browser-mode or --http-mode.");
  }

  if (httpMode && cdpEndpointFromFlag) {
    throw new ObfronterError("INVALID_MODE", "Choose only one of --http-mode or --cdp-endpoint.");
  }

  if (cdpAutoLaunchEnabled && cdpAutoLaunchDisabled) {
    throw new ObfronterError(
      "INVALID_MODE",
      "Choose only one of --cdp-auto-launch or --no-cdp-auto-launch."
    );
  }

  if (httpMode && cdpAutoLaunchEnabled) {
    throw new ObfronterError("INVALID_MODE", "Choose only one of --http-mode or --cdp-auto-launch.");
  }

  // Explicit --http-mode should disable browser/CDP mode, even if an env endpoint is present.
  const cdpEndpoint = httpMode ? undefined : cdpEndpointFromFlag || cdpEndpointFromEnv;
  if (cdpEndpoint && sessionProfileDir) {
    throw new ObfronterError(
      "INVALID_MODE",
      "Choose one browser session source: --session-profile-dir or --cdp-endpoint."
    );
  }

  if (cdpAutoLaunchEnabled && !cdpEndpoint) {
    throw new ObfronterError(
      "CDP_ENDPOINT_REQUIRED",
      "--cdp-auto-launch requires --cdp-endpoint (or OBHELPER_CDP_ENDPOINT)."
    );
  }

  return {
    cdpEndpoint,
    cdpAutoLaunch: cdpAutoLaunchEnabled
      ? true
      : cdpAutoLaunchDisabled
        ? false
        : cdpEndpoint
          ? Boolean(input.cdpAutoLaunchDefault)
          : false
  };
}
