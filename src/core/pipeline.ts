import { z } from "zod";

import { detectSourcePlatform, isWeixinArticleUrl, isXStatusUrl } from "./url-source.js";
import type { ExtractedMainContent, NormalizedDocument, PipelineInput, PipelineResult } from "./types.js";
import { toNormalizedDocument } from "../markdown/render.js";
import type { Fetcher } from "../fetch/fetcher.js";
import type { DocumentWriter } from "../obsidian/writer.js";
import type { ExtractorResolver } from "../providers/extractor-registry.js";
import { ObfronterError } from "./errors.js";

const pipelineInputSchema = z.object({
  url: z.string().url(),
  write: z.object({
    vaultPath: z.string().min(1),
    overwrite: z.boolean().optional()
  }),
  fetch: z.object({
    timeoutMs: z.number().int().positive().optional(),
    cdpEndpoint: z.string().optional(),
    cdpAutoLaunch: z.boolean().optional(),
  })
});

const DEFAULT_STAGE_TIMEOUT_MS = 20_000;
const MAX_MARKDOWN_SNIPPET_LENGTH = 12_000;

async function withStageTimeout<T>(stage: string, timeoutMs: number, work: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(
        new ObfronterError(
          "PIPELINE_STAGE_TIMEOUT",
          `${stage} timed out after ${timeoutMs}ms. Try --timeout-ms with a larger value.`
        )
      );
    }, timeoutMs);

    void work()
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => {
        if (timer) {
          clearTimeout(timer);
        }
      });
  });
}

function isPipelineStageTimeout(error: unknown): error is ObfronterError {
  return error instanceof ObfronterError && error.code === "PIPELINE_STAGE_TIMEOUT";
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inferFallbackTitle(html: string, fallbackUrl: URL): string {
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1]?.trim();
  if (ogTitle && ogTitle.length > 0) {
    return ogTitle;
  }

  const pageTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (pageTitle && pageTitle.length > 0) {
    return pageTitle;
  }

  return fallbackUrl.hostname;
}

function stripHtmlToMarkdownSnippet(html: string): string {
  const snippet = html
    .slice(0, MAX_MARKDOWN_SNIPPET_LENGTH)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<br\b[^>]*>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, "\"")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return snippet;
}

function buildExtractionTimeoutFallback(input: {
  finalUrl: string;
  html: string;
  fetchedAt: string;
}): ExtractedMainContent {
  const finalUrl = new URL(input.finalUrl);
  return {
    title: inferFallbackTitle(input.html, finalUrl),
    contentHtml: [
      "<p>Extraction timed out for this page. Partial fallback content is shown below.</p>",
      `<p><a href="${escapeHtml(input.finalUrl)}">Open source URL</a></p>`
    ].join(""),
    excerpt: "Extraction timed out for this page.",
    extractionStatus: "blocked"
  };
}

function buildNormalizationTimeoutFallback(input: {
  sourceUrl: string;
  sourcePlatform: PipelineResult["sourcePlatform"];
  fetchedAt: string;
  extracted: ExtractedMainContent;
}): NormalizedDocument {
  const snippet = stripHtmlToMarkdownSnippet(input.extracted.contentHtml);
  const bodyLines = [
    "Markdown conversion timed out for this page.",
    "",
    snippet.length > 0 ? snippet : "(No fallback snippet available)",
    "",
    `[Open source URL](${input.sourceUrl})`
  ];

  return {
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform,
    fetchedAt: input.fetchedAt,
    title: input.extracted.title.trim() || "Untitled",
    markdownBody: bodyLines.join("\n"),
    byline: input.extracted.byline,
    excerpt: input.extracted.excerpt,
    publishedAt: input.extracted.publishedAt,
    extractionStatus: input.extracted.extractionStatus,
    authorHandle: input.extracted.authorHandle,
    statusId: input.extracted.statusId,
    mediaUrls: input.extracted.mediaUrls
  };
}

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

  const stageTimeoutMs = parsed.fetch.timeoutMs ?? DEFAULT_STAGE_TIMEOUT_MS;

  const fetched = await withStageTimeout("Fetch stage", stageTimeoutMs + 5_000, () =>
    dependencies.fetcher.fetch({
      url: parsedUrl.toString(),
      timeoutMs: parsed.fetch.timeoutMs,
      cdpEndpoint: parsed.fetch.cdpEndpoint,
      cdpAutoLaunch: parsed.fetch.cdpAutoLaunch,
    })
  );

  const extractor = dependencies.extractors.resolve(sourcePlatform);
  let extracted: ExtractedMainContent;
  try {
    extracted = await withStageTimeout("Extraction stage", stageTimeoutMs, () => extractor.extract(fetched));
  } catch (error) {
    if (!isPipelineStageTimeout(error)) {
      throw error;
    }

    extracted = buildExtractionTimeoutFallback({
      finalUrl: fetched.finalUrl,
      html: fetched.html,
      fetchedAt: fetched.fetchedAt
    });
  }

  let normalized: NormalizedDocument;
  try {
    normalized = await withStageTimeout("Markdown stage", stageTimeoutMs, async () =>
      toNormalizedDocument({
        sourceUrl: fetched.finalUrl,
        sourcePlatform,
        fetchedAt: fetched.fetchedAt,
        extracted
      })
    );
  } catch (error) {
    if (!isPipelineStageTimeout(error)) {
      throw error;
    }

    normalized = buildNormalizationTimeoutFallback({
      sourceUrl: fetched.finalUrl,
      sourcePlatform,
      fetchedAt: fetched.fetchedAt,
      extracted
    });
  }

  const saved = await withStageTimeout("Write stage", stageTimeoutMs + 20_000, () =>
    dependencies.writer.write(normalized, parsed.write)
  );

  return {
    sourcePlatform,
    normalized,
    saved
  };
}
