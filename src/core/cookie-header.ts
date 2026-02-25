import { readFile } from "node:fs/promises";

import { ObfronterError } from "./errors.js";

export interface ResolveCookieHeaderInput {
  cookieFile?: string;
  cookieEnvName?: string;
  env?: NodeJS.ProcessEnv;
  readFileText?: (filePath: string) => Promise<string>;
}

function parseNetscapeCookieFile(raw: string): string | undefined {
  const pairs: string[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    // Netscape format may prefix HttpOnly cookie domains with "#HttpOnly_".
    const normalizedLine = trimmed.startsWith("#HttpOnly_")
      ? trimmed.slice("#HttpOnly_".length)
      : trimmed;

    if (normalizedLine.startsWith("#")) {
      continue;
    }

    const parts = normalizedLine.split("\t");
    if (parts.length < 7) {
      continue;
    }

    const name = parts[5]?.trim();
    const value = parts[6]?.trim();
    if (!name || value === undefined) {
      continue;
    }

    pairs.push(`${name}=${value}`);
  }

  return pairs.length > 0 ? pairs.join("; ") : undefined;
}

function normalizeCookieHeader(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new ObfronterError("COOKIE_EMPTY", "Cookie input is empty.");
  }

  const parsedNetscape = parseNetscapeCookieFile(trimmed);
  if (parsedNetscape) {
    return parsedNetscape;
  }

  return trimmed;
}

export async function resolveCookieHeader(input: ResolveCookieHeaderInput): Promise<string | undefined> {
  const cookieFile = input.cookieFile?.trim();
  const cookieEnvName = input.cookieEnvName?.trim();
  const env = input.env ?? process.env;
  const readFileText = input.readFileText ?? ((filePath: string) => readFile(filePath, "utf8"));

  if (!cookieFile && !cookieEnvName) {
    return undefined;
  }

  if (cookieFile && cookieEnvName) {
    throw new ObfronterError("COOKIE_SOURCE_CONFLICT", "Choose only one of --cookie-file or --cookie-env.");
  }

  if (cookieFile) {
    let content: string;
    try {
      content = await readFileText(cookieFile);
    } catch {
      throw new ObfronterError("COOKIE_FILE_READ_FAILED", `Unable to read cookie file: ${cookieFile}`);
    }

    return normalizeCookieHeader(content);
  }

  const envName = cookieEnvName as string;
  const envValue = env[envName];
  if (!envValue) {
    throw new ObfronterError("COOKIE_ENV_MISSING", `Environment variable not found or empty: ${envName}`);
  }

  return normalizeCookieHeader(envValue);
}
