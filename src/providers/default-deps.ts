import { BrowserFetcher } from "../fetch/browser-fetcher.js";
import { HttpFetcher } from "../fetch/http-fetcher.js";
import { GenericExtractor } from "../extract/generic-extractor.js";
import { WeiboExtractor } from "../extract/weibo-extractor.js";
import { WeixinExtractor } from "../extract/weixin-extractor.js";
import { XExtractor } from "../extract/x-extractor.js";
import { ObsidianWriter } from "../obsidian/writer.js";
import { ExtractorRegistry } from "./extractor-registry.js";

export function createDefaultDependencies(options: {
  browserMode: boolean;
}): {
  fetcher: BrowserFetcher | HttpFetcher;
  extractors: ExtractorRegistry;
  writer: ObsidianWriter;
} {
  return {
    fetcher: options.browserMode ? new BrowserFetcher() : new HttpFetcher(),
    extractors: new ExtractorRegistry({
      x: new XExtractor(),
      weixin: new WeixinExtractor(),
      weibo: new WeiboExtractor(),
      generic: new GenericExtractor()
    }),
    writer: new ObsidianWriter()
  };
}
