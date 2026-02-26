import TurndownService from "turndown";

import type { ExtractedMainContent, NormalizedDocument, SourcePlatform } from "../core/types.js";

function normalizeCodeBlockText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\u00A0/g, " ");
}

function extractCodeText(node: HTMLElement): string {
  const clone = node.cloneNode(true) as Node;
  const elementClone = clone as Element;
  if (typeof elementClone.querySelectorAll !== "function") {
    return clone.textContent ?? "";
  }

  for (const br of Array.from(elementClone.querySelectorAll("br"))) {
    br.replaceWith("\n");
  }

  return elementClone.textContent ?? "";
}

function detectCodeLanguage(node: HTMLElement): string | undefined {
  const nestedCode = node.tagName.toUpperCase() === "CODE"
    ? node
    : node.querySelector("code");
  const classNames = [node.getAttribute("class"), nestedCode?.getAttribute("class")]
    .filter((value): value is string => Boolean(value))
    .join(" ");
  if (classNames.length === 0) {
    return undefined;
  }

  for (const token of classNames.split(/\s+/)) {
    if (token.startsWith("language-")) {
      return token.slice("language-".length).trim() || undefined;
    }
    if (token.startsWith("lang-")) {
      return token.slice("lang-".length).trim() || undefined;
    }
    if (token.startsWith("highlight-source-")) {
      return token.slice("highlight-source-".length).trim() || undefined;
    }
  }

  return undefined;
}

function buildCodeFence(text: string): string {
  const backtickRuns = text.match(/`+/g) ?? [];
  const maxRunLength = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, maxRunLength + 1));
}

function renderInlineCode(text: string): string {
  const normalized = normalizeCodeBlockText(text).replace(/\n+/g, " ").trim();
  if (normalized.length === 0) {
    return "";
  }

  const fence = buildCodeFence(normalized).slice(0, Math.max(1, (normalized.match(/`+/g) ?? [])
    .reduce((max, run) => Math.max(max, run.length), 0) + 1));
  return `${fence}${normalized}${fence}`;
}

function hasSingleMeaningfulChild(parent: Element | null, child: Element): boolean {
  if (!parent) {
    return false;
  }

  const significant = Array.from(parent.childNodes).filter((node) => {
    if (node.nodeType !== 3) {
      return true;
    }

    return (node.textContent ?? "").trim().length > 0;
  });

  return significant.length === 1 && significant[0] === child;
}

function shouldPromoteCodeToBlock(input: {
  codeNode: HTMLElement;
  codeText: string;
  language?: string;
}): boolean {
  const parent = input.codeNode.parentElement;
  if (!parent) {
    return false;
  }

  if (parent.tagName.toUpperCase() === "PRE") {
    return false;
  }

  if (input.codeNode.closest("table")) {
    return false;
  }

  if (input.language) {
    return true;
  }

  if (input.codeNode.querySelector("br")) {
    return true;
  }

  if (input.codeText.includes("\n")) {
    return true;
  }

  const parentTag = parent.tagName.toUpperCase();
  if (
    (parentTag === "P" || parentTag === "DIV" || parentTag === "LI" || parentTag === "SECTION" || parentTag === "ARTICLE") &&
    hasSingleMeaningfulChild(parent, input.codeNode) &&
    input.codeText.trim().length >= 20
  ) {
    return true;
  }

  return false;
}

function sanitizeTableCellContent(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || index < lines.length - 1)
    .join("<br>")
    .trim()
    .replace(/\|/g, "\\|");

  return normalized.length > 0 ? normalized : " ";
}

function toTableCellMarkdown(cell: HTMLTableCellElement, service: TurndownService): string {
  const markdown = service.turndown(cell.innerHTML).trim();
  return sanitizeTableCellContent(markdown.length > 0 ? markdown : (cell.textContent ?? "").trim());
}

function renderMarkdownTable(table: HTMLTableElement, service: TurndownService): string {
  const rawRows = Array.from(table.rows)
    .map((row) =>
      Array.from(row.cells).map((cell) => ({
        text: toTableCellMarkdown(cell, service),
        isHeader: cell.tagName.toUpperCase() === "TH"
      }))
    )
    .filter((row) => row.length > 0);

  if (rawRows.length === 0) {
    return "";
  }

  const explicitHeaderIndex = rawRows.findIndex((row) => row.some((cell) => cell.isHeader));
  const headerIndex = explicitHeaderIndex >= 0 ? explicitHeaderIndex : 0;

  const headerCells = rawRows[headerIndex].map((cell) => cell.text);
  const bodyRows = rawRows.filter((_, index) => index !== headerIndex).map((row) => row.map((cell) => cell.text));
  const columnCount = Math.max(headerCells.length, ...bodyRows.map((row) => row.length), 1);

  const normalizeRow = (row: string[]): string[] => {
    const padded = [...row];
    while (padded.length < columnCount) {
      padded.push(" ");
    }
    return padded.slice(0, columnCount);
  };

  const lines = [
    `| ${normalizeRow(headerCells).join(" | ")} |`,
    `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`,
    ...bodyRows.map((row) => `| ${normalizeRow(row).join(" | ")} |`)
  ];

  return lines.join("\n");
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-"
  });

  service.addRule("markdown-table", {
    filter: "table",
    replacement: (_content, node) => {
      const markdownTable = renderMarkdownTable(node as HTMLTableElement, service);
      return markdownTable.length > 0 ? `\n\n${markdownTable}\n\n` : "\n\n";
    }
  });

  service.addRule("markdown-pre", {
    filter: "pre",
    replacement: (_content, node) => {
      const pre = node as HTMLElement;
      const codeElement = pre.querySelector("code");
      const rawCodeText = codeElement ? extractCodeText(codeElement) : extractCodeText(pre);
      const codeText = normalizeCodeBlockText(rawCodeText);
      const language = detectCodeLanguage(pre);
      const fence = buildCodeFence(codeText);
      const languageSuffix = language ? language : "";
      return `\n\n${fence}${languageSuffix}\n${codeText}\n${fence}\n\n`;
    }
  });

  service.addRule("markdown-code", {
    filter: "code",
    replacement: (_content, node) => {
      const codeNode = node as HTMLElement;
      const codeText = normalizeCodeBlockText(extractCodeText(codeNode));
      if (codeText.trim().length === 0) {
        return "";
      }

      if (codeNode.parentElement?.tagName.toUpperCase() === "PRE") {
        return codeText;
      }

      const language = detectCodeLanguage(codeNode);
      if (shouldPromoteCodeToBlock({ codeNode, codeText, language })) {
        const fence = buildCodeFence(codeText);
        return `\n\n${fence}${language ?? ""}\n${codeText}\n${fence}\n\n`;
      }

      return renderInlineCode(codeText);
    }
  });

  return service;
}

const turndown = createTurndown();

function yamlEscape(value: string): string {
  return JSON.stringify(value);
}

export function toNormalizedDocument(input: {
  sourceUrl: string;
  sourcePlatform: SourcePlatform;
  fetchedAt: string;
  extracted: ExtractedMainContent;
}): NormalizedDocument {
  const markdownBody = turndown.turndown(input.extracted.contentHtml).trim();

  return {
    sourceUrl: input.sourceUrl,
    sourcePlatform: input.sourcePlatform,
    fetchedAt: input.fetchedAt,
    title: input.extracted.title.trim() || "Untitled",
    markdownBody,
    byline: input.extracted.byline,
    excerpt: input.extracted.excerpt,
    publishedAt: input.extracted.publishedAt,
    extractionStatus: input.extracted.extractionStatus,
    authorHandle: input.extracted.authorHandle,
    statusId: input.extracted.statusId,
    mediaUrls: input.extracted.mediaUrls
  };
}

export function renderMarkdownFile(document: NormalizedDocument): string {
  const frontmatter = [
    "---",
    `title: ${yamlEscape(document.title)}`,
    `source_platform: ${document.sourcePlatform}`,
    `source_url: ${yamlEscape(document.sourceUrl)}`,
    `fetched_at: ${yamlEscape(document.fetchedAt)}`
  ];

  if (document.byline) {
    frontmatter.push(`byline: ${yamlEscape(document.byline)}`);
  }

  if (document.excerpt) {
    frontmatter.push(`excerpt: ${yamlEscape(document.excerpt)}`);
  }

  if (document.publishedAt) {
    frontmatter.push(`published_at: ${yamlEscape(document.publishedAt)}`);
  }

  if (document.extractionStatus) {
    frontmatter.push(`extraction_status: ${document.extractionStatus}`);
  }

  if (document.authorHandle) {
    frontmatter.push(`author_handle: ${yamlEscape(document.authorHandle)}`);
  }

  if (document.statusId) {
    frontmatter.push(`status_id: ${yamlEscape(document.statusId)}`);
  }

  if (document.mediaUrls && document.mediaUrls.length > 0) {
    frontmatter.push("media_urls:");
    for (const mediaUrl of document.mediaUrls) {
      frontmatter.push(`  - ${yamlEscape(mediaUrl)}`);
    }
  }

  frontmatter.push("---", "");

  const body = document.markdownBody.length > 0 ? document.markdownBody : "(No content extracted)";

  return `${frontmatter.join("\n")}${body}\n`;
}
