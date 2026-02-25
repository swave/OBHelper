#!/usr/bin/env node

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const distCliPath = path.join(repoRoot, "dist", "cli.js");

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function optionalEnv(name) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function parseOutputPath(stdout) {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith("output_path="));
  if (!line) {
    throw new Error(`Unable to parse output_path from CLI output:\n${stdout}`);
  }

  return line.slice("output_path=".length);
}

function assertContains(haystack, needle, label) {
  if (!haystack.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`Assertion failed for ${label}: expected markdown to contain "${needle}"`);
  }
}

async function verifyCdpEndpoint(endpoint) {
  if (!endpoint.startsWith("http://") && !endpoint.startsWith("https://")) {
    return;
  }

  const probeUrl = `${endpoint.replace(/\/+$/, "")}/json/version`;
  let response;
  try {
    response = await fetch(probeUrl, {
      headers: {
        accept: "application/json"
      },
      signal: AbortSignal.timeout(5_000)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `CDP endpoint probe failed: ${probeUrl} (${detail}). Start Chrome with --remote-debugging-port=9222 and ensure it is reachable from this shell.`
    );
  }

  if (!response.ok) {
    throw new Error(`CDP endpoint probe failed: ${probeUrl} -> ${response.status}`);
  }

  const payload = await response.json();
  if (!payload || typeof payload.webSocketDebuggerUrl !== "string") {
    throw new Error(`CDP endpoint probe returned unexpected payload from ${probeUrl}`);
  }
}

async function runFetchCase(input) {
  const args = [
    distCliPath,
    "fetch",
    input.url,
    "--vault",
    input.vaultPath,
    "--subdir",
    input.subdir,
    "--cdp-endpoint",
    input.cdpEndpoint,
    "--timeout-ms",
    String(input.timeoutMs),
    "--overwrite"
  ];

  const { stdout, stderr } = await execFileAsync("node", args, {
    cwd: repoRoot,
    env: process.env,
    maxBuffer: 4 * 1024 * 1024
  });

  const outputPath = parseOutputPath(stdout);
  const markdown = await readFile(outputPath, "utf8");

  return {
    stdout,
    stderr,
    outputPath,
    markdown
  };
}

async function resolveVaultPath() {
  const configured = optionalEnv("E2E_VAULT_DIR");
  if (configured) {
    await mkdir(configured, { recursive: true });
    return configured;
  }

  return mkdtemp(path.join(os.tmpdir(), "obfronter-e2e-vault-"));
}

async function main() {
  if (!existsSync(distCliPath)) {
    throw new Error(`Build artifacts not found at ${distCliPath}. Run: npm run build`);
  }

  const textUrl = requiredEnv("X_E2E_URL_TEXT");
  const textExpected = requiredEnv("X_E2E_EXPECT_TEXT");
  const cdpEndpoint = optionalEnv("OBFRONTER_CDP_ENDPOINT") ?? "http://127.0.0.1:9222";
  const timeoutMs = Number(optionalEnv("X_E2E_TIMEOUT_MS") ?? "90000");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid X_E2E_TIMEOUT_MS: ${timeoutMs}`);
  }

  const linkOnlyUrl = optionalEnv("X_E2E_URL_LINK_ONLY");
  const linkExpected = optionalEnv("X_E2E_EXPECT_LINK");
  const vaultPath = await resolveVaultPath();

  await verifyCdpEndpoint(cdpEndpoint);

  const textResult = await runFetchCase({
    url: textUrl,
    subdir: "E2E-X-Text",
    cdpEndpoint,
    timeoutMs,
    vaultPath
  });
  assertContains(textResult.markdown, textExpected, "X_E2E_EXPECT_TEXT");

  if (linkOnlyUrl) {
    const linkResult = await runFetchCase({
      url: linkOnlyUrl,
      subdir: "E2E-X-LinkOnly",
      cdpEndpoint,
      timeoutMs,
      vaultPath
    });

    if (linkExpected) {
      assertContains(linkResult.markdown, linkExpected, "X_E2E_EXPECT_LINK");
    } else {
      assertContains(linkResult.markdown, "Expanded links", "link-only fallback marker");
    }
  }

  process.stdout.write(
    [
      "e2e_x_status=passed",
      `vault_path=${vaultPath}`,
      `text_output_path=${textResult.outputPath}`
    ].join("\n") + "\n"
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`E2EError: ${message}\n`);
  process.exit(1);
});
