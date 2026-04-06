import { CdpFetcher } from "../fetch/cdp-fetcher.js";
import { GenericExtractor } from "../extract/generic-extractor.js";
import { WeiboExtractor } from "../extract/weibo-extractor.js";
import { WeixinExtractor } from "../extract/weixin-extractor.js";
import { XExtractor } from "../extract/x-extractor.js";
import { ObsidianWriter } from "../obsidian/writer.js";
import { ExtractorRegistry } from "./extractor-registry.js";

export function createDefaultDependencies(): {
  fetcher: CdpFetcher;
  extractors: ExtractorRegistry;
  writer: ObsidianWriter;
} {
  return {
    fetcher: new CdpFetcher(),
    extractors: new ExtractorRegistry({
      x: new XExtractor(),
      weixin: new WeixinExtractor(),
      weibo: new WeiboExtractor(),
      generic: new GenericExtractor()
    }),
    writer: new ObsidianWriter()
  };
}
