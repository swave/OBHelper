import { mkdir, access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { NormalizedDocument, SaveResult, WriteOptions } from "../core/types.js";
import { renderMarkdownFile } from "../markdown/render.js";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const MULTISPACE = /\s+/g;
const MAX_FILE_NAME_LENGTH = 90;
const MAX_LOCAL_IMAGES = 12;

interface DownloadResponseLike {
  ok: boolean;
  status: number;
  headers: {
    get: (name: string) => string | null;
  };
  arrayBuffer: () => Promise<ArrayBuffer>;
}

type MediaFetch = (url: string) => Promise<DownloadResponseLike>;

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp"
};

function defaultMediaFetch(url: string): Promise<DownloadResponseLike> {
  return fetch(url, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
    headers: {
      accept: "image/*,*/*;q=0.8",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"
    }
  });
}

function hasPath(p: string): Promise<boolean> {
  return access(p, fsConstants.F_OK)
    .then(() => true)
    .catch(() => false);
}

export function sanitizeFileName(input: string): string {
  const normalized = input
    .replace(INVALID_FILENAME_CHARS, " ")
    .replace(MULTISPACE, " ")
    .trim();

  if (!normalized) {
    return "untitled";
  }

  return normalized.slice(0, MAX_FILE_NAME_LENGTH);
}

function toPosixPath(input: string): string {
  return input.split(path.sep).join("/");
}

function inferExtensionFromContentType(contentTypeHeader: string | undefined): string | undefined {
  if (!contentTypeHeader) {
    return undefined;
  }

  const mimeType = contentTypeHeader.split(";")[0]?.trim().toLowerCase();
  if (!mimeType) {
    return undefined;
  }

  return CONTENT_TYPE_EXTENSION[mimeType];
}

function inferExtensionFromUrl(mediaUrl: string): string | undefined {
  try {
    const parsed = new URL(mediaUrl);
    const queryFormat = parsed.searchParams.get("format");
    if (queryFormat) {
      const normalized = queryFormat.trim().toLowerCase();
      if (normalized.length > 0) {
        return normalized === "jpeg" ? "jpg" : normalized;
      }
    }

    const extension = path.extname(parsed.pathname).replace(/^\./, "").toLowerCase();
    if (extension.length > 0) {
      return extension === "jpeg" ? "jpg" : extension;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function normalizeMediaUrlKey(url: string): string {
  return url
    .trim()
    .replaceAll("&amp;", "&")
    .replaceAll("&#38;", "&")
    .replaceAll("&#x26;", "&");
}

function appendLocalImagesSection(markdown: string, relativeImagePaths: string[]): string {
  if (relativeImagePaths.length === 0) {
    return markdown;
  }

  const toMarkdownDestination = (relativePath: string): string => `<${relativePath}>`;
  const lines = [
    markdown.trimEnd(),
    "",
    "## Images",
    "",
    ...relativeImagePaths.map((relativePath, index) => `![Image ${index + 1}](${toMarkdownDestination(relativePath)})`)
  ];

  return `${lines.join("\n")}\n`;
}

function extractMarkdownImageUrls(markdown: string): string[] {
  const matches = markdown.matchAll(/!\[[^\]]*]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/g);
  const urls: string[] = [];
  for (const match of matches) {
    const captured = match[1] ? normalizeMediaUrlKey(match[1]) : undefined;
    if (captured && !urls.includes(captured)) {
      urls.push(captured);
    }
  }
  return urls;
}

function replaceMarkdownImageUrls(markdown: string, replacements: Map<string, string>): string {
  if (replacements.size === 0) {
    return markdown;
  }

  const toMarkdownDestination = (relativePath: string): string => `<${relativePath}>`;
  return markdown.replace(
    /!\[([^\]]*)]\((https?:\/\/[^)\s]+)(?:\s+(["'][^"']*["']))?\)/g,
    (fullMatch, altText: string, url: string, optionalTitle?: string) => {
      const replacement = replacements.get(url) ?? replacements.get(normalizeMediaUrlKey(url));
      if (!replacement) {
        return fullMatch;
      }

      return optionalTitle
        ? `![${altText}](${toMarkdownDestination(replacement)} ${optionalTitle})`
        : `![${altText}](${toMarkdownDestination(replacement)})`;
    }
  );
}

async function chooseAvailablePath(basePath: string): Promise<{ filePath: string; created: boolean }> {
  if (!(await hasPath(basePath))) {
    return { filePath: basePath, created: true };
  }

  const extension = path.extname(basePath);
  const withoutExtension = basePath.slice(0, -extension.length);

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${withoutExtension}-${index}${extension}`;
    if (!(await hasPath(candidate))) {
      return { filePath: candidate, created: true };
    }
  }

  return { filePath: basePath, created: false };
}

export interface DocumentWriter {
  write(document: NormalizedDocument, options: WriteOptions): Promise<SaveResult>;
}

export class ObsidianWriter implements DocumentWriter {
  public constructor(
    private readonly mediaFetch: MediaFetch = defaultMediaFetch
  ) {}

  private async downloadLocalImages(input: {
    mediaUrls: string[];
    notePath: string;
  }): Promise<Array<{ sourceUrl: string; relativePath: string }>> {
    const mediaUrls = [...new Set(input.mediaUrls)].slice(0, MAX_LOCAL_IMAGES);
    if (mediaUrls.length === 0) {
      return [];
    }

    const noteDir = path.dirname(input.notePath);
    const noteBaseName = path.basename(input.notePath, path.extname(input.notePath));
    const assetsDirName = `${noteBaseName}_assets`;
    const assetsDirPath = path.join(noteDir, assetsDirName);
    const downloaded: Array<{ sourceUrl: string; relativePath: string }> = [];
    let savedIndex = 1;

    for (const mediaUrl of mediaUrls) {
      let response: DownloadResponseLike;
      try {
        response = await this.mediaFetch(mediaUrl);
      } catch {
        continue;
      }

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get("content-type") ?? undefined;
      const fromContentType = inferExtensionFromContentType(contentType);
      if (!fromContentType && contentType && !contentType.toLowerCase().startsWith("image/")) {
        continue;
      }

      const extension = fromContentType ?? inferExtensionFromUrl(mediaUrl);
      if (!extension || !/^[a-z0-9+.-]+$/i.test(extension)) {
        continue;
      }

      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        continue;
      }

      if (bytes.byteLength === 0) {
        continue;
      }

      await mkdir(assetsDirPath, { recursive: true });
      const fileName = `image-${savedIndex}.${extension}`;
      const absoluteAssetPath = path.join(assetsDirPath, fileName);
      await writeFile(absoluteAssetPath, Buffer.from(bytes));

      const relativeAssetPath = path.relative(noteDir, absoluteAssetPath);
      downloaded.push({
        sourceUrl: mediaUrl,
        relativePath: toPosixPath(relativeAssetPath)
      });
      savedIndex += 1;
    }

    return downloaded;
  }

  public async write(document: NormalizedDocument, options: WriteOptions): Promise<SaveResult> {
    const safeTitle = sanitizeFileName(document.title);
    const datedName = `${safeTitle}.md`;

    const targetDir = options.subdirectory
      ? path.join(options.vaultPath, options.subdirectory)
      : options.vaultPath;

    await mkdir(targetDir, { recursive: true });

    const targetFile = path.join(targetDir, datedName);
    const resolved = options.overwrite
      ? { filePath: targetFile, created: !(await hasPath(targetFile)) }
      : await chooseAvailablePath(targetFile);

    let markdown = renderMarkdownFile(document);
    const inlineImageUrls = extractMarkdownImageUrls(markdown);
    const candidateMediaUrls = [...new Set([...(document.mediaUrls ?? []), ...inlineImageUrls])];
    const downloadedImages = await this.downloadLocalImages({
      mediaUrls: candidateMediaUrls,
      notePath: resolved.filePath
    });
    const replacementMap = new Map<string, string>();
    for (const entry of downloadedImages) {
      replacementMap.set(entry.sourceUrl, entry.relativePath);
      replacementMap.set(normalizeMediaUrlKey(entry.sourceUrl), entry.relativePath);
    }
    markdown = replaceMarkdownImageUrls(markdown, replacementMap);

    const replacedInlineCount = inlineImageUrls.filter((url) => replacementMap.has(url)).length;
    if (replacedInlineCount === 0) {
      markdown = appendLocalImagesSection(markdown, downloadedImages.map((entry) => entry.relativePath));
    }

    await writeFile(resolved.filePath, markdown, "utf8");

    return {
      outputPath: resolved.filePath,
      created: resolved.created,
      fileName: path.basename(resolved.filePath)
    };
  }
}
