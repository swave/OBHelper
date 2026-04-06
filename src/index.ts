import { runPipeline } from "./core/pipeline.js";
import type { PipelineResult } from "./core/types.js";
import { ObfronterError } from "./core/errors.js";
import { createDefaultDependencies } from "./providers/default-deps.js";
import type { Fetcher } from "./fetch/fetcher.js";
import type { DocumentWriter } from "./obsidian/writer.js";
import type { ExtractorResolver } from "./providers/extractor-registry.js";

export interface FetchCommandInput {
  url: string;
  vaultPath: string;
  timeoutMs?: number;
  cdpEndpoint?: string;
  cdpAutoLaunch?: boolean;
  overwrite?: boolean;
}

interface FetchCommandDependencies {
  createDependencies: () => {
    fetcher: Fetcher;
    extractors: ExtractorResolver;
    writer: DocumentWriter;
  };
}

export async function runFetchCommand(
  input: FetchCommandInput,
  overrides?: Partial<FetchCommandDependencies>
): Promise<PipelineResult> {
  const cdpEndpoint = input.cdpEndpoint?.trim() || undefined;
  if (!cdpEndpoint) {
    throw new ObfronterError(
      "CDP_ENDPOINT_REQUIRED",
      "Missing CDP endpoint. Use --cdp-endpoint, OBHELPER_CDP_ENDPOINT, or `obhelper settings set cdp-endpoint <url>`."
    );
  }

  const createDependencies = overrides?.createDependencies ?? createDefaultDependencies;
  const dependencies = createDependencies();

  return runPipeline(
    {
      url: input.url,
      write: {
        vaultPath: input.vaultPath,
        overwrite: input.overwrite
      },
      fetch: {
        timeoutMs: input.timeoutMs,
        cdpEndpoint,
        cdpAutoLaunch: input.cdpAutoLaunch,
      }
    },
    dependencies
  );
}
