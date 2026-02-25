import { z } from "zod";

import { detectSourcePlatform, isWeixinArticleUrl, isXStatusUrl } from "./url-source.js";
import type { PipelineInput, PipelineResult } from "./types.js";
import { toNormalizedDocument } from "../markdown/render.js";
import type { Fetcher } from "../fetch/fetcher.js";
import type { DocumentWriter } from "../obsidian/writer.js";
import type { ExtractorResolver } from "../providers/extractor-registry.js";
import { ObfronterError } from "./errors.js";

const pipelineInputSchema = z.object({
  url: z.string().url(),
  write: z.object({
    vaultPath: z.string().min(1),
    subdirectory: z.string().optional(),
    overwrite: z.boolean().optional()
  }),
  fetch: z.object({
    timeoutMs: z.number().int().positive().optional(),
    sessionProfileDir: z.string().optional(),
    headers: z.record(z.string()).optional()
  })
});

export async function runPipeline(
  input: PipelineInput,
  dependencies: {
    fetcher: Fetcher;
    extractors: ExtractorResolver;
    writer: DocumentWriter;
  }
): Promise<PipelineResult> {
  const parsed = pipelineInputSchema.parse(input);
  const parsedUrl = new URL(parsed.url);
  const sourcePlatform = detectSourcePlatform(parsedUrl);

  if (sourcePlatform === "x" && !isXStatusUrl(parsedUrl)) {
    throw new ObfronterError(
      "X_STATUS_URL_REQUIRED",
      `X provider currently supports only status URLs: ${parsedUrl.toString()}`
    );
  }

  if (sourcePlatform === "weixin" && !isWeixinArticleUrl(parsedUrl)) {
    throw new ObfronterError(
      "WEIXIN_ARTICLE_URL_REQUIRED",
      `Weixin provider currently supports only article URLs: ${parsedUrl.toString()}`
    );
  }

  const fetched = await dependencies.fetcher.fetch({
    url: parsedUrl.toString(),
    timeoutMs: parsed.fetch.timeoutMs,
    sessionProfileDir: parsed.fetch.sessionProfileDir,
    headers: parsed.fetch.headers
  });

  const extractor = dependencies.extractors.resolve(sourcePlatform);
  const extracted = await extractor.extract(fetched);

  const normalized = toNormalizedDocument({
    sourceUrl: fetched.finalUrl,
    sourcePlatform,
    fetchedAt: fetched.fetchedAt,
    extracted
  });

  const saved = await dependencies.writer.write(normalized, parsed.write);

  return {
    sourcePlatform,
    normalized,
    saved
  };
}
