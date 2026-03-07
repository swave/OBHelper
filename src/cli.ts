#!/usr/bin/env node

import { parseArgs } from "node:util";

import { resolveFetchCliOptions } from "./cli-fetch-options.js";
import { resolveCookieHeader } from "./core/cookie-header.js";
import { asError, ObfronterError } from "./core/errors.js";
import type { BrowserChannel } from "./core/types.js";
import { runFetchCommand } from "./index.js";
import {
  formatStoredSettingValue,
  getSettingsPath,
  getStoredSetting,
  isStoredSettingKey,
  loadStoredSettings,
  saveStoredSettings,
  setStoredSetting,
  STORED_SETTING_KEYS,
  unsetStoredSetting
} from "./settings.js";

function printHelp(): void {
  const help = `obhelper - URL to Obsidian markdown pipeline

Usage:
  obhelper fetch <url> [--vault <path>] [options]
  obhelper settings <subcommand>

Options:
  --vault <path>                Obsidian vault root path (or set OBSIDIAN_VAULT_PATH)
  --subdir <name>               Subdirectory inside vault (default: Inbox)
  --browser-mode                Force Playwright-backed browser fetch mode
  --http-mode                   Force plain HTTP fetch mode (disables X default browser mode)
  --session-profile-dir <path>  Browser profile dir for authenticated cookies
  --browser-channel <name>      Browser channel for fetch browser mode (chrome|chromium|msedge)
  --cdp-endpoint <url>          Chrome DevTools endpoint for attaching to a running browser (or set OBHELPER_CDP_ENDPOINT)
  --cdp-auto-launch             If local CDP is unavailable, open dedicated Chrome with remote debugging enabled
  --no-cdp-auto-launch          Disable a stored cdp-auto-launch default for this fetch
  --cookie-file <path>          Cookie file path (raw header or Netscape format) for fetch requests
  --cookie-env <name>           Env var name containing cookie header for fetch requests
  --timeout-ms <number>         Timeout in milliseconds (fetch default: 20000)
  --overwrite                   Overwrite target file if it exists
  --header <k:v>                Optional request header (repeatable)
  --help                        Show help
`;

  process.stdout.write(`${help}\n`);
}

function printSettingsHelp(): void {
  const help = `obhelper settings - persistent local defaults

Usage:
  obhelper settings list
  obhelper settings get <key>
  obhelper settings set <key> <value>
  obhelper settings unset <key>
  obhelper settings path

Available keys:
  ${STORED_SETTING_KEYS.join("\n  ")}
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

function requireStoredSettingKey(raw: string | undefined) {
  if (!raw || !isStoredSettingKey(raw)) {
    throw new ObfronterError(
      "INVALID_SETTINGS_KEY",
      `Unknown settings key. Choose one of: ${STORED_SETTING_KEYS.join(", ")}.`
    );
  }

  return raw;
}

async function runFetchCli(args: string[]): Promise<void> {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      vault: { type: "string" },
      subdir: { type: "string" },
      "browser-mode": { type: "boolean" },
      "http-mode": { type: "boolean" },
      "session-profile-dir": { type: "string" },
      "browser-channel": { type: "string" },
      "cdp-endpoint": { type: "string" },
      "cdp-auto-launch": { type: "boolean" },
      "no-cdp-auto-launch": { type: "boolean" },
      "cookie-file": { type: "string" },
      "cookie-env": { type: "string" },
      "timeout-ms": { type: "string" },
      overwrite: { type: "boolean" },
      header: { type: "string", multiple: true },
      help: { type: "boolean" }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const storedSettings = await loadStoredSettings();
  const sessionProfileDir = parsed.values["session-profile-dir"] ?? storedSettings.sessionProfileDir;
  const { cdpEndpoint, cdpAutoLaunch } = resolveFetchCliOptions({
    browserMode: parsed.values["browser-mode"],
    httpMode: parsed.values["http-mode"],
    cdpEndpointFlag: parsed.values["cdp-endpoint"],
    cdpEndpointEnv: process.env.OBHELPER_CDP_ENDPOINT ?? process.env.OBFRONTER_CDP_ENDPOINT ?? storedSettings.cdpEndpoint,
    cdpAutoLaunchEnabled: parsed.values["cdp-auto-launch"],
    cdpAutoLaunchDisabled: parsed.values["no-cdp-auto-launch"],
    cdpAutoLaunchDefault: storedSettings.cdpAutoLaunch,
    sessionProfileDir
  });

  const url = parsed.positionals[0];
  if (!url) {
    throw new ObfronterError("URL_REQUIRED", "Missing URL. Usage: obhelper fetch <url> [--vault <path>] [options]");
  }

  const vaultPath = parsed.values.vault ?? process.env.OBSIDIAN_VAULT_PATH ?? storedSettings.vault;
  if (!vaultPath) {
    throw new ObfronterError(
      "VAULT_REQUIRED",
      "Missing vault. Use --vault, OBSIDIAN_VAULT_PATH, or `obhelper settings set vault <path>`."
    );
  }

  const timeoutMs = parsePositiveNumber(
    parsed.values["timeout-ms"] ?? (storedSettings.timeoutMs !== undefined ? String(storedSettings.timeoutMs) : undefined),
    "--timeout-ms must be a positive number."
  );
  const browserChannel = parseBrowserChannel(parsed.values["browser-channel"] ?? storedSettings.browserChannel);
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
    subdirectory: parsed.values.subdir ?? storedSettings.subdir ?? "Inbox",
    browserMode: parsed.values["browser-mode"],
    forceHttpMode: parsed.values["http-mode"],
    sessionProfileDir,
    browserChannel,
    cdpEndpoint,
    cdpAutoLaunch,
    timeoutMs,
    overwrite: Boolean(parsed.values.overwrite),
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

async function runSettingsCli(args: string[]): Promise<void> {
  const [subcommand, keyArg, valueArg] = args;

  if (!subcommand || subcommand === "--help" || subcommand === "help") {
    printSettingsHelp();
    return;
  }

  if (subcommand === "path") {
    process.stdout.write(`settings_path=${getSettingsPath()}\n`);
    return;
  }

  const settings = await loadStoredSettings();

  if (subcommand === "list") {
    const lines = [`settings_path=${getSettingsPath()}`];
    for (const key of STORED_SETTING_KEYS) {
      const value = getStoredSetting(settings, key);
      if (value !== undefined) {
        lines.push(`${key}=${formatStoredSettingValue(value)}`);
      }
    }
    process.stdout.write(`${lines.join("\n")}\n`);
    return;
  }

  if (subcommand !== "get" && subcommand !== "set" && subcommand !== "unset") {
    throw new ObfronterError("INVALID_COMMAND", `Unknown settings subcommand: ${subcommand}`);
  }

  const key = requireStoredSettingKey(keyArg);

  if (subcommand === "get") {
    const value = getStoredSetting(settings, key);
    if (value === undefined) {
      throw new ObfronterError("SETTING_NOT_FOUND", `No stored value for ${key}.`);
    }

    process.stdout.write(`${key}=${formatStoredSettingValue(value)}\n`);
    return;
  }

  if (subcommand === "set") {
    if (valueArg === undefined) {
      throw new ObfronterError("VALUE_REQUIRED", `Missing value. Usage: obhelper settings set ${key} <value>`);
    }

    const nextSettings = setStoredSetting(settings, key, valueArg);
    const settingsPath = await saveStoredSettings(nextSettings);
    process.stdout.write(
      [`settings_path=${settingsPath}`, `${key}=${formatStoredSettingValue(getStoredSetting(nextSettings, key)!)}`].join("\n") + "\n"
    );
    return;
  }

  if (subcommand === "unset") {
    const nextSettings = unsetStoredSetting(settings, key);
    const settingsPath = await saveStoredSettings(nextSettings);
    process.stdout.write([`settings_path=${settingsPath}`, `unset=${key}`].join("\n") + "\n");
    return;
  }
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

  if (command === "settings" || command === "setting") {
    await runSettingsCli(rest);
    return;
  }

  throw new ObfronterError("INVALID_COMMAND", `Unknown command: ${command}`);
}

main().catch((error: unknown) => {
  const normalized = asError(error);
  process.stderr.write(`${normalized.name}: ${normalized.message}\n`);
  process.exit(1);
});
