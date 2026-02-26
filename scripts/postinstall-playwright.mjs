import { spawnSync } from "node:child_process";

const skip =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.OBHELPER_SKIP_PLAYWRIGHT_INSTALL === "1" ||
  process.env.OBFRONTER_SKIP_PLAYWRIGHT_INSTALL === "1";

if (skip) {
  console.log("[obhelper] Skipping Playwright browser install (CI or OBHELPER_SKIP_PLAYWRIGHT_INSTALL=1).");
  process.exit(0);
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["playwright", "install", "chromium"], {
  stdio: "inherit"
});

if (result.error) {
  console.warn("[obhelper] Could not auto-install Chromium for Playwright.");
  console.warn("[obhelper] Run `npx playwright install chromium` manually.");
  process.exit(0);
}

if (result.status !== 0) {
  console.warn("[obhelper] Playwright Chromium install failed.");
  console.warn("[obhelper] Run `npx playwright install chromium` manually.");
  process.exit(0);
}
