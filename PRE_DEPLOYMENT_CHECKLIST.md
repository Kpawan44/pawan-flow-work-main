# PRE_DEPLOYMENT_CHECKLIST — PMW Manufacturing Tracker

**NO PRODUCTION DEPLOYMENT IS AUTHORIZED AUTOMATICALLY.**

This checklist is a human approval gate. Completing local tests does **not** authorize:

- Cloud Run deploy
- Firebase Hosting deploy
- `firestore.rules` deploy
- APK / Electron release
- Production Firestore data changes
- Factory Reset against production

Date of last local validation: 2026-09-05  
Branch: `cursor/backend-hardening-a4bf`  
Commit validated locally: `3dd0db8` plus this Phase 2 documentation revision  

---

## A. Code validation

- [x] `npm test` — 45 PASS / 0 FAIL (mocked MemoryStore; no production Firestore)
- [x] `npx tsc --noEmit` — PASS
- [x] `npm run lint` (`tsc --noEmit`) — PASS
- [x] `npm run build` — PASS
- [x] GitHub CI on the feature branch — PASS (lint/build; note: CI workflow does **not** run `npm test`)
- [ ] Human review of PR https://github.com/Kpawan44/pawan-flow-work-main/pull/1
- [ ] Confirm `DepartmentOperations` complete handlers still use the existing department sequence (not redesigned)

**Do not merge to `main` until Hosting auto-deploy risk in section E is accepted.**

---

## B. Security validation

| Item | Status | Notes |
|---|---|---|
| Movement commit transactional + idempotent | PASS (source) | `commitMaterialMovementTx()` |
| Admin+REST double-write on movement create | PASS | `persistDocsExclusive` |
| Client duplicate write after movement/accept API success | PASS | skipped when `apiSucceeded` |
| Purchase accept destination | PASS | `movement.toDepartment` |
| Process-transfer API authority + seq counter | PASS | `mfr_system_state/process_transfer_seq` |
| Factory Reset preserves `super_admin` | PASS (mocked) | never run against production |
| SESSION_SECRET fail-closed in production | PASS | `assertSessionSecretSafe` |
| Server user create requires 4-digit PIN | PASS | `requireUserPin` |
| AdminConsole still defaults empty PIN to `1234` | **OPEN** | UI path; server would accept an explicit `1234` if sent. Fix before or immediately after first backend release. **Not auto-changed in Phase 2.** |
| `updateResetGeneration` Admin then REST | **OPEN** | same document may be written twice. **Not auto-changed in Phase 2.** |
| `POST /api/users/:id/set-pin` REST-only | **OPEN** | not movement path |

---

## C. Authentication validation

- [x] Production process refuses missing or deny-listed `SESSION_SECRET`
- [x] HMAC lifetime 24 hours
- [x] Session restore: `GET /api/auth/session` + `sessionStorage` token
- [x] Failed session clears token and shows login
- [x] `localStorage` profile is not used as sole auth proof on HMAC path
- [ ] Confirm Cloud Run env has a **unique** `SESSION_SECRET` (not a deny-listed former fallback)
- [ ] Confirm no Firebase Custom Token migration was requested (Phase 2 does not migrate)
- [ ] Review leftover `onAuthStateChanged` Firebase Auth path (can restore a profile if a Firebase Auth session exists)

---

## D. Firestore rules validation (DO NOT DEPLOY YET)

Source file: `firestore.rules` (git only).

| Collection | Intended | Deploy impact |
|---|---|---|
| `mfr_user_credentials` | client deny | Safe; already deny |
| `mfr_users` | authenticated active user read | **Would break unauthenticated client `getDocs(mfr_users)`**. Login picker now uses `GET /api/auth/login-directory`. Requires API availability. |
| `mfr_process_transfers` | read active user; write deny | Aligns with API-only writes. Client `getDocs` fallback needs Firebase Auth. |
| `mfr_system_state` | write deny | Client cannot update generation |
| `mfr_idempotency_keys` | write deny | OK |
| tombstones | admin read, write deny | OK |
| `mfr_rm_sku_master` | active read; admin write | Create-if-missing is server-side |
| `mfr_audit_logs` | append-only with `userId == request.auth.uid` | HMAC-only users without Firebase Auth cannot client-create audits (API still can via Admin) |
| `mfr_job_cards` / `mfr_movements` | still client-writable for `isActiveUser()` | **Intentionally not locked** while API-unreachable Firestore fallback remains |

**Deploy rules only after explicit human approval.** Prefer deploying backend first so login-directory and process-transfer APIs are live.

---

## E. Cloud Run / Hosting configuration requirements

Required on Cloud Run **before** the new backend image is released:

1. `SESSION_SECRET` set to a unique value
2. Value must **not** match entries in `src/hardening/constants.ts` → `HARDCODED_SESSION_SECRETS` (deny-list of former fallbacks)
3. `NODE_ENV=production`
4. Existing Firebase project / named database IDs unchanged

Repository observations:

- `Dockerfile` sets `NODE_ENV=production` and does **not** inject `SESSION_SECRET` (must come from Cloud Run secrets).
- `docker-compose.yml` sets `NODE_ENV=production` but **does not** set `SESSION_SECRET` — a compose boot in production mode will **fail closed**. That is intended.
- `.env.example` documents `SESSION_SECRET=` with no value.
- `.github/workflows/firebase-hosting-merge.yml` and `firebase-hosting.yml` deploy **Firebase Hosting on push to `main`/`master`**. Merging this PR to `main` can deploy the **frontend** automatically. It does **not** deploy Cloud Run or rules by itself.
- `.github/workflows/ci.yml` runs lint+build only (no `npm test`).

Capability to supply `SESSION_SECRET`: **yes, via Cloud Run environment/secrets**, not via the repo. The repo does not contain a live production secret file.

---

## F. Backup requirements

Before any production backend or rules deploy:

- [ ] Export / snapshot Firestore named database `ai-studio-remixraj-d7813b87-2e92-4313-844a-f71fdf5b7a8d` (project `my-project-9ca72`)
- [ ] Record current Cloud Run revision ID for rollback
- [ ] Record current Hosting release
- [ ] Record current live `firestore.rules` checksum
- [ ] Confirm at least one `super_admin` account and that PIN is known to the operator (do not store PIN in git)

---

## G. Rollback plan

1. Cloud Run: traffic to previous revision (do not Factory Reset).
2. Hosting: restore previous Hosting release.
3. Rules: restore previously live rules file; do not “fix forward” on production data.
4. Do **not** run Factory Reset as a rollback tool.
5. Do **not** delete `super_admin` or credentials.

---

## H. Production smoke tests (after explicit deploy approval only)

Run only after a human authorizes a specific environment:

1. Login Name + 4-digit PIN
2. Session restore after refresh
3. Create movement Production → Heat Treatment: unaccepted, job `Pending Acceptance`, `currentDepartment` = destination, `currentQty` unchanged
4. Accept: department remains destination
5. Purchase → Raw Material Store accept stays RM Store
6. Purchase → Store accept stays Store
7. Duplicate movement `operationId` returns same movement
8. Process transfer cannot skip Sent → Complete
9. Unauthorized department movement rejected
10. Confirm `super_admin` still exists (do **not** Factory Reset in production as a test)

---

## I. Monitoring requirements

- Cloud Run startup failures (`SESSION_SECRET` missing)
- 401 rate on `/api/auth/session` and `/api/movements`
- 409/400 duplicate pending handover errors
- Process-transfer 400 skip-state errors
- Firestore Admin vs REST fallback log lines (`[PERSIST]`, `[MOVEMENT COMMIT]`)

---

## J. Explicit deployment approval gate

Check **all** before any production action:

- [ ] Product owner approves backend image release
- [ ] Security owner approves `SESSION_SECRET` rotation/set
- [ ] Security owner separately approves **rules** deploy (may be a later change)
- [ ] Security owner separately approves **Hosting** deploy (merging to `main` may auto-deploy Hosting)
- [ ] Backup completed (section F)
- [ ] Rollback owner identified (section G)
- [ ] AdminConsole default PIN `1234` issue accepted or fixed
- [ ] `updateResetGeneration` double-write issue accepted or fixed

Until those boxes are checked:

**NO PRODUCTION DEPLOYMENT IS AUTHORIZED AUTOMATICALLY.**
