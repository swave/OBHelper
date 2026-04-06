import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  loadStoredSettings,
  saveStoredSettings,
  setStoredSetting,
  unsetStoredSetting
} from "../../src/settings.js";

describe("settings", () => {
  it("returns empty settings when the file does not exist", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "obhelper-settings-"));
    const settings = await loadStoredSettings({
      settingsPath: path.join(tempDir, "missing.json")
    });

    expect(settings).toEqual({});
  });

  it("persists stored settings to disk", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "obhelper-settings-"));
    const settingsPath = path.join(tempDir, "settings.json");

    const savedPath = await saveStoredSettings(
      {
        vault: "/tmp/vault",
        cdpEndpoint: "http://127.0.0.1:9222",
        cdpAutoLaunch: true,
        timeoutMs: 45_000
      },
      {
        settingsPath
      }
    );

    expect(savedPath).toBe(settingsPath);
    await expect(loadStoredSettings({ settingsPath })).resolves.toEqual({
      vault: "/tmp/vault",
      cdpEndpoint: "http://127.0.0.1:9222",
      cdpAutoLaunch: true,
      timeoutMs: 45_000
    });

    await expect(readFile(settingsPath, "utf8")).resolves.toContain("\"cdpAutoLaunch\": true");
  });

  it("parses and unsets stored setting values", () => {
    const withValues = setStoredSetting({}, "cdp-auto-launch", "yes");
    expect(withValues.cdpAutoLaunch).toBe(true);

    const withTimeout = setStoredSetting(withValues, "timeout-ms", "90000");
    expect(withTimeout.timeoutMs).toBe(90_000);

    const withoutTimeout = unsetStoredSetting(withTimeout, "timeout-ms");
    expect(withoutTimeout.timeoutMs).toBeUndefined();
  });

  it("rejects conflicting stored browser session sources", () => {
    const settings = setStoredSetting({}, "cdp-endpoint", "http://127.0.0.1:9222");

    expect(() =>
      setStoredSetting(settings, "session-profile-dir", "/tmp/profile")
    ).toThrow("Stored settings cannot include both session-profile-dir and cdp-endpoint.");
  });

  it("ignores legacy subdir key from older settings files", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "obhelper-settings-"));
    const settingsPath = path.join(tempDir, "settings.json");
    await writeFile(
      settingsPath,
      `${JSON.stringify({ vault: "/tmp/vault", subdir: "Inbox", timeoutMs: 20000 }, null, 2)}\n`,
      "utf8"
    );

    await expect(loadStoredSettings({ settingsPath })).resolves.toEqual({
      vault: "/tmp/vault",
      timeoutMs: 20_000
    });
  });
});
