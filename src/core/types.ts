export type SourcePlatform = "x" | "weixin" | "weibo" | "generic";

export interface FetchOptions {
  url: string;
  timeoutMs?: number;
  sessionProfileDir?: string;
  headers?: Record<string, string>;
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  statusCode: number;
  fetchedAt: string;
}

export interface ExtractedMainContent {
  title: string;
  contentHtml: string;
  byline?: string;
  excerpt?: string;
  publishedAt?: string;
}

export interface NormalizedDocument {
  sourceUrl: string;
  sourcePlatform: SourcePlatform;
  fetchedAt: string;
  title: string;
  markdownBody: string;
  byline?: string;
  excerpt?: string;
  publishedAt?: string;
}

export interface WriteOptions {
  vaultPath: string;
  subdirectory?: string;
  overwrite?: boolean;
}

export interface SaveResult {
  outputPath: string;
  created: boolean;
  fileName: string;
}

export interface PipelineInput {
  url: string;
  write: WriteOptions;
  fetch: Omit<FetchOptions, "url">;
}

export interface PipelineResult {
  sourcePlatform: SourcePlatform;
  normalized: NormalizedDocument;
  saved: SaveResult;
}
