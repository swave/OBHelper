import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";
import { fallbackExtractBySelectors } from "./fallback.js";
import { GenericExtractor } from "./generic-extractor.js";

const X_SELECTORS = [
  'article [data-testid="tweetText"]',
  "article",
  "main"
];

export class XExtractor implements ContentExtractor {
  public readonly id = "x";

  private readonly genericExtractor = new GenericExtractor();

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    try {
      return await this.genericExtractor.extract(input);
    } catch {
      return fallbackExtractBySelectors(input, X_SELECTORS);
    }
  }
}
