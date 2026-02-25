import { ObfronterError } from "../core/errors.js";
import type { FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export class HttpFetcher implements Fetcher {
  public readonly id = "http";

  public async fetch(options: FetchOptions): Promise<FetchResult> {
    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const response = await fetch(options.url, {
      headers: {
        "user-agent": DEFAULT_USER_AGENT,
        ...options.headers
      },
      redirect: "follow",
      signal
    });

    if (!response.ok) {
      throw new ObfronterError(
        "FETCH_FAILED",
        `Unable to fetch ${options.url} (${response.status} ${response.statusText})`
      );
    }

    return {
      requestedUrl: options.url,
      finalUrl: response.url,
      html: await response.text(),
      statusCode: response.status,
      fetchedAt: new Date().toISOString()
    };
  }
}
