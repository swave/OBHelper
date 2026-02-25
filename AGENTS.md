# AGENTS.md (Repo)

## X Debug Workflow (Required)

Use this workflow for all changes related to X fetching/extraction, CDP integration, X login/session handling, and X E2E scripts.

### Required E2E Inputs

Store reusable local values in `.env.e2e.local` (do not commit secrets):

```bash
X_E2E_URL_TEXT=https://x.com/<handle>/status/<id>
X_E2E_EXPECT_TEXT=<expected phrase from real post body>
OBFRONTER_CDP_ENDPOINT=http://127.0.0.1:9222
```

### Required Validation Gates (In Order)

1. `npm run build`
2. `npm test`
3. `env X_E2E_URL_TEXT=... X_E2E_EXPECT_TEXT=... OBFRONTER_CDP_ENDPOINT=http://127.0.0.1:9222 npm run test:e2e:x`

### Failure Loop (Mandatory)

If gate 3 fails:

1. Debug the failing stage (fetch, linked-page capture, extraction, markdown output).
2. Implement a minimal fix.
3. Re-run gate 3.
4. Repeat until gate 3 passes.

### Commit/Push Rule (Mandatory)

Do not commit or push any X-related changes unless all three gates pass in the current branch state.

### Reporting Rule

When finishing X-related work, report:

1. Which gates were run.
2. Pass/fail status for each gate.
3. Output markdown path from the E2E run when gate 3 passes.
