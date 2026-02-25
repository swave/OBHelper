import { createInterface } from "node:readline/promises";

import { ObfronterError } from "../core/errors.js";

interface PlaywrightPageLike {
  goto: (
    url: string,
    options: { waitUntil: "domcontentloaded"; timeout: number }
  ) => Promise<unknown>;
}

interface PlaywrightContextLike {
  newPage: () => Promise<PlaywrightPageLike>;
  close: () => Promise<void>;
}

interface PlaywrightLike {
  chromium: {
    launchPersistentContext: (
      userDataDir: string,
      options: { headless: boolean }
    ) => Promise<PlaywrightContextLike>;
  };
}

export interface XLoginCommandInput {
  sessionProfileDir: string;
  loginUrl?: string;
  timeoutMs?: number;
  headless?: boolean;
}

interface LoginDependencies {
  loadPlaywright: () => Promise<PlaywrightLike>;
  waitForUserConfirm: (message: string) => Promise<void>;
  emit: (message: string) => void;
}

const DEFAULT_LOGIN_URL = "https://x.com/login";
const DEFAULT_TIMEOUT_MS = 60_000;

async function defaultLoadPlaywright(): Promise<PlaywrightLike> {
  const moduleName = "playwright";

  try {
    return (await import(moduleName)) as PlaywrightLike;
  } catch {
    throw new ObfronterError(
      "PLAYWRIGHT_MISSING",
      "playwright is not installed. Install it (npm i playwright) before running login command."
    );
  }
}

async function defaultWaitForUserConfirm(message: string): Promise<void> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    await readline.question(message);
  } finally {
    readline.close();
  }
}

function defaultEmit(message: string): void {
  process.stdout.write(`${message}\n`);
}

export async function runXLoginCommand(
  input: XLoginCommandInput,
  overrides?: Partial<LoginDependencies>
): Promise<{ sessionProfileDir: string; loginUrl: string }> {
  if (!input.sessionProfileDir || input.sessionProfileDir.trim().length === 0) {
    throw new ObfronterError("SESSION_PROFILE_DIR_REQUIRED", "Missing --session-profile-dir for login command.");
  }

  const loginUrl = input.loginUrl ?? DEFAULT_LOGIN_URL;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headless = input.headless ?? false;

  const dependencies: LoginDependencies = {
    loadPlaywright: overrides?.loadPlaywright ?? defaultLoadPlaywright,
    waitForUserConfirm: overrides?.waitForUserConfirm ?? defaultWaitForUserConfirm,
    emit: overrides?.emit ?? defaultEmit
  };

  const playwright = await dependencies.loadPlaywright();
  const context = await playwright.chromium.launchPersistentContext(input.sessionProfileDir, {
    headless
  });

  try {
    const page = await context.newPage();
    await page.goto(loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    });

    dependencies.emit(`Opened ${loginUrl}`);
    dependencies.emit(`Session profile directory: ${input.sessionProfileDir}`);
    await dependencies.waitForUserConfirm("Complete login in browser, then press Enter to save session and exit: ");
  } finally {
    await context.close();
  }

  return {
    sessionProfileDir: input.sessionProfileDir,
    loginUrl
  };
}
