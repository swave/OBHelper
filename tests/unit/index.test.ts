import { describe, expect, it } from "vitest";

import { runFetchCommand } from "../../src/index.js";

describe("runFetchCommand", () => {
  it("requires session profile for x provider default browser mode", async () => {
    await expect(() =>
      runFetchCommand({
        url: "https://x.com/test/status/123",
        vaultPath: "/tmp/vault"
      })
    ).rejects.toThrow(
      "X provider defaults to browser mode. Provide --session-profile-dir or use --http-mode"
    );
  });
});
