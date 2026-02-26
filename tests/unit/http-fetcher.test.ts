import { describe, expect, it, vi } from "vitest";

import { HttpFetcher } from "../../src/fetch/http-fetcher.js";

describe("HttpFetcher", () => {
  it("wraps fetch errors with URL context", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network down"));
    const fetcher = new HttpFetcher();

    await expect(
      fetcher.fetch({
        url: "https://example.com/fail",
        timeoutMs: 1_000
      })
    ).rejects.toThrow("Unable to fetch https://example.com/fail (network down)");

    fetchMock.mockRestore();
  });

  it("times out when response body stream does not finish", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      url: "https://example.com/slow",
      text: async () => new Promise<string>(() => {
        // Intentionally unresolved to simulate stalled body streaming.
      })
    } as unknown as Response);

    try {
      const fetcher = new HttpFetcher();
      const pending = fetcher.fetch({
        url: "https://example.com/slow",
        timeoutMs: 15
      });
      const assertion = expect(pending).rejects.toThrow("Timed out while reading response body from https://example.com/slow");

      await vi.advanceTimersByTimeAsync(20);
      await assertion;
    } finally {
      fetchMock.mockRestore();
      vi.useRealTimers();
    }
  });
});
