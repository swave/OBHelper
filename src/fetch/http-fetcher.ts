import { ObfronterError } from "../core/errors.js";
import type { FetchOptions, FetchResult } from "../core/types.js";
import type { Fetcher } from "./fetcher.js";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ObfronterError("FETCH_FAILED", message));
    }, timeoutMs);

    void work
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => clearTimeout(timer));
  });
}

export class HttpFetcher implements Fetcher {
  public readonly id = "http";

  public async fetch(options: FetchOptions): Promise<FetchResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const signal = AbortSignal.timeout(timeoutMs);
    let response: Response;
    try {
      response = await fetch(options.url, {
        headers: {
          "user-agent": DEFAULT_USER_AGENT,
          ...options.headers
        },
        redirect: "follow",
        signal
      });
    } catch (error) {
      const primary = error instanceof Error ? error.message : String(error);
      const nestedCode = error instanceof Error && typeof error.cause === "object" && error.cause !== null
        ? (Reflect.get(error.cause, "code") as string | undefined)
        : undefined;
      const nestedMessage = error instanceof Error && typeof error.cause === "object" && error.cause !== null
        ? (Reflect.get(error.cause, "message") as string | undefined)
        : undefined;
      const nested = [nestedCode, nestedMessage].filter((part): part is string => Boolean(part && part.length > 0)).join(" ");
      const reason = nested.length > 0 ? `${primary}; cause: ${nested}` : primary;
      throw new ObfronterError("FETCH_FAILED", `Unable to fetch ${options.url} (${reason})`);
    }

    if (!response.ok) {
      throw new ObfronterError(
        "FETCH_FAILED",
        `Unable to fetch ${options.url} (${response.status} ${response.statusText})`
      );
    }

    const html = await withTimeout(
      response.text(),
      timeoutMs,
      `Timed out while reading response body from ${response.url || options.url}`
    );

    return {
      requestedUrl: options.url,
      finalUrl: response.url,
      html,
      statusCode: response.status,
      fetchedAt: new Date().toISOString()
    };
  }
}
