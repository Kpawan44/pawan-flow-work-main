# BASELINE_REPORT — PMW Manufacturing Tracker

Recorded before Phase 1 hardening edits. Production Firestore was not queried or modified.

## Commands

```
git checkout -b cursor/backend-hardening-a4bf
npm install
npm run lint    # tsc --noEmit
npm run build   # vite build + esbuild server.ts
```

Checkpoint commit: `main` at `16c5586` (clean working tree). Feature branch: `cursor/backend-hardening-a4bf`.

## Current build status

| Check | Result |
|---|---|
| `npm install` | Success (774 packages). 12 pre-existing npm audit advisories (11 moderate, 1 high). Not addressed in this baseline. |
| `npm run lint` | **PASS** (exit 0). No TypeScript errors. |
| `npm run build` | **PASS** (exit 0). Vite 6.4.3, `dist/server.cjs` 166.7kb. |
| `npm test` | **Not defined** in `package.json`. |

## Current TypeScript errors

None (`tsc --noEmit` exit 0).

## Current tests

*(This section is a pre-Phase-1 snapshot. After hardening, `npm test` runs a mocked suite of 53 tests. `test-production-hardening.ts` is now a wrapper that only imports `test/hardening.test.ts` and must not call production Firestore or live Cloud Run.)*

- At baseline: `test-production-hardening.ts` existed but was **not wired** to `package.json`.
- At baseline it called **removed** `POST /api/users/:id/verify-pin` and unauthenticated `POST /api/inventory/movement`.
- At baseline it was **not** a production-Firestore-safe suite.

## Important architecture findings

1. UI movement create: `DBService.createMovement` → `POST /api/movements`, then optional client `setDoc` and a **second** `updateJobCard`.
2. `POST /api/inventory/movement` is unused by the UI; different qty semantics (decrement `currentQty` on send).
3. `POST /api/movements` and `POST /api/job-cards` perform Admin SDK write **then always REST write**.
4. `App.handleAcceptMovement` overwrites Purchase destinations after accept.
5. Process transfers: client writes Firestore/localStorage; server APIs unused.
6. `mfr_process_transfers` has **no** `firestore.rules` match (default deny for clients).
7. Auth: HMAC session (not Firebase custom token); localStorage profile restore without token check; default PIN `1234` on user create; hardcoded `SESSION_SECRET` fallback.
8. Factory reset purges **`mfr_users` and `mfr_user_credentials` entirely** (deletes super_admin).
9. RM stock seed is hardcoded in `RawMaterialRequestModal.tsx`.
10. `mfr_users` rules: `allow read: if true`.

## Files requiring modification (planned)

- `server.ts`
- `src/lib/firebase.ts`
- `src/App.tsx`
- `src/components/RawMaterialRequestModal.tsx` (+ report imports)
- `firestore.rules`
- `.env.example`
- `package.json` (test script)
- New: `src/hardening/*`, `test/hardening.test.ts`
- `PHASE1_REPORT.md` (after implementation)
