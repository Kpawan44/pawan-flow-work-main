# PHASE1_REPORT — PMW Manufacturing Tracker hardening

Production Firestore, Firebase project IDs, Cloud Run, Firebase Hosting, and `firestore.rules` were **not** deployed or mutated.

## Status

```
PHASE: 0–11
STATUS: COMPLETE (rules/hosting/Cloud Run deploy NOT performed — requires separate approval)
PROGRESS: 100% of in-repo hardening
FILES CHANGED: see below
TESTS: 45 PASS / 0 FAIL (`npm test`)
BLOCKERS: none for merge of code; production rollout needs SESSION_SECRET + separate rules deploy approval
NEXT STEP: human review; do not auto-deploy
```

## Commands used

```
git checkout -b cursor/backend-hardening-a4bf
npm install
npm run lint
npm run build
npm test
```

Post-change validation (this revision):

| Check | Result |
|---|---|
| `npm test` | **45 PASS / 0 FAIL** (mocked MemoryStore; production Firestore not used) |
| `npm run lint` (`tsc --noEmit`) | **PASS** |
| `npm run build` | **PASS** (Vite + `dist/server.cjs`) |
| Production Firestore | **Not touched** |
| Cloud Run / Hosting / rules deploy | **Not performed** |

## Files changed

- `server.ts` — session secret fail-closed; exclusive Admin-or-REST persist; shared `commitMaterialMovementTx`; accept dest = `toDepartment`; process-transfer seq + state machine; factory reset preserves `super_admin`; RM SKU create-if-missing; `GET /api/auth/session`; `GET /api/auth/login-directory`
- `src/lib/firebase.ts` — UUID `operationId`; skip client job/audit/notif writes after API success; process-transfer API path; session token in `sessionStorage`; factory reset `firstRun` from server; no PIN-less login
- `src/App.tsx` — session restore via `/api/auth/session`; Purchase accept no longer rewrites destination
- `src/types.ts` — `operationId` on movements
- `src/components/RawMaterialRequestModal.tsx` — seed + runtime stock via `rmSkuMaster`; optional master fetch
- `firestore.rules` — **file only, not deployed**
- `.env.example` — `SESSION_SECRET=`
- `package.json` — `test` script
- `BASELINE_REPORT.md`, `PHASE1_REPORT.md`
- New: `src/hardening/*`, `test/hardening.test.ts`
- `test-production-hardening.ts` — no longer calls live `/verify-pin` or production Firestore; delegates to mocked tests

## Files untouched (intentionally)

- Firebase project ID / named database ID / `firebase-applet-config.json` project settings
- Manufacturing department UI workflow (`DepartmentOperations` complete handlers)
- Capacitor/Electron wrappers except shared web auth token storage
- Historical movements / no GRN collection
- Quantity-on-send model (still **does not** decrement `currentQty` on send)

## Bugs fixed

1. Purchase acceptance could overwrite destination after API success — destination is now `movement.toDepartment`.
2. Admin SDK write followed by REST write on movements/job cards/users/setup-admin.
3. Client wrote job cards, audits, notifications after successful movement/accept APIs.
4. `/api/movements` and `/api/inventory/movement` had different semantics; both now use `commitMaterialMovementTx` **without** decrement-on-send.
5. Process transfers used `Date.now() % 1000000` / client Firestore writes; now `mfr_system_state/process_transfer_seq` + API.
6. Factory reset deleted all `mfr_users` / credentials (including `super_admin`).
7. Default PIN `1234` and PIN-less local restore treated as auth.
8. Hardcoded production `SESSION_SECRET` fallback.

## Security improvements

- Production process refuses to start without a non-default `SESSION_SECRET`.
- HMAC sessions include `factoryResetGeneration`; reset rotates generation and issues a fresh token for the acting super_admin.
- Credentials collection remains Admin-only in rules draft.
- Idempotency keys, process transfers, system state: client write denied in rules draft.
- `mfr_users` public `read: if true` tightened to `isActiveUser()` in rules draft (login picker uses `/api/auth/login-directory`).
- User create requires an explicit valid 4-digit PIN.

## Tests passed (mocked `MemoryStore` / pure functions — no production Firestore)

1. Concurrent independent movements  
2. Duplicate `operationId` returns cached original  
3. Insufficient quantity  
4. Purchase → Raw Material Store dest  
5. Purchase → Store dest  
6. Unauthorized department  
7. STOCK-IN without job card  
8. Issue request without department change  
9. Same-department normal transfer rejected  
10. Wire rejection allowed  
11–12. Process transfer state machine / no skip  
13–14. Factory reset preserves super_admin; old generation sessions invalid  
15–17. Tampered / expired HMAC; missing Bearer  
18–19. Missing PIN; default `1234` never auto-assigned  
20. Duplicate op does not create two movements  
21–22. RM opening merge create-if-missing; stock formula `opening + in - issued - rejected`

## Tests failed

None in this revision.

## Remaining risks

- `firestore.rules` is **not live**. Until a separate approved deploy, production still uses previous rules (`mfr_users` publicly readable).
- Client Firestore fallback for movements still exists if the API is **unreachable** (not if the API returns 4xx).
- Accept REST fallback is used only when Admin SDK transaction is unavailable.
- Process-transfer quantity check uses existing `storeDetails.qtyRemaining ?? currentQty ?? orderQty`.
- Login directory enumerates names (same as previous public user list, narrower fields).
- Capacitor/Electron: session token is `sessionStorage` (cleared when the webview session ends). Profile cache is display-only; restore requires `/api/auth/session`.
- Factory reset does **not** purge `mfr_audit_logs` or `mfr_rm_sku_master` (opening stock master preserved).

## Database schema additions (create-if-missing; no destructive migration)

| Collection / doc | Purpose |
|---|---|
| `mfr_idempotency_keys/{operationId}` | Movement + process-transfer idempotency |
| `mfr_system_state/process_transfer_seq` | Sequential `STP-000001` numbering |
| `mfr_rm_sku_master/{code}` | Opening qty seed; never overwrite existing `openingQty` |
| Job card `pendingOutbound` | Transactional pending-route lock |

## Deployment prerequisites (manual; not done here)

1. Set unique `SESSION_SECRET` on Cloud Run (must not be a known hardcoded fallback).
2. Restart Cloud Run after secret is set — **production will fail to boot** without it.
3. Deploy `firestore.rules` only after explicit approval.
4. First authenticated `GET /api/rm-sku-master` creates missing SKU docs (create-if-missing only).

## Whether production was touched

**No.** No production data writes, no project/database ID changes, no Cloud Run/Hosting/rules deploys.
