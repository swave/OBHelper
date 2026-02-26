# ObFronter Architecture Guide

This document is the implementation guide for the next development phase.
It describes how ObFronter is structured today, what constraints we keep, and how we evolve it safely.

## 1. Goal and Constraints

### Goal
Build a reliable CLI that ingests a URL, extracts primary content, converts it to clean Markdown, and writes it into an Obsidian vault.

### Hard constraints
- Keep changes minimal and maintainable.
- Keep behavior deterministic for tests and CI.
- Avoid anti-bot bypass logic. Support compliant session-based access only.
- Favor explicit module boundaries over clever abstractions.

## 2. System Overview

```text
CLI input
  -> Source detection + fetch strategy
  -> Fetch raw HTML (+ optional linked pages / captured code blocks)
  -> Extract main content (platform-specific or generic)
  -> Render Markdown + frontmatter
  -> Write into Obsidian vault
```

## 3. Module Boundaries

| Module | Responsibility | Key Files |
| --- | --- | --- |
| CLI | Parse commands/options and invoke pipeline | `src/cli.ts`, `src/cli-fetch-options.ts` |
| Core | Types, errors, source routing, pipeline orchestration | `src/core/types.ts`, `src/core/errors.ts`, `src/core/url-source.ts`, `src/core/pipeline.ts` |
| Fetch | Retrieve page HTML from HTTP/Browser/CDP | `src/fetch/http-fetcher.ts`, `src/fetch/browser-fetcher.ts`, `src/fetch/cdp-fetcher.ts`, `src/fetch/x-ready.ts` |
| Extract | Convert raw HTML into normalized main content | `src/extract/*.ts` |
| Markdown | HTML to Markdown conversion and frontmatter rendering | `src/markdown/render.ts` |
| Obsidian | File naming and vault write behavior | `src/obsidian/writer.ts` |
| Providers | Dependency wiring and extractor registry | `src/providers/default-deps.ts`, `src/providers/extractor-registry.ts` |
| Login | Interactive login flow for X session setup | `src/login/x-login.ts` |

## 4. Runtime Modes and Strategy

### Fetch modes
- `http`: direct HTTP requests, optional custom headers/cookies.
- `browser`: Playwright-driven browser session.
- `cdp`: attach to existing Chrome session (`--cdp-endpoint`) for real-user context.

### Selection intent
- Prefer the smallest reliable mode for a URL.
- Use browser/CDP for dynamic/auth-sensitive pages.
- Keep mode-specific logic inside `src/fetch/`, not in extractors.

## 5. Data Contracts (Keep Stable)

Primary flow contract in `src/core/types.ts`:
1. `FetchResult`
2. `ExtractedMainContent`
3. `NormalizedDocument`
4. `SaveResult`

Rules:
- Backward-compatible field additions only.
- Keep optional fields truly optional.
- Keep error signaling explicit via `ObfronterError`.

## 6. Extraction and Rendering Rules

### Extraction
- Platform extractor first (`x`, `weixin`, `weibo`), generic extractor fallback.
- Preserve meaningful structure: headings, lists, code blocks, blockquotes, images.
- Remove obvious non-content noise when deterministic markers exist.

### Rendering
- Markdown output should be readable in Obsidian and VS Code preview.
- Code blocks must remain fenced and positioned in article order.
- Frontmatter is the machine-readable metadata contract for automation.

## 7. Quality Architecture

### Required local checks
1. `npm run build`
2. `npm test`
3. For X-related changes: `npm run test:e2e:x` with real inputs

### CI gates (`.github/workflows/ci.yml`)
- Node matrix: 20, 22
- `npm install --no-audit --no-fund`
- `npm run verify` (`lint + typecheck + coverage tests`)
- `npm run build`
- Coverage artifact upload on Node 22

## 8. X Workflow Guardrail (Mandatory)

For any X-fetch/X-extraction/CDP/session change:
1. Run `npm run build`
2. Run `npm test`
3. Run X E2E with:
   - `X_E2E_URL_TEXT`
   - `X_E2E_EXPECT_TEXT`
   - `OBFRONTER_CDP_ENDPOINT`
4. If E2E fails, debug -> minimal fix -> rerun until green.
5. Do not commit/push X-related code unless all three pass in current branch state.

## 9. Extension Playbooks

### Add a new source provider
1. Extend source detection in `src/core/url-source.ts`.
2. Add extractor in `src/extract/`.
3. Register extractor in `src/providers/extractor-registry.ts` or dependency wiring.
4. Add deterministic unit tests with fixtures.
5. Update README and this architecture doc only if behavior/contracts change.

### Improve formatting fidelity
1. Reproduce with a fixed URL fixture.
2. Add/adjust unit test first (`tests/unit/render.test.ts` or extractor tests).
3. Implement minimal parsing/rendering change.
4. Validate no regression in markdown readability and ordering.

## 10. Operational Principles for Agent-First Development

- Prefer incremental, test-backed changes.
- Keep diffs tight and localized to one stage when possible.
- Make failures diagnosable (explicit errors, no silent drops).
- Preserve deterministic output for automation and review.

## 11. Near-Term Milestones

### Milestone A: Stability
- Expand fixture coverage for tricky HTML blocks (`pre/code/list/table/image`).
- Add more regression tests for order preservation and noise removal.

### Milestone B: Provider Hardening
- Harden Weixin/Weibo edge-case extraction.
- Improve generic extractor fallback heuristics without overfitting.

### Milestone C: DX and Packaging
- One-command local debug scripts.
- Improve release ergonomics for non-Node usage.

### Milestone D: Observability
- Add optional debug artifacts (raw HTML snapshot, extraction trace) behind flags.
- Keep default output clean and automation-friendly.

## 12. Change Acceptance Checklist

Before merging:
- Does this keep module boundaries clear?
- Are tests updated/added for new behavior?
- Does CI remain green?
- Is output markdown still readable and correctly ordered?
- Did we avoid introducing bypass/security-risk behavior?

