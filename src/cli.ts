#!/usr/bin/env node

import { parseArgs } from "node:util";

import { asError, ObfronterError } from "./core/errors.js";
import { runFetchCommand } from "./index.js";

function printHelp(): void {
  const help = `obfronter - URL to Obsidian markdown pipeline

Usage:
  obfronter fetch <url> --vault <path> [options]

Options:
  --vault <path>                Obsidian vault root path (or set OBSIDIAN_VAULT_PATH)
  --subdir <name>               Subdirectory inside vault (default: Inbox)
  --browser-mode                Use Playwright-backed browser fetch mode
  --session-profile-dir <path>  Browser profile dir for authenticated cookies
  --timeout-ms <number>         Fetch timeout in milliseconds (default: 20000)
  --overwrite                   Overwrite target file if it exists
  --header <k:v>                Optional request header (repeatable)
  --help                        Show help
`;

  process.stdout.write(`${help}\n`);
}

function parseHeaders(input: string[] | undefined): Record<string, string> | undefined {
  if (!input || input.length === 0) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const pair of input) {
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (key.length > 0) {
      headers[key] = value;
    }
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "help") {
    printHelp();
    return;
  }

  if (command !== "fetch") {
    throw new ObfronterError("INVALID_COMMAND", `Unknown command: ${command}`);
  }

  const parsed = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      subdir: { type: "string" },
      "browser-mode": { type: "boolean", default: false },
      "session-profile-dir": { type: "string" },
      "timeout-ms": { type: "string" },
      overwrite: { type: "boolean", default: false },
      header: { type: "string", multiple: true },
      help: { type: "boolean", default: false }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const url = parsed.positionals[0];
  if (!url) {
    throw new ObfronterError("URL_REQUIRED", "Missing URL. Usage: obfronter fetch <url> --vault <path>");
  }

  const vaultPath = parsed.values.vault ?? process.env.OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    throw new ObfronterError(
      "VAULT_REQUIRED",
      "Missing --vault option (or OBSIDIAN_VAULT_PATH environment variable)."
    );
  }

  const timeoutValue = parsed.values["timeout-ms"];
  let timeoutMs: number | undefined;
  if (timeoutValue) {
    const parsedTimeout = Number(timeoutValue);
    if (!Number.isFinite(parsedTimeout) || parsedTimeout <= 0) {
      throw new ObfronterError("INVALID_TIMEOUT", "--timeout-ms must be a positive number.");
    }

    timeoutMs = parsedTimeout;
  }

  const result = await runFetchCommand({
    url,
    vaultPath,
    subdirectory: parsed.values.subdir ?? "Inbox",
    browserMode: parsed.values["browser-mode"],
    sessionProfileDir: parsed.values["session-profile-dir"],
    timeoutMs,
    overwrite: parsed.values.overwrite,
    headers: parseHeaders(parsed.values.header)
  });

  process.stdout.write(
    [
      `source_platform=${result.sourcePlatform}`,
      `title=${result.normalized.title}`,
      `output_path=${result.saved.outputPath}`
    ].join("\n") + "\n"
  );
}

main().catch((error: unknown) => {
  const normalized = asError(error);
  process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
  process.exit(1);
});
