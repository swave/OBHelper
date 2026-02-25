import { describe, expect, it, vi } from "vitest";

import { runXLoginCommand } from "../../src/login/x-login.js";

describe("runXLoginCommand", () => {
  it("launches persistent context, waits for confirm, and closes context", async () => {
    const goto = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const emit = vi.fn();
    const waitForUserConfirm = vi.fn(async () => undefined);

    const launchPersistentContext = vi.fn(async () => ({
      newPage: async () => ({ goto }),
      close
    }));

    const loadPlaywright = vi.fn(async () => ({
      chromium: {
        launchPersistentContext
      }
    }));

    const result = await runXLoginCommand(
      {
        sessionProfileDir: "/tmp/obfronter-profile",
        loginUrl: "https://x.com/login",
        timeoutMs: 12_345
      },
      {
        loadPlaywright,
        waitForUserConfirm,
        emit
      }
    );

    expect(launchPersistentContext).toHaveBeenCalledWith("/tmp/obfronter-profile", { headless: false });
    expect(goto).toHaveBeenCalledWith("https://x.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 12_345
    });
    expect(waitForUserConfirm).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalled();
    expect(result).toEqual({
      sessionProfileDir: "/tmp/obfronter-profile",
      loginUrl: "https://x.com/login"
    });
  });

  it("fails when session profile dir is missing", async () => {
    await expect(() =>
      runXLoginCommand({
        sessionProfileDir: ""
      })
    ).rejects.toThrow("Missing --session-profile-dir");
  });

  it("normalizes playwright-load failures", async () => {
    const loadPlaywright = vi.fn(async () => {
      throw new Error("missing module");
    });

    await expect(() =>
      runXLoginCommand(
        {
          sessionProfileDir: "/tmp/session"
        },
        {
          loadPlaywright,
          waitForUserConfirm: async () => undefined,
          emit: () => undefined
        }
      )
    ).rejects.toThrow("missing module");
  });
});
