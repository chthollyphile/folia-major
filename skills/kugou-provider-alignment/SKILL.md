---
name: kugou-provider-alignment
description: Align Folia's KuGou provider implementation with the repository API documentation and responses from the configured live KuGouMusicApi service. Use when adding or repairing KuGou search, lyrics, playback, account, playlist, album, artist, recommendation, or other provider functionality; when an endpoint path, request parameter, authentication field, or response shape is uncertain; or when validating a KuGou provider change against real data.
---

# KuGou Provider Alignment

Use the documented request contract and a live response as the source of truth before changing provider code. Never invent an endpoint path or response field because a mock, an old implementation, or a familiar KuGou shape looks plausible. For the public application boundary, also follow `skills/online-song-omni-routing/SKILL.md`: ordinary online-song interaction must remain behind Omni.

## Required workflow

### 1. Map the task to the existing provider

- Read the relevant product context in `README.md` and `src/README.md` before changing project files.
- Inspect `src/services/onlineMusic/kugouTransport.ts` for the operation name and endpoint mapping, then inspect `src/services/onlineMusic/kugouProvider.ts` or the relevant lyrics provider for normalization and response unwrapping.
- Keep the public data flow through `services/onlineMusic/omni.ts`; components, hooks, stores, and ordinary app services should not call a KuGou endpoint or concrete KuGou provider directly. Direct KuGou access is limited to the adapter/transport implementation and its focused tests.
- Locate the matching heading in `docs/ku-go-api-docs.md` with `rg -n` and read that section. Confirm the documented path, method, required parameters, optional parameters, authentication notes, and cache/timestamp requirements.

The documentation defines the request contract. The live response defines the response mapping. If they disagree, preserve the evidence, report the mismatch, and do not silently guess.

### 2. Prepare local credentials

Read the base URL from `.env.local` as `VITE_KUGOU_API_BASE`. Do not hardcode the deployed Vercel URL and do not print `.env.local` values. Electron normally uses its IPC bridge instead of this Web base URL; direct HTTP probing is for the configured Web service.

Read development-only credentials from `test-results/.dev-credentials`. The file is intentionally plaintext and must remain local. Use this shape when normalizing a successful client login request or response:

```json
{
  "cookie": "token=...;userid=...;dfid=...",
  "headers": {
    "User-Agent": "..."
  },
  "params": {
    "token": "...",
    "userid": "...",
    "dfid": "..."
  },
  "rawLoginRequestBody": {},
  "rawLoginResponse": {}
}
```

Preserve the exact client payload under `rawLoginRequestBody` or `rawLoginResponse`, but normalize every parameter needed for later calls into `cookie`, `headers`, or `params`. Do not commit, paste, or expose these values in source files, test fixtures, screenshots, logs, comments, or final messages. Do not repeatedly call a login endpoint; reuse the supplied session until it is invalid.

### 3. Probe the real endpoint

Use the bundled probe script so the base URL and credentials are loaded consistently:

```powershell
pwsh -NoProfile -File skills/kugou-provider-alignment/scripts/probe-ku-gou.ps1 `
  -Path /search `
  -QueryJson '{"keywords":"周杰伦","page":1,"pagesize":5}' `
  -OutputPath test-results/kugou-search.raw.json
```

For a documented POST endpoint, pass `-Method POST -BodyJson '{...}'`. The script forwards credential headers, adds the normalized cookie to the query when present, and adds a timestamp by default so a cached response does not masquerade as current data. Use `-DryRun` first when checking request construction. The dry-run output redacts sensitive values.

Inspect the complete response, including `status`, `errcode`/`error_code`, error text, envelope levels, arrays, pagination, and field types. Record only non-sensitive observations in code or tests. A successful HTTP status is not enough: KuGou endpoints can return an application-level error body.

If credentials or `VITE_KUGOU_API_BASE` are missing, stop and report the missing prerequisite. Do not fabricate cookie, token, userid, dfid, or response data. Prefer a safe read-only endpoint for validation; avoid mutating playlist/account endpoints unless the task explicitly requires them.

### 4. Implement from observed data

- Keep endpoint paths and request parameter names aligned with `docs/ku-go-api-docs.md` and the captured request.
- Keep `requestKugou` as the raw transport boundary. Account for its existing Web behavior (query parameters, cookie, timestamp, response `body` unwrapping) and Electron behavior (IPC module response and session persistence) before changing a normalizer.
- Add response mappings only for fields observed in the live payload or documented as part of that endpoint. Prefer a small endpoint-specific adapter over a broad recursive fallback that hides contract mistakes.
- Preserve and test the session fields the runtime already uses: cookie values plus `token`, `userid`/`user_id`, and `dfid`. Treat device verification responses such as error code `20028` as a real protocol state, not as an empty result.
- Normalize into the existing provider types and route collections through the existing catalog/reference conventions. Do not make callers depend on raw KuGou field names.
- Keep the provider result behind the Omni contract. If a new KuGou capability is a normal online-song operation, add it to the shared Omni types/service instead of exposing a KuGou-only bypass.
- Keep Web and Electron behavior equivalent at the provider boundary, while retaining their transport-specific request mechanics.

### 5. Verify with live data and focused tests

Re-run the probe after the implementation and compare the provider result with the raw response. Add or update focused unit tests using the smallest observed response shape; do not replace real evidence with a guessed fixture. Run the relevant test file with `npm run test:unit -- <test-file>` and use the repository testing guidance to decide whether UI coverage is also needed. Avoid a full build when a focused test is sufficient.

When a live response changes or contradicts the docs, keep the raw capture under the already-ignored `test-results/` directory if a reproducible artifact is useful, redact credentials before sharing it, and call out the contract mismatch in the handoff.

## Probe script contract

`scripts/probe-ku-gou.ps1` is the standard direct HTTP probe. It accepts `-Path`, `-Method GET|POST`, `-QueryJson`, `-BodyJson`, `-OutputPath`, `-TimeoutSec`, `-NoTimestamp`, and `-DryRun`. It reads only the repository's `.env.local` and `test-results/.dev-credentials`; never add credentials as command-line arguments because shell history and process listings may retain them.
