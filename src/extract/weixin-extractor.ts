import type { ExtractedMainContent, FetchResult } from "../core/types.js";
import type { ContentExtractor } from "./extractor.js";
import { fallbackExtractBySelectors } from "./fallback.js";
import { GenericExtractor } from "./generic-extractor.js";

const WEIXIN_SELECTORS = [
  "#js_content",
  ".rich_media_content",
  "article"
];

export class WeixinExtractor implements ContentExtractor {
  public readonly id = "weixin";

  private readonly genericExtractor = new GenericExtractor();

  public async extract(input: FetchResult): Promise<ExtractedMainContent> {
    try {
      return await this.genericExtractor.extract(input);
    } catch {
      return fallbackExtractBySelectors(input, WEIXIN_SELECTORS);
    }
  }
}
