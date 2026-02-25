import type { SourcePlatform } from "../core/types.js";
import type { ContentExtractor } from "../extract/extractor.js";

export interface ExtractorResolver {
  resolve(sourcePlatform: SourcePlatform): ContentExtractor;
}

export class ExtractorRegistry implements ExtractorResolver {
  private readonly extractors: Map<SourcePlatform, ContentExtractor>;
  private readonly genericExtractor: ContentExtractor;

  public constructor(input: {
    x: ContentExtractor;
    weixin: ContentExtractor;
    weibo: ContentExtractor;
    generic: ContentExtractor;
  }) {
    this.genericExtractor = input.generic;
    this.extractors = new Map<SourcePlatform, ContentExtractor>([
      ["x", input.x],
      ["weixin", input.weixin],
      ["weibo", input.weibo],
      ["generic", input.generic]
    ]);
  }

  public resolve(sourcePlatform: SourcePlatform): ContentExtractor {
    return this.extractors.get(sourcePlatform) ?? this.genericExtractor;
  }
}
