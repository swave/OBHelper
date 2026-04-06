#!/usr/bin/env node

import { createRequire } from "node:module";
import { parseArgs } from "node:util";

import { resolveFetchCliOptions } from "./cli-fetch-options.js";
import { asError, ObfronterError } from "./core/errors.js";
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

const require = createRequire(import.meta.url);
const packageJson = require("../package.json") as { version?: string };
const TOOL_VERSION = packageJson.version ?? "0.0.0";

function printHelp(): void {
  const help = `obhelper - URL to Obsidian markdown pipeline

Usage:
  obhelper fetch <url> [--vault <path>] [options]
  obhelper settings <subcommand>

Options:
  --vault <path>                Obsidian vault root path (or set OBSIDIAN_VAULT_PATH)
  --cdp-endpoint <url>          Chrome DevTools endpoint for connecting to a running browser (or set OBHELPER_CDP_ENDPOINT)
  --cdp-auto-launch             If local CDP is unavailable, open dedicated Chrome with remote debugging enabled
  --no-cdp-auto-launch          Disable a stored cdp-auto-launch default for this fetch
  --timeout-ms <number>         Timeout in milliseconds (fetch default: 20000)
  --overwrite                   Overwrite target file if it exists
  --version, -v                 Show version
  --help                        Show help

AI Agent Usage:
  Required inputs:
    - URL (position 1)
    - vault path (--vault or OBSIDIAN_VAULT_PATH or settings vault)
    - CDP endpoint (--cdp-endpoint or OBHELPER_CDP_ENDPOINT or settings cdp-endpoint)
  Recommended invocation:
    obhelper fetch "<url>" --vault "<vault_path>" --cdp-endpoint "http://127.0.0.1:9222"
  Success output (parse these lines):
    source_platform=<platform>
    title=<title>
    output_path=<absolute_markdown_path>
  Error behavior:
    - non-zero exit code
    - one-line error on stderr: <ErrorName>: <message>
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
      "cdp-endpoint": { type: "string" },
      "cdp-auto-launch": { type: "boolean" },
      "no-cdp-auto-launch": { type: "boolean" },
      "timeout-ms": { type: "string" },
      overwrite: { type: "boolean" },
      help: { type: "boolean" }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }

  const storedSettings = await loadStoredSettings();
  const { cdpEndpoint, cdpAutoLaunch } = resolveFetchCliOptions({
    cdpEndpointFlag: parsed.values["cdp-endpoint"],
    cdpEndpointEnv: process.env.OBHELPER_CDP_ENDPOINT ?? storedSettings.cdpEndpoint,
    cdpAutoLaunchEnabled: parsed.values["cdp-auto-launch"],
    cdpAutoLaunchDisabled: parsed.values["no-cdp-auto-launch"],
    cdpAutoLaunchDefault: storedSettings.cdpAutoLaunch
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

  const result = await runFetchCommand({
    url,
    vaultPath,
    cdpEndpoint,
    cdpAutoLaunch,
    timeoutMs,
    overwrite: Boolean(parsed.values.overwrite)
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

  if (command === "--version" || command === "-v" || command === "version") {
    process.stdout.write(`${TOOL_VERSION}\n`);
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
