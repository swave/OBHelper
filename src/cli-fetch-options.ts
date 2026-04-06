import { ObfronterError } from "./core/errors.js";

type ResolveFetchCliOptionsInput = {
  cdpEndpointFlag?: string;
  cdpEndpointEnv?: string;
  cdpAutoLaunchEnabled?: boolean;
  cdpAutoLaunchDisabled?: boolean;
  cdpAutoLaunchDefault?: boolean;
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
  const cdpAutoLaunchEnabled = Boolean(input.cdpAutoLaunchEnabled);
  const cdpAutoLaunchDisabled = Boolean(input.cdpAutoLaunchDisabled);
  const cdpEndpointFromFlag = normalizeOptionalString(input.cdpEndpointFlag);
  const cdpEndpointFromEnv = normalizeOptionalString(input.cdpEndpointEnv);

  if (cdpAutoLaunchEnabled && cdpAutoLaunchDisabled) {
    throw new ObfronterError(
      "INVALID_MODE",
      "Choose only one of --cdp-auto-launch or --no-cdp-auto-launch."
    );
  }

  const cdpEndpoint = cdpEndpointFromFlag || cdpEndpointFromEnv;

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
