# PHASE2_VALIDATION_REPORT — Controlled pre-deployment validation

**NO PRODUCTION DEPLOYMENT PERFORMED.**

Validation date: 2026-09-05. Inspected live source on `cursor/backend-hardening-a4bf`. Phase 1 was **not** re-implemented. No production Firestore, Cloud Run, Hosting, or rules deploy.

## 1. Repository verification

Phase 1 artifacts **exist in source** (not assumed from reports):

| Artifact | Location | Match vs PHASE1_REPORT |
|---|---|---|
| `commitMaterialMovementTx()` | `src/hardening/commitMaterialMovement.ts`, used by `server.ts` | Yes |
| `operationId` / `mfr_idempotency_keys` | client UUID in `firebase.ts`; server idempotency | Yes |
| Admin vs REST exclusive persist | `persistDocsExclusive` | Yes for movements/users/setup-admin/process-transfer complete |
| Purchase accept routing | `applyAcceptanceDepartment`; `App.handleAcceptMovement` only API+refresh | Yes |
| Process transfers API | `firebase.ts` fetch `/api/process-transfers*`; no client `setDoc` on that collection | Yes |
| Sequence counter | `mfr_system_state/process_transfer_seq` | Yes |
| Factory Reset super_admin protect | `server.ts` + `factoryResetPolicy.ts` | Yes |
| SESSION_SECRET fail-closed | `assertSessionSecretSafe` | Yes |
| Server default PIN removed | `requireUserPin` on create | Yes |
| Session validation | `GET /api/auth/session`, HMAC gen/exp | Yes |
| RM SKU master | `mfr_rm_sku_master`, create-if-missing | Yes |
| Tightened `firestore.rules` | git only | Yes |
| Hardening tests | `test/hardening.test.ts` | Yes |

**Discrepancies vs reports:**

1. `PHASE1_REPORT.md` test count is **53** (was 45 after Phase 1, 33 in an earlier header).
2. `BASELINE_REPORT.md` describes **pre-Phase-1** live `test-production-hardening.ts`. Current file is a mocked wrapper that only imports `test/hardening.test.ts`.
3. AdminConsole empty PIN → `1234` was **fixed** in `d751327` (`resolveExplicitUserPin`; placeholder `"1234"` is format hint only).
4. `updateResetGeneration()` exclusive persist was **fixed** in `d751327`. Remaining same-document Admin-then-REST leftovers (`initSystemState`, user/job tombstones, job-card delete/purge) were switched to `persistExclusive` in the source-only audit.

## 2–5. Local validation

| Command | Result |
|---|---|
| `npm test` | **53 PASS / 0 FAIL** |
| `npx tsc --noEmit` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** |

No Phase-1 regressions found. No tests deleted or weakened.

## 6. Security audit findings

| Finding | Class |
|---|---|
| Deny-list of former SESSION_SECRET fallbacks in `src/hardening/constants.ts` (used only to **reject** startup) | SAFE (rotate Cloud Run if those values were ever live; do not reuse) |
| Production fail-closed without SESSION_SECRET | SAFE |
| HMAC token in `sessionStorage`; profile cache not sole HMAC auth | SAFE |
| Movement create requires `operationId` | SAFE |
| No `Date.now() %` STP numbering | SAFE |
| No client `setDoc` to `mfr_process_transfers` | SAFE |
| Purchase accept does not overwrite `toDepartment` in `App.tsx` | SAFE |
| Factory Reset skips `super_admin` delete/tombstone | SAFE (mocked) |
| Tests do not call production Firestore or Factory Reset HTTP | SAFE |
| Client movement Firestore fallback only if API **unreachable** and `auth.currentUser` | NEEDS REVIEW (intentional leftover) |
| Firebase `onAuthStateChanged` can set `currentUser` from profile if a Firebase Auth session exists | NEEDS REVIEW |
| `GET /api/auth/login-directory` enumerates names | NEEDS REVIEW (replaces former public user read) |
| Job-card update audit still REST after Admin job write (different collection) | NEEDS REVIEW |
| `POST /api/users/:id/set-pin` REST write | NEEDS REVIEW |
| AdminConsole empty PIN → `1234` | FIXED (`d751327`; empty PIN rejected) |
| `updateResetGeneration` Admin then REST same document | FIXED (`d751327` exclusive persist) |
| Job-card PUT audit REST after Admin job write (different collection) | NEEDS REVIEW (accepted leftover) |
| `POST /api/users/:id/set-pin` REST-only credential write | NEEDS REVIEW |
| Merging to `main` auto-deploys Firebase Hosting via GitHub Actions | HIGH RISK process (not executed here) |

## 7. Workflow verification

Unchanged:

- Purchase → Raw Material Store → Production → Heat Treatment → Plating → Packing → Store → Dispatch
- Dispatch → Production → Heat Treatment → Plating → Packing → Store → Dispatch

Movement create: `accepted: false`, job `Pending Acceptance`, `currentDepartment = toDepartment`, **no** `currentQty` decrement on send.

Accept: `currentDepartment` from `movement.toDepartment` only.

RM issue is still a side ledger (`isIssueRequest` does not change department).

Process transfer machine: Sent → Received → In Process → Returned to Store; skip rejected.

No GRN collection.

## 8. Factory Reset verification

Mocked via `applyFactoryResetToStore` + server inspection. **Not executed against production.**

- `super_admin` kept, `active: true`, credentials kept, not tombstoned
- Operational collections purged (jobs, movements, process transfers, notifications, items, outsource, idempotency, deleted job/movement tombs)
- `mfr_users` / credentials not wholesale-deleted
- Generation rotated; old HMAC invalid
- Response `token` + `firstRun: false` when super_admin exists
- Server `firstRun: false` in JSON; client uses `data.firstRun`

## 9. Authentication verification

- Production refuses missing/deny-listed secret
- Server create user requires valid 4-digit PIN
- `1234` is valid **if explicitly supplied**; server and AdminConsole do not auto-fill an empty PIN
- PIN-less Firestore login fallback throws (must verify via server)
- Session: token, exp, generation; `/api/auth/session` + active user lookup
- No Custom Token migration

## 10. Firestore rules compatibility (not deployed)

Deploying current rules **would**:

- Stop unauthenticated client reads of `mfr_users` (login must use API directory)
- Deny client writes to process transfers, system state, idempotency, credentials, tombs
- Leave job/movement client writes open for `isActiveUser()` (Firebase Auth required for client SDK)

HMAC-only users without Firebase Auth already depend on the API for mutations; that remains true.

**Do not deploy rules until backend + login-directory are confirmed in the target environment.**

## 11. Production configuration assessment

- Cloud Run **must** supply `SESSION_SECRET` or the new server **will not start** (`NODE_ENV=production`).
- Dockerfile does not bake a secret (correct).
- docker-compose production profile cannot start without adding SESSION_SECRET (fail-closed).
- No private key / service-account JSON in the repo.
- Firebase project ID in config files is unchanged (inspection only).
- Hosting workflows deploy on `main` push — merging is a deploy.

## 12. Production-access test audit

`test/hardening.test.ts` and `test-production-hardening.ts` use MemoryStore / pure functions only. No Factory Reset HTTP, no Admin SDK, no Cloud Run URL, no service account.

**No accidental production write path in the test suite.**

## 13. Files changed in Phase 2

- `PRE_DEPLOYMENT_CHECKLIST.md` (created; test count later aligned to 53)
- `PHASE2_VALIDATION_REPORT.md` (created; remediations recorded)
- `PHASE1_REPORT.md` (test count aligned to current suite)

Phase 2 later remediations: AdminConsole PIN, exclusive persist for factory-reset generation and remaining Admin+REST same-document writes.

## 14. Remaining risks

See HIGH RISK / NEEDS REVIEW above. Also: CI does not run `npm test`; Hosting auto-deploy on main; client fallback still exists.

## 15. Exact next steps before deployment

1. Human review of PR #1.
2. Set unique Cloud Run `SESSION_SECRET`.
3. Backup Firestore + record Cloud Run/Hosting/rules revisions.
4. Separate approvals: backend image, Hosting (main merge), rules.
5. Smoke tests in section H of the checklist — **after** approval only.

**NO PRODUCTION DEPLOYMENT PERFORMED.**
