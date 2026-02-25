#!/usr/bin/env node

import { parseArgs } from "node:util";

import { asError, ObfronterError } from "./core/errors.js";
import type { BrowserChannel } from "./core/types.js";
import { runFetchCommand } from "./index.js";
import { runXLoginCommand } from "./login/x-login.js";

function printHelp(): void {
  const help = `obfronter - URL to Obsidian markdown pipeline

Usage:
  obfronter fetch <url> --vault <path> [options]
  obfronter login x --session-profile-dir <path> [options]

Options:
  --vault <path>                Obsidian vault root path (or set OBSIDIAN_VAULT_PATH)
  --subdir <name>               Subdirectory inside vault (default: Inbox)
  --browser-mode                Force Playwright-backed browser fetch mode
  --http-mode                   Force plain HTTP fetch mode (disables X default browser mode)
  --session-profile-dir <path>  Browser profile dir for authenticated cookies
  --browser-channel <name>      Browser channel for login/fetch browser mode (chrome|chromium|msedge)
  --url <url>                   Login page URL for login command (default: https://x.com/login)
  --headless                    Run login browser in headless mode (default: false)
  --timeout-ms <number>         Timeout in milliseconds (fetch default: 20000, login default: 60000)
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

  if (parsed.values["browser-mode"] && parsed.values["http-mode"]) {
    throw new ObfronterError("INVALID_MODE", "Choose only one of --browser-mode or --http-mode.");
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

  const timeoutMs = parsePositiveNumber(parsed.values["timeout-ms"], "--timeout-ms must be a positive number.");
  const browserChannel = parseBrowserChannel(parsed.values["browser-channel"]);

  const result = await runFetchCommand({
    url,
    vaultPath,
    subdirectory: parsed.values.subdir ?? "Inbox",
    browserMode: parsed.values["browser-mode"],
    forceHttpMode: parsed.values["http-mode"],
    sessionProfileDir: parsed.values["session-profile-dir"],
    browserChannel,
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

async function runLoginCli(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      "session-profile-dir": { type: "string" },
      "browser-channel": { type: "string" },
      url: { type: "string" },
      headless: { type: "boolean", default: false },
      "timeout-ms": { type: "string" },
      help: { type: "boolean", default: false }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const provider = parsed.positionals[0];
  if (!provider) {
    throw new ObfronterError("PROVIDER_REQUIRED", "Missing provider. Usage: obfronter login x --session-profile-dir <path>");
  }

  if (provider !== "x") {
    throw new ObfronterError("LOGIN_PROVIDER_UNSUPPORTED", `Unsupported login provider: ${provider}`);
  }

  const sessionProfileDir = parsed.values["session-profile-dir"] ?? process.env.OBFRONTER_X_SESSION_DIR;
  if (!sessionProfileDir) {
    throw new ObfronterError(
      "SESSION_PROFILE_DIR_REQUIRED",
      "Missing --session-profile-dir (or OBFRONTER_X_SESSION_DIR environment variable)."
    );
  }

  const timeoutMs = parsePositiveNumber(
    parsed.values["timeout-ms"],
    "--timeout-ms must be a positive number for login command."
  );
  const browserChannel = parseBrowserChannel(parsed.values["browser-channel"]);

  const result = await runXLoginCommand({
    sessionProfileDir,
    loginUrl: parsed.values.url,
    timeoutMs,
    headless: parsed.values.headless,
    browserChannel
  });

  process.stdout.write(
    [
      "login_provider=x",
      `session_profile_dir=${result.sessionProfileDir}`,
      `login_url=${result.loginUrl}`,
      "saved=true"
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

  if (command === "login") {
    await runLoginCli(rest);
    return;
  }

  throw new ObfronterError("INVALID_COMMAND", `Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const normalized = asError(error);
  process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
  process.exit(1);
});
