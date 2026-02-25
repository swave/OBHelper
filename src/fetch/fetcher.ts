import type { FetchOptions, FetchResult } from "../core/types.js";

export interface Fetcher {
  readonly id: string;
  fetch(options: FetchOptions): Promise<FetchResult>;
}
