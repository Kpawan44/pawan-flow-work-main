# Firestore Security Specification - TDD Payload Plan

This security specification outlines the data validation rules, relational invariants, and the test assertions designed to defend the Manufacturing Production Tracking System against identity spoofing and dirty state writes.

---

## 1. Core Data Invariants

1. **Identity & Role Enforcement**: Users CANNOT read or write user profiles of other users unless they are an `Admin`. Non-admins cannot modify their own `role` or `department` once created.
2. **Sequential Handover Integrity**: A Material Movement can only be created by an authenticated user matching the transfer department, transferring a quantity less than or equal to the current inventory.
3. **Immutability of History**: Audit logs are system-generated and are WRITE-ONCE, NEVER-UPDATE, and NEVER-DELETE.
4. **Verified Session Control**: Writes are rejected if the user's email is not verified, unless the app is in direct system configuration override mode.

---

## 2. The "Dirty Dozen" Threat Payloads

The following lists the 12 specific exploit payloads mapped to potential vulnerabilities and their required mitigation.

### Payload 1: The Self-Promotion Attack (Privilege Escalation)
* **Target Path**: `mfr_users/malicious_user`
* **Intended Exploit**: A registered standard staff user tries to rewrite their `role` field from `"staff"` to `"admin"`.
* **Mitigation**: Standard staff update rule blocks `incoming().role != existing().role`.

### Payload 2: Ghost Field Injector (Anti-Update-Gap Bypass)
* **Target Path**: `mfr_job_cards/JC-1002`
* **Intended Exploit**: An attacker updates a job card but introduces an unmodeled parameter (`approvedByAdmin: true`) into the document.
* **Mitigation**: The update allowblock validates that `.affectedKeys().hasOnly(['status', 'currentDepartment', 'operatorName', 'heatTreatmentDetails', 'platingDetails', 'packingDetails', 'storeDetails', 'dispatchDetails'])`.

### Payload 3: Identity Spoofing (Orphaned Job Card)
* **Target Path**: `mfr_job_cards/JC-1099`
* **Intended Exploit**: User `attacker_uid` submits a new `JobCard` where `createdBy` is set to `"Pawan Kumar"` (a system admin) instead of their actual UID.
* **Mitigation**: Helper `isValidJobCard` enforces `data.createdBy == request.auth.uid` or matches verified `request.auth.uid`.

### Payload 4: Invalid Material Creation (Negative Volume)
* **Target Path**: `mfr_movements/M-2099`
* **Intended Exploit**: Injected transfer quantity set to `-100` KG or highly bloated size `999999999` KG.
* **Mitigation**: Helper `isValidMovement` enforces `data.quantity > 0 && data.quantity <= 100000`.

### Payload 5: Audit Log Deletion
* **Target Path**: `mfr_audit_logs/AL-1`
* **Intended Exploit**: standard operator attempts to delete or hide a trace log.
* **Mitigation**: Catch-all default denial prevents all deletions and updates on `mfr_audit_logs`.

### Payload 6: Spoofed Material Acceptance
* **Target Path**: `mfr_movements/M-2002`
* **Intended Exploit**: Operator in `Production` attempts to accept a movement meant for `Plating`.
* **Mitigation**: Acceptance checks that the accepting user's profile department matches `toDepartment`.

### Payload 7: Denial-of-Wallet String Bloat (Size Attack)
* **Target Path**: `mfr_job_cards/JC-1005`
* **Intended Exploit**: Passing a 2MB base64 string inside the `partyName` field.
* **Mitigation**: String length restrictions on all text input schemas: `data.partyName.size() <= 100`.

### Payload 8: Terminal State Bypass
* **Target Path**: `mfr_job_cards/JC-1003`
* **Intended Exploit**: An operator tries to revert a `Completed` Job Card back to `Pending` to falsify reports.
* **Mitigation**: Terminal lock `existing().status != "Completed"`.

### Payload 9: Invalid String Characters (ID Poisoning)
* **Target Path**: `mfr_users/u-1!!`
* **Intended Exploit**: Registering a profile with malformed or dangerous characters in the ID.
* **Mitigation**: ID validation helper `isValidId(userId)` using regex checking `^[a-zA-Z0-9_\-]+$`.

### Payload 10: Clock Tampering (Faking timestamps)
* **Target Path**: `mfr_movements/M-4455`
* **Intended Exploit**: Setting `transferDate` to a date in the year 2045 or 1999 to disrupt reporting.
* **Mitigation**: Validate that `incoming().transferDate == request.time`.

### Payload 11: Non-existent Job Reference (Referential Integrity break)
* **Target Path**: `mfr_movements/M-9000`
* **Intended Exploit**: Submitting a movement for a fictional Job Card `JC-9999`.
* **Mitigation**: Verification checks `exists(/databases/$(database)/documents/mfr_job_cards/$(incoming().jobCardNo))` prior to write acceptance.

### Payload 12: Notification Hijack
* **Target Path**: `mfr_notifications/N-9988`
* **Intended Exploit**: User is authenticated but tries to mark a notification of another user as read.
* **Mitigation**: `allow update` on `mfr_notifications` requires `resource.data.userId == request.auth.uid`.

---

## 3. Test Cases for TDD

```typescript
// Test assertions mapping the "Dirty Dozen" to permission denied results:
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

// All payloads above must be tested and confirmed to return PERMISSION_DENIED.
```
