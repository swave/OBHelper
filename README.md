# ObFronter

Agent-first CLI scaffold for ingesting URL content (X / Weixin / Weibo / generic web pages), extracting main article text, converting to Markdown, and saving into an Obsidian vault.

## Status
- Scaffolded architecture with deterministic tests and CI gates.
- Ready for site-specific hardening and authenticated-session workflows.

## Quick Start
```bash
npm install --no-audit --no-fund
npm run build
node dist/cli.js fetch "https://example.com/post" --vault "/path/to/ObsidianVault"
```

## CLI Usage
```bash
obfronter fetch <url> --vault <path> [options]
```

Options:
- `--subdir <name>`: vault subdirectory (default: `Inbox`)
- `--browser-mode`: force browser-session fetch mode (Playwright)
- `--http-mode`: force plain HTTP fetch mode (disables X auto browser mode)
- `--session-profile-dir <path>`: browser profile dir for authenticated cookies
- `--timeout-ms <number>`: fetch timeout
- `--overwrite`: overwrite existing target file
- `--header <k:v>`: repeatable custom HTTP header

## Architecture
Pipeline stages are explicit and swappable:
1. `fetch`: retrieve source HTML.
2. `extract`: identify main content.
3. `markdown`: convert HTML to Markdown and attach frontmatter.
4. `obsidian`: write into vault with deterministic naming.

Directory map:
```text
src/
  core/        # pipeline orchestration, types, errors, source routing
  fetch/       # http and browser fetchers
  extract/     # generic + platform fallback extractors
  markdown/    # HTML -> Markdown + frontmatter rendering
  obsidian/    # safe file naming and writing logic
  providers/   # dependency wiring and extractor registry
tests/unit/    # deterministic unit tests
```

## Verification
```bash
npm run verify
```
This runs lint, typecheck, and coverage-enabled unit tests.

## Notes on Access Restrictions
Some pages require login, anti-bot checks, or dynamic rendering. The scaffold includes browser-session mode as a compliant extension point; no CAPTCHA bypass logic is included.

## X Provider (v1)
- Supports only X status URLs (`https://x.com/<handle>/status/<id>` or `/i/web/status/<id>`).
- Defaults to browser mode for X to improve extraction stability.
- If extraction is blocked, it writes a blocked note instead of silently failing.
