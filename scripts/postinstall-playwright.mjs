import { spawnSync } from "node:child_process";

const skip =
  process.env.CI === "true" ||
  process.env.CI === "1" ||
  process.env.OBFRONTER_SKIP_PLAYWRIGHT_INSTALL === "1";

if (skip) {
  console.log("[obfronter] Skipping Playwright browser install (CI or OBFRONTER_SKIP_PLAYWRIGHT_INSTALL=1).");
  process.exit(0);
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const result = spawnSync(npxCommand, ["playwright", "install", "chromium"], {
  stdio: "inherit"
});

if (result.error) {
  console.warn("[obfronter] Could not auto-install Chromium for Playwright.");
  console.warn("[obfronter] Run `npx playwright install chromium` manually.");
  process.exit(0);
}

if (result.status !== 0) {
  console.warn("[obfronter] Playwright Chromium install failed.");
  console.warn("[obfronter] Run `npx playwright install chromium` manually.");
  process.exit(0);
}
