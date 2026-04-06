import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { ObfronterError } from "./core/errors.js";

const storedSettingsSchema = z.object({
  vault: z.string().min(1).optional(),
  cdpEndpoint: z.string().min(1).optional(),
  cdpAutoLaunch: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional()
}).strict();

export type StoredSettings = z.infer<typeof storedSettingsSchema>;
export type StoredSettingKey =
  | "vault"
  | "cdp-endpoint"
  | "cdp-auto-launch"
  | "timeout-ms";

export const STORED_SETTING_KEYS: StoredSettingKey[] = [
  "vault",
  "cdp-endpoint",
  "cdp-auto-launch",
  "timeout-ms"
];

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), ".obhelper", "settings.json");

function parsePositiveNumber(raw: string, key: StoredSettingKey): number {
  const parsedNumber = Number(raw);
  if (!Number.isFinite(parsedNumber) || parsedNumber <= 0) {
    throw new ObfronterError("INVALID_SETTINGS_VALUE", `${key} must be a positive number.`);
  }

  return parsedNumber;
}

function parseBooleanValue(raw: string, key: StoredSettingKey): boolean {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new ObfronterError("INVALID_SETTINGS_VALUE", `${key} must be true or false.`);
}

function parseNonEmptyString(raw: string, key: StoredSettingKey): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ObfronterError("INVALID_SETTINGS_VALUE", `${key} cannot be empty.`);
  }

  return trimmed;
}

function normalizeStoredSettings(input: unknown): StoredSettings {
  try {
    let candidate: unknown = input;
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const mutable = { ...(candidate as Record<string, unknown>) };
      // Drop legacy keys kept by older versions of the CLI.
      delete mutable.subdir;
      delete mutable.sessionProfileDir;
      delete mutable.browserChannel;
      candidate = mutable;
    }

    const parsed = storedSettingsSchema.parse(candidate);
    return parsed;
  } catch (error) {
    if (error instanceof ObfronterError) {
      throw error;
    }

    throw new ObfronterError(
      "INVALID_SETTINGS",
      "Stored settings file is invalid. Fix or remove ~/.obhelper/settings.json and retry."
    );
  }
}

function toSerializableSettings(settings: StoredSettings): StoredSettings {
  const normalized = normalizeStoredSettings(settings);
  const ordered: StoredSettings = {};

  for (const key of STORED_SETTING_KEYS) {
    const value = getStoredSetting(normalized, key);
    if (value !== undefined) {
      setStoredSettingField(ordered, key, value);
    }
  }

  return ordered;
}

function setStoredSettingField(
  settings: StoredSettings,
  key: StoredSettingKey,
  value: string | number | boolean
): void {
  switch (key) {
    case "vault":
      settings.vault = value as string;
      return;
    case "cdp-endpoint":
      settings.cdpEndpoint = value as string;
      return;
    case "cdp-auto-launch":
      settings.cdpAutoLaunch = value as boolean;
      return;
    case "timeout-ms":
      settings.timeoutMs = value as number;
      return;
  }
}

export function getSettingsPath(): string {
  return DEFAULT_SETTINGS_PATH;
}

export function isStoredSettingKey(input: string): input is StoredSettingKey {
  return STORED_SETTING_KEYS.includes(input as StoredSettingKey);
}

export function getStoredSetting(
  settings: StoredSettings,
  key: StoredSettingKey
): string | number | boolean | undefined {
  switch (key) {
    case "vault":
      return settings.vault;
    case "cdp-endpoint":
      return settings.cdpEndpoint;
    case "cdp-auto-launch":
      return settings.cdpAutoLaunch;
    case "timeout-ms":
      return settings.timeoutMs;
  }
}

export function formatStoredSettingValue(value: string | number | boolean): string {
  return String(value);
}

export function parseStoredSettingValue(
  key: StoredSettingKey,
  rawValue: string
): string | number | boolean {
  switch (key) {
    case "vault":
    case "cdp-endpoint":
      return parseNonEmptyString(rawValue, key);
    case "cdp-auto-launch":
      return parseBooleanValue(rawValue, key);
    case "timeout-ms":
      return parsePositiveNumber(rawValue, key);
  }
}

export function setStoredSetting(
  settings: StoredSettings,
  key: StoredSettingKey,
  rawValue: string
): StoredSettings {
  const nextSettings: StoredSettings = { ...settings };
  setStoredSettingField(nextSettings, key, parseStoredSettingValue(key, rawValue));
  return normalizeStoredSettings(nextSettings);
}

export function unsetStoredSetting(settings: StoredSettings, key: StoredSettingKey): StoredSettings {
  const nextSettings: StoredSettings = { ...settings };

  switch (key) {
    case "vault":
      delete nextSettings.vault;
      break;
    case "cdp-endpoint":
      delete nextSettings.cdpEndpoint;
      break;
    case "cdp-auto-launch":
      delete nextSettings.cdpAutoLaunch;
      break;
    case "timeout-ms":
      delete nextSettings.timeoutMs;
      break;
  }

  return normalizeStoredSettings(nextSettings);
}

export async function loadStoredSettings(input?: { settingsPath?: string }): Promise<StoredSettings> {
  const settingsPath = input?.settingsPath ?? DEFAULT_SETTINGS_PATH;

  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeStoredSettings(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") {
      return {};
    }

    if (error instanceof SyntaxError) {
      throw new ObfronterError(
        "INVALID_SETTINGS",
        "Stored settings file is invalid JSON. Fix or remove ~/.obhelper/settings.json and retry."
      );
    }

    throw error;
  }
}

export async function saveStoredSettings(
  settings: StoredSettings,
  input?: { settingsPath?: string }
): Promise<string> {
  const settingsPath = input?.settingsPath ?? DEFAULT_SETTINGS_PATH;
  const serialized = `${JSON.stringify(toSerializableSettings(settings), null, 2)}\n`;

  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, serialized, "utf8");
  return settingsPath;
}
