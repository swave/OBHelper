export type SourcePlatform = "x" | "weixin" | "weibo" | "generic";
export type BrowserChannel = "chrome" | "chromium" | "msedge";

export interface FetchOptions {
  url: string;
  timeoutMs?: number;
  sessionProfileDir?: string;
  browserChannel?: BrowserChannel;
  cdpEndpoint?: string;
  cdpAutoLaunch?: boolean;
  headers?: Record<string, string>;
}

export interface FetchLinkedPage {
  url: string;
  html: string;
  title?: string;
  text?: string;
}

export interface CapturedCodeBlock {
  text: string;
  beforeText?: string;
  afterText?: string;
}

export interface FetchResult {
  requestedUrl: string;
  finalUrl: string;
  html: string;
  statusCode: number;
  fetchedAt: string;
  linkedPages?: FetchLinkedPage[];
  capturedCodeBlocks?: CapturedCodeBlock[];
}

export interface ExtractedMainContent {
  title: string;
  contentHtml: string;
  byline?: string;
  excerpt?: string;
  publishedAt?: string;
  extractionStatus?: "ok" | "blocked";
  authorHandle?: string;
  statusId?: string;
  mediaUrls?: string[];
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
  extractionStatus?: "ok" | "blocked";
  authorHandle?: string;
  statusId?: string;
  mediaUrls?: string[];
}

export interface WriteOptions {
  vaultPath: string;
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
