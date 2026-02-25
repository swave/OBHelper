import { runPipeline } from "./core/pipeline.js";
import type { BrowserChannel, PipelineResult } from "./core/types.js";
import { ObfronterError } from "./core/errors.js";
import { detectSourcePlatform } from "./core/url-source.js";
import { createDefaultDependencies, type FetchMode } from "./providers/default-deps.js";
import type { Fetcher } from "./fetch/fetcher.js";
import type { DocumentWriter } from "./obsidian/writer.js";
import type { ExtractorResolver } from "./providers/extractor-registry.js";

export interface FetchCommandInput {
  url: string;
  vaultPath: string;
  subdirectory?: string;
  timeoutMs?: number;
  browserMode?: boolean;
  forceHttpMode?: boolean;
  sessionProfileDir?: string;
  browserChannel?: BrowserChannel;
  cdpEndpoint?: string;
  overwrite?: boolean;
  headers?: Record<string, string>;
}

interface FetchCommandDependencies {
  createDependencies: (options: { fetchMode: FetchMode }) => {
    fetcher: Fetcher;
    extractors: ExtractorResolver;
    writer: DocumentWriter;
  };
}

export async function runFetchCommand(
  input: FetchCommandInput,
  overrides?: Partial<FetchCommandDependencies>
): Promise<PipelineResult> {
  const inputUrl = new URL(input.url);
  const sourcePlatform = detectSourcePlatform(inputUrl);
  const cdpEndpoint = input.cdpEndpoint?.trim() || undefined;
  const browserMode = input.forceHttpMode ? false : (input.browserMode ?? sourcePlatform === "x");
  const fetchMode: FetchMode = input.forceHttpMode
    ? "http"
    : cdpEndpoint
      ? "cdp"
      : browserMode
        ? "browser"
        : "http";
  const browserChannel = fetchMode === "browser"
    ? (input.browserChannel ?? (sourcePlatform === "x" ? "chrome" : undefined))
    : undefined;

  if (sourcePlatform === "x" && fetchMode === "browser" && !input.sessionProfileDir) {
    throw new ObfronterError(
      "SESSION_REQUIRED_FOR_X",
      "X provider defaults to browser mode. Provide --session-profile-dir, use --cdp-endpoint, or use --http-mode for best-effort public extraction."
    );
  }

  const createDependencies = overrides?.createDependencies ?? createDefaultDependencies;
  const dependencies = createDependencies({
    fetchMode
  });

  return runPipeline(
    {
      url: input.url,
      write: {
        vaultPath: input.vaultPath,
        subdirectory: input.subdirectory,
        overwrite: input.overwrite
      },
      fetch: {
        timeoutMs: input.timeoutMs,
        sessionProfileDir: input.sessionProfileDir,
        browserChannel,
        cdpEndpoint,
        headers: input.headers
      }
    },
    dependencies
  );
}
