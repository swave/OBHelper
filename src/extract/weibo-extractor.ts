import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";
import { fallbackExtractBySelectors } from "./fallback.js";
import { GenericExtractor } from "./generic-extractor.js";

const WEIBO_SELECTORS = [
  ".weibo-text",
  ".detail_wbtext_4CRf9",
  "article",
  "main"
];

export class WeiboExtractor implements ContentExtractor {
  public readonly id = "weibo";

  private readonly genericExtractor = new GenericExtractor();

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    try {
      return await this.genericExtractor.extract(input);
    } catch {
      return fallbackExtractBySelectors(input, WEIBO_SELECTORS);
    }
  }
}
