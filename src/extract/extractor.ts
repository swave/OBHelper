import type { ExtractedMainContent, FetchResult } from "../core/types.js";

export interface ContentExtractor {
  readonly id: string;
  extract(input: FetchResult): Promise<ExtractedMainContent>;
}
