# Agent Guide

This repository is structured for autonomous agent work with deterministic quality checks.

## One-command validation
```bash
npm run ci
```

## Quality gates (must stay green)
- `npm run lint`
- `npm run typecheck`
- `npm run test:coverage`
- `npm run build`

## Where to change what
- Add/replace fetch strategy: `src/fetch/`
- Add new source extractor: `src/extract/` and `src/providers/extractor-registry.ts`
- Modify output schema/frontmatter: `src/markdown/render.ts`
- Change vault write behavior: `src/obsidian/writer.ts`
- Add CLI options: `src/cli.ts`

## Deterministic testing expectations
- Do not use network in unit tests.
- Use fixtures under `tests/fixtures/`.
- Use fixed timestamps in tests.

## Adding a new source provider
1. Add host detection in `src/core/url-source.ts`.
2. Implement extractor in `src/extract/`.
3. Register extractor in `src/providers/default-deps.ts`.
4. Add unit tests for source detection and extractor fallback.

## Failure handling convention
- Throw explicit `ObfronterError` for predictable user-facing failures.
- Never swallow extractor/fetcher errors silently.
- Preserve minimal, parseable CLI output for automation.
