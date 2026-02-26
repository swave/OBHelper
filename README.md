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

`npm install` now auto-installs Playwright Chromium for local environments so browser fetch mode works out of the box.
To skip this (for CI or constrained environments), set `OBFRONTER_SKIP_PLAYWRIGHT_INSTALL=1`.

## CLI Usage
```bash
obfronter fetch <url> --vault <path> [options]
```

Options:
- `--subdir <name>`: vault subdirectory (default: `Inbox`)
- `--browser-mode`: force browser-session fetch mode (Playwright)
- `--http-mode`: force plain HTTP fetch mode (disables X auto browser mode)
- `--session-profile-dir <path>`: browser profile dir for authenticated cookies
- `--browser-channel <name>`: browser channel for fetch browser mode (`chrome`, `chromium`, `msedge`)
- `--cdp-endpoint <url>`: attach fetch to a running Chrome DevTools endpoint (or set `OBFRONTER_CDP_ENDPOINT`)
- `--cookie-file <path>`: cookie file for fetch (`raw cookie header` or `Netscape cookie file`)
- `--cookie-env <name>`: env var name that contains cookie header for fetch
- `--timeout-ms <number>`: fetch timeout
- `--overwrite`: overwrite existing target file
- `--header <k:v>`: repeatable custom HTTP header

HTTP mode with cookies from env var:
```bash
export X_COOKIE='auth_token=...; ct0=...'
obfronter fetch "https://x.com/<user>/status/<id>" \
  --vault "/path/to/Vault" \
  --http-mode \
  --cookie-env X_COOKIE
```

CDP mode (use your own Chrome session):
```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.obfronter/chrome-cdp"

obfronter fetch "https://x.com/<user>/status/<id>" \
  --vault "/path/to/Vault" \
  --cdp-endpoint "http://127.0.0.1:9222"
```

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

## X E2E (CDP)
You can run a real-browser E2E check for X extraction via CDP:

```bash
export X_E2E_URL_TEXT="https://x.com/<user>/status/<id>"
export X_E2E_EXPECT_TEXT="a short phrase expected in markdown"
export OBFRONTER_CDP_ENDPOINT="http://127.0.0.1:9222"
npm run test:e2e:x
```

Optional link-only case:
- `X_E2E_URL_LINK_ONLY`: a link-only X status URL
- `X_E2E_EXPECT_LINK`: expected destination host/phrase in markdown (optional; defaults to checking `Expanded links`)
- `E2E_VAULT_DIR`: custom output vault path (default: temporary directory)
- `X_E2E_TIMEOUT_MS`: fetch timeout in milliseconds (default: `90000`)

## Notes on Access Restrictions
Some pages require login, anti-bot checks, or dynamic rendering. The scaffold includes browser-session mode as a compliant extension point; no CAPTCHA bypass logic is included.

## X Provider (v1)
- Supports only X status URLs (`https://x.com/<handle>/status/<id>` or `/i/web/status/<id>`).
- Defaults to browser mode for X and uses `chrome` browser channel by default.
- If direct HTML extraction is blocked, it attempts a public oEmbed fallback before writing a blocked note.
- You can attach fetch to a manually opened Chrome instance with `--cdp-endpoint`.
- For link-only posts (for example `t.co` only), it adds expanded destination links when resolvable.

## Weixin Provider (v1)
- Supports only article URLs shaped like `https://mp.weixin.qq.com/s?...` with article query identifiers.
- Extracts title, author, publish time, main content, and image URLs into markdown/frontmatter.
- If the article is deleted or blocked, it writes a blocked note with reason and source URL.
