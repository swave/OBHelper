import { runPipeline } from "./core/pipeline.js";
import type { PipelineResult } from "./core/types.js";
import { createDefaultDependencies } from "./providers/default-deps.js";

export interface FetchCommandInput {
  url: string;
  vaultPath: string;
  subdirectory?: string;
  timeoutMs?: number;
  browserMode?: boolean;
  sessionProfileDir?: string;
  overwrite?: boolean;
  headers?: Record<string, string>;
}

export async function runFetchCommand(input: FetchCommandInput): Promise<PipelineResult> {
  const dependencies = createDefaultDependencies({
    browserMode: input.browserMode ?? false
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
