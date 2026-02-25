import { mkdir, access, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";

import type { NormalizedDocument, SaveResult, WriteOptions } from "../core/types.js";
import { renderMarkdownFile } from "../markdown/render.js";

const INVALID_FILENAME_CHARS = /[\\/:*?"<>|]/g;
const MULTISPACE = /\s+/g;
const MAX_FILE_NAME_LENGTH = 90;

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

function formatDatePrefix(iso: string): string {
  return iso.slice(0, 10);
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
  public async write(document: NormalizedDocument, options: WriteOptions): Promise<SaveResult> {
    const safeTitle = sanitizeFileName(document.title);
    const datedName = `${formatDatePrefix(document.fetchedAt)}-${safeTitle}.md`;

    const targetDir = options.subdirectory
      ? path.join(options.vaultPath, options.subdirectory)
      : options.vaultPath;

    await mkdir(targetDir, { recursive: true });

    const targetFile = path.join(targetDir, datedName);
    const resolved = options.overwrite
      ? { filePath: targetFile, created: !(await hasPath(targetFile)) }
      : await chooseAvailablePath(targetFile);

    const markdown = renderMarkdownFile(document);
    await writeFile(resolved.filePath, markdown, "utf8");

    return {
      outputPath: resolved.filePath,
      created: resolved.created,
      fileName: path.basename(resolved.filePath)
    };
  }
}
