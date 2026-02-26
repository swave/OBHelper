import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ObsidianWriter, sanitizeFileName } from "../../src/obsidian/writer.js";

describe("sanitizeFileName", () => {
  it("removes invalid filename characters", () => {
    expect(sanitizeFileName('bad:/\\name*?"<>|')).toBe("bad name");
  });
});

describe("ObsidianWriter", () => {
  it("writes markdown with frontmatter to vault subdirectory", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-"));
    const writer = new ObsidianWriter(async () => ({
      ok: false,
      status: 500,
      headers: {
        get: () => null
      },
      arrayBuffer: async () => new ArrayBuffer(0)
    }));

    const first = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "My Test Note",
        markdownBody: "Hello markdown",
        byline: "By Test",
        extractionStatus: "blocked",
        authorHandle: "tester",
        statusId: "123",
        mediaUrls: ["https://example.com/image.jpg"]
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    expect(first.fileName).toBe("My Test Note.md");

    const fileContent = await readFile(first.outputPath, "utf8");
    expect(fileContent).toContain("source_platform: generic");
    expect(fileContent).toContain("Hello markdown");
    expect(fileContent).toContain("extraction_status: blocked");
    expect(fileContent).toContain('author_handle: "tester"');
    expect(fileContent).toContain('status_id: "123"');
    expect(fileContent).toContain('  - "https://example.com/image.jpg"');

    const second = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "My Test Note",
        markdownBody: "Second",
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    expect(second.fileName).toBe("My Test Note-2.md");
  });

  it("downloads remote images to local assets and appends markdown image embeds", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-assets-"));
    const writer = new ObsidianWriter(async (url) => {
      if (url === "https://example.com/one.jpg") {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null)
          },
          arrayBuffer: async () => new TextEncoder().encode("fake-jpg").buffer
        };
      }

      if (url === "https://example.com/two?format=png") {
        return {
          ok: true,
          status: 200,
          headers: {
            get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null)
          },
          arrayBuffer: async () => new TextEncoder().encode("fake-png").buffer
        };
      }

      return {
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "text/html" : null)
        },
        arrayBuffer: async () => new TextEncoder().encode("not-image").buffer
      };
    });

    const result = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "Image Note",
        markdownBody: "Body",
        mediaUrls: [
          "https://example.com/one.jpg",
          "https://example.com/not-image",
          "https://example.com/two?format=png"
        ]
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    const noteContent = await readFile(result.outputPath, "utf8");
    expect(noteContent).toContain("## Images");
    expect(noteContent).toContain("![Image 1](<Image Note_assets/image-1.jpg>)");
    expect(noteContent).toContain("![Image 2](<Image Note_assets/image-2.png>)");
    expect(noteContent).not.toContain("![Image 3]");

    const image1 = await readFile(path.join(vaultPath, "Inbox", "Image Note_assets", "image-1.jpg"), "utf8");
    const image2 = await readFile(path.join(vaultPath, "Inbox", "Image Note_assets", "image-2.png"), "utf8");
    expect(image1).toBe("fake-jpg");
    expect(image2).toBe("fake-png");
  });

  it("replaces inline remote markdown image urls with local asset paths", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-inline-assets-"));
    const writer = new ObsidianWriter(async (url) => ({
      ok: url === "https://example.com/inline.jpg",
      status: url === "https://example.com/inline.jpg" ? 200 : 404,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null)
      },
      arrayBuffer: async () => new TextEncoder().encode("inline-jpg").buffer
    }));

    const result = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "Inline Image Note",
        markdownBody: "Before image\n\n![inline](https://example.com/inline.jpg)\n\nAfter image"
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    const noteContent = await readFile(result.outputPath, "utf8");
    expect(noteContent).toContain("![inline](<Inline Image Note_assets/image-1.jpg>)");
    expect(noteContent).not.toContain("https://example.com/inline.jpg");
    expect(noteContent).not.toContain("## Images");

    const image = await readFile(path.join(vaultPath, "Inbox", "Inline Image Note_assets", "image-1.jpg"), "utf8");
    expect(image).toBe("inline-jpg");
  });

  it("replaces inline markdown image urls that contain escaped query separators", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-inline-escaped-"));
    const writer = new ObsidianWriter(async (url) => ({
      ok: url === "https://example.com/inline.jpg?format=jpg&name=large",
      status: url === "https://example.com/inline.jpg?format=jpg&name=large" ? 200 : 404,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null)
      },
      arrayBuffer: async () => new TextEncoder().encode("inline-jpg-escaped").buffer
    }));

    const result = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "Inline Escaped Image Note",
        markdownBody: "Before\n\n![inline](https://example.com/inline.jpg?format=jpg&amp;name=large)\n\nAfter"
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    const noteContent = await readFile(result.outputPath, "utf8");
    expect(noteContent).toContain("![inline](<Inline Escaped Image Note_assets/image-1.jpg>)");
    expect(noteContent).not.toContain("## Images");
    expect(noteContent).not.toContain("amp;");

    const image = await readFile(
      path.join(vaultPath, "Inbox", "Inline Escaped Image Note_assets", "image-1.jpg"),
      "utf8"
    );
    expect(image).toBe("inline-jpg-escaped");
  });

  it("stops local image downloads when overall budget is exhausted", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-image-budget-"));
    const mediaFetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      headers: {
        get: () => null
      },
      arrayBuffer: async () => new ArrayBuffer(0)
    }));

    const nowSpy = vi.spyOn(Date, "now");
    nowSpy.mockReturnValueOnce(1_000);
    nowSpy.mockReturnValueOnce(2_000);
    nowSpy.mockReturnValue(40_000);

    const writer = new ObsidianWriter(mediaFetch);
    await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "Budget Note",
        markdownBody: "Body",
        mediaUrls: [
          "https://example.com/1.jpg",
          "https://example.com/2.jpg",
          "https://example.com/3.jpg"
        ]
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );

    expect(mediaFetch).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it("skips image when image body read times out", async () => {
    const vaultPath = await mkdtemp(path.join(os.tmpdir(), "obhelper-test-image-timeout-"));
    const writer = new ObsidianWriter(
      async () => ({
        ok: true,
        status: 200,
        headers: {
          get: (name: string) => (name.toLowerCase() === "content-type" ? "image/png" : null)
        },
        arrayBuffer: async () => new Promise<ArrayBuffer>(() => {
          // Intentionally unresolved to simulate a stalled image stream.
        })
      }),
      {
        imageFetchTimeoutMs: 20,
        imageDownloadBudgetMs: 200
      }
    );

    const result = await writer.write(
      {
        sourceUrl: "https://example.com/post",
        sourcePlatform: "generic",
        fetchedAt: "2026-01-01T10:00:00.000Z",
        title: "Image Timeout Note",
        markdownBody: "Body",
        mediaUrls: ["https://example.com/slow.png"]
      },
      {
        vaultPath,
        subdirectory: "Inbox"
      }
    );
    const noteContent = await readFile(result.outputPath, "utf8");

    expect(noteContent).not.toContain("Image Timeout Note_assets");
  });
});
