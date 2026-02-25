# Obsidian Provider Plan (Agent-First Scaffold)

## Pre-Coding Plan (3-6 lines)
- **Goal + constraints:** Build a CLI provider that ingests one URL (X/Weixin/Weibo), extracts main content, converts to Markdown, and writes into an Obsidian vault with deterministic metadata and filenames.
- **Minimal approach:** Start with a modular pipeline (`fetch -> extract -> markdown -> persist`) plus URL-source routing and a single CLI command (`fetch`).
- **What we will NOT do (v1):** No CAPTCHA bypass, no account automation, no bulk crawling scheduler, no production-grade distributed workers.
- **Validation:** Add deterministic unit tests (routing, filename/frontmatter, orchestration) and CI gates (`lint`, `typecheck`, `test`, `coverage`).
- **Agent-first support:** Provide a runbook, stable scripts, one-command verification, and explicit extension points so future agents can implement site-specific logic safely.

## Milestones
1. **Core scaffolding**
   - Initialize TypeScript CLI project.
   - Define provider contracts and pipeline interfaces.
   - Implement URL domain routing for `x`, `weixin`, `weibo`, `generic`.
2. **Pipeline skeleton**
   - Add fetcher/extractor/markdown/writer modules.
   - Implement safe defaults + clear error handling.
   - Add optional authenticated-session support hooks.
3. **Testing and quality gates**
   - Unit tests for routing, writer, pipeline orchestration.
   - Coverage reporting and deterministic test fixtures.
   - Enforce lint/typecheck in local scripts and CI.
4. **Continuous Integration**
   - GitHub Actions for Node LTS matrix.
   - Cache dependencies and publish coverage artifact.
   - Fail fast on quality gate regressions.
5. **Agent enablement docs**
   - Architecture map, extension points, and conventions.
   - Step-by-step “how to add a new source/provider”.
   - Troubleshooting and expected command outputs.

## Target Repository Shape
```text
src/
  cli.ts
  core/
  fetch/
  extract/
  markdown/
  obsidian/
  providers/
tests/
  unit/
  fixtures/
.github/workflows/ci.yml
AGENT_GUIDE.md
README.md
```
