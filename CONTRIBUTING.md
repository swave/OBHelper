# Contributing

## Development flow
1. `npm install --no-audit --no-fund`
2. Make the smallest possible change.
3. `npm run verify`
4. `npm run build`

## Test policy
- Unit tests must be deterministic.
- No live network calls in tests.
- Use fixtures for HTML samples.

## Commit quality
- Keep diffs focused.
- Prefer explicit logic over abstraction unless there is clear reuse.
- Update `PLAN.md` or docs when behavior changes.
