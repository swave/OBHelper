#!/usr/bin/env node

import { parseArgs } from "node:util";

import { resolveFetchCliOptions } from "./cli-fetch-options.js";
import { resolveCookieHeader } from "./core/cookie-header.js";
import { asError, ObfronterError } from "./core/errors.js";
import type { BrowserChannel } from "./core/types.js";
import { runFetchCommand } from "./index.js";

function printHelp(): void {
  const help = `obfronter - URL to Obsidian markdown pipeline

Usage:
  obfronter fetch <url> --vault <path> [options]

Options:
  --vault <path>                Obsidian vault root path (or set OBSIDIAN_VAULT_PATH)
  --subdir <name>               Subdirectory inside vault (default: Inbox)
  --browser-mode                Force Playwright-backed browser fetch mode
  --http-mode                   Force plain HTTP fetch mode (disables X default browser mode)
  --session-profile-dir <path>  Browser profile dir for authenticated cookies
  --browser-channel <name>      Browser channel for fetch browser mode (chrome|chromium|msedge)
  --cdp-endpoint <url>          Chrome DevTools endpoint for attaching to a running browser (or set OBFRONTER_CDP_ENDPOINT)
  --cookie-file <path>          Cookie file path (raw header or Netscape format) for fetch requests
  --cookie-env <name>           Env var name containing cookie header for fetch requests
  --timeout-ms <number>         Timeout in milliseconds (fetch default: 20000)
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

function parsePositiveNumber(raw: string | undefined, errorMessage: string): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsedNumber = Number(raw);
  if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) {
    throw new ObfronterError("INVALID_TIMEOUT", errorMessage);
  }

  return parsedNumber;
}

function parseBrowserChannel(raw: string | undefined): BrowserChannel | undefined {
  if (!raw) {
    return undefined;
  }

  if (raw === "chrome" || raw === "chromium" || raw === "msedge") {
    return raw;
  }

  throw new ObfronterError(
    "INVALID_BROWSER_CHANNEL",
    "--browser-channel must be one of: chrome, chromium, msedge."
  );
}

async function runFetchCli(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      subdir: { type: "string" },
      "browser-mode": { type: "boolean" },
      "http-mode": { type: "boolean", default: false },
      "session-profile-dir": { type: "string" },
      "browser-channel": { type: "string" },
      "cdp-endpoint": { type: "string" },
      "cookie-file": { type: "string" },
      "cookie-env": { type: "string" },
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

  const { cdpEndpoint } = resolveFetchCliOptions({
    browserMode: parsed.values["browser-mode"],
    httpMode: parsed.values["http-mode"],
    cdpEndpointFlag: parsed.values["cdp-endpoint"],
    cdpEndpointEnv: process.env.OBFRONTER_CDP_ENDPOINT,
    sessionProfileDir: parsed.values["session-profile-dir"]
  });

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

  const timeoutMs = parsePositiveNumber(parsed.values["timeout-ms"], "--timeout-ms must be a positive number.");
  const browserChannel = parseBrowserChannel(parsed.values["browser-channel"]);
  const headers = parseHeaders(parsed.values.header) ?? {};
  const existingCookieHeaderKey = Object.keys(headers).find((key) => key.toLowerCase() === "cookie");
  if (existingCookieHeaderKey && (parsed.values["cookie-file"] || parsed.values["cookie-env"])) {
    throw new ObfronterError(
      "COOKIE_SOURCE_CONFLICT",
      "Use either --header cookie:... or --cookie-file/--cookie-env, not both."
    );
  }

  const cookieHeader = await resolveCookieHeader({
    cookieFile: parsed.values["cookie-file"],
    cookieEnvName: parsed.values["cookie-env"]
  });
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const finalHeaders = Object.keys(headers).length > 0 ? headers : undefined;

  const result = await runFetchCommand({
    url,
    vaultPath,
    subdirectory: parsed.values.subdir ?? "Inbox",
    browserMode: parsed.values["browser-mode"],
    forceHttpMode: parsed.values["http-mode"],
    sessionProfileDir: parsed.values["session-profile-dir"],
    browserChannel,
    cdpEndpoint,
    timeoutMs,
    overwrite: parsed.values.overwrite,
    headers: finalHeaders
  });

  process.stdout.write(
    [
      `source_platform=${result.sourcePlatform}`,
      `title=${result.normalized.title}`,
      `output_path=${result.saved.outputPath}`
    ].join("\n") + "\n"
  );
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === "--help" || command === "help") {
    printHelp();
    return;
  }

  if (command === "fetch") {
    await runFetchCli(rest);
    return;
  }

  throw new ObfronterError("INVALID_COMMAND", `Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const normalized = asError(error);
  process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
  process.exit(1);
});
