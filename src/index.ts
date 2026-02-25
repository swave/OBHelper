import { runPipeline } from "./core/pipeline.js";
import type { PipelineResult } from "./core/types.js";
import { ObfronterError } from "./core/errors.js";
import { detectSourcePlatform } from "./core/url-source.js";
import { createDefaultDependencies } from "./providers/default-deps.js";

export interface FetchCommandInput {
  url: string;
  vaultPath: string;
  subdirectory?: string;
  timeoutMs?: number;
  browserMode?: boolean;
  forceHttpMode?: boolean;
  sessionProfileDir?: string;
  overwrite?: boolean;
  headers?: Record<string, string>;
}

export async function runFetchCommand(input: FetchCommandInput): Promise<PipelineResult> {
  const inputUrl = new URL(input.url);
  const sourcePlatform = detectSourcePlatform(inputUrl);
  const browserMode = input.forceHttpMode ? false : (input.browserMode ?? sourcePlatform === "x");

  if (sourcePlatform === "x" && browserMode && !input.sessionProfileDir) {
    throw new ObfronterError(
      "SESSION_REQUIRED_FOR_X",
      "X provider defaults to browser mode. Provide --session-profile-dir or use --http-mode for best-effort public extraction."
    );
  }

  const dependencies = createDefaultDependencies({
    browserMode
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
        headers: input.headers
      }
    },
    dependencies
  );
}
