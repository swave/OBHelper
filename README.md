# OBHelper

Agent-first CLI scaffold for ingesting URL content (X / Weixin / Weibo / generic web pages), extracting main article text, converting to Markdown, and saving into an Obsidian vault.

## Status
- Scaffolded architecture with deterministic tests and CI gates.
- Ready for site-specific hardening and authenticated-session workflows.

## Quick Start
```bash
npm install --no-audit --no-fund
npm run build
node dist/cli.js fetch "https://example.com/post" \
  --vault "/path/to/ObsidianVault" \
  --cdp-endpoint "http://127.0.0.1:9222"
```

`npm install` now auto-installs Playwright Chromium for local environments so CDP fetch mode dependencies are present out of the box.
To skip this (for CI or constrained environments), set `OBHELPER_SKIP_PLAYWRIGHT_INSTALL=1`.

## CLI Usage
```bash
obhelper fetch <url> [--vault <path>] [options]
obhelper settings <subcommand>
```

Options:
- `--cdp-endpoint <url>`: connect fetch to a running Chrome DevTools endpoint (or set `OBHELPER_CDP_ENDPOINT`)
- `--cdp-auto-launch`: if a local CDP endpoint is unavailable, open a dedicated Chrome debug profile and retry
- `--no-cdp-auto-launch`: disable a stored `cdp-auto-launch` default for a single fetch
- `--timeout-ms <number>`: fetch timeout
- `--overwrite`: overwrite existing target file

Persistent local defaults:
- `obhelper settings list`
- `obhelper settings get <key>`
- `obhelper settings set <key> <value>`
- `obhelper settings unset <key>`
- `obhelper settings path`

Available keys:
- `vault`
- `cdp-endpoint`
- `cdp-auto-launch`
- `timeout-ms`

Fetch resolves defaults in this order: CLI flag, then environment variable, then stored setting.

Example:
```bash
obhelper settings set vault "/path/to/Vault"
obhelper settings set cdp-endpoint "http://127.0.0.1:9222"
obhelper settings set cdp-auto-launch true

obhelper fetch "https://x.com/<user>/status/<id>"
```

CDP mode (use your own Chrome session):
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.obhelper/chrome-cdp"

obhelper fetch "https://x.com/<user>/status/<id>" \
  --vault "/path/to/Vault" \
  --cdp-auto-launch \
  --cdp-endpoint "http://127.0.0.1:9222"
```

`--cdp-auto-launch` currently supports only local CDP endpoints and opens a dedicated macOS Google Chrome profile at `~/.obhelper/chrome-cdp`.

## Architecture
See the full development blueprint in [ARCHITECTURE.md](./ARCHITECTURE.md).

Pipeline stages are explicit and swappable:
1. `fetch`: retrieve source HTML.
2. `extract`: identify main content.
3. `markdown`: convert HTML to Markdown and attach frontmatter.
4. `obsidian`: write into vault with deterministic naming.

Directory map:
```text
src/
  core/        # pipeline orchestration, types, errors, source routing
  fetch/       # CDP fetcher plus legacy fetch implementations
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

## X E2E (CDP)
You can run a real-browser E2E check for X extraction via CDP:

```bash
export X_E2E_URL_TEXT="https://x.com/<user>/status/<id>"
export X_E2E_EXPECT_TEXT="a short phrase expected in markdown"
export OBHELPER_CDP_ENDPOINT="http://127.0.0.1:9222"
npm run test:e2e:x
```

Optional link-only case:
- `X_E2E_URL_LINK_ONLY`: a link-only X status URL
- `X_E2E_EXPECT_LINK`: expected destination host/phrase in markdown (optional; defaults to checking `Expanded links`)
- `E2E_VAULT_DIR`: custom output vault path (default: temporary directory)
- `X_E2E_TIMEOUT_MS`: fetch timeout in milliseconds (default: `90000`)

## Notes on Access Restrictions
Some pages require login, anti-bot checks, or dynamic rendering. The scaffold uses CDP mode as a compliant extension point; no CAPTCHA bypass logic is included.

## X Provider (v1)
- Supports only X status URLs (`https://x.com/<handle>/status/<id>` or `/i/web/status/<id>`).
- Fetch runs in CDP mode and requires a CDP endpoint.
- If extraction is blocked, it attempts a public oEmbed fallback before writing a blocked note.
- You can attach fetch to a manually opened Chrome instance with `--cdp-endpoint`.
- You can add `--cdp-auto-launch` to auto-open a dedicated local Chrome debug profile when the local CDP endpoint is down.
- For link-only posts (for example `t.co` only), it adds expanded destination links when resolvable.

## Weixin Provider (v1)
- Supports only article URLs shaped like `https://mp.weixin.qq.com/s?...` with article query identifiers.
- Extracts title, author, publish time, main content, and image URLs into markdown/frontmatter.
- If the article is deleted or blocked, it writes a blocked note with reason and source URL.
