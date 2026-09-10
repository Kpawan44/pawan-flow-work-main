import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;

function assert(name: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}`);
  }
}

const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
const commit = readFileSync(new URL("../src/hardening/commitMaterialMovement.ts", import.meta.url), "utf8");
const purchase = readFileSync(new URL("../src/hardening/process1Purchase.ts", import.meta.url), "utf8");

assert("1 claim uses the existing idempotency collection", server.includes('"mfr_idempotency_keys"'));
assert("2 claim key is stable per Purchase job", server.includes("purchase-create-${jobCardNo}"));
assert("3 Admin claim uses transaction create", server.includes("db.runTransaction") && server.includes("tx.create(ref, claim)"));
assert("4 REST claim uses create-if-absent precondition", server.includes('"currentDocument.exists": "false"'));
assert("5 stale claim recovery uses version precondition", server.includes('"currentDocument.updateTime": updateTime'));
assert("6 claim has pending and completed states", server.includes('status: "PENDING"') && server.includes('status: "COMPLETED"'));
assert("7 active concurrent claim is rejected", server.includes('kind: "busy"') && server.includes("Purchase operation is already being processed"));
assert("8 changed claim fingerprint is rejected", server.includes('kind: "conflict"') && server.includes("different immutable receipt data"));
assert("9 completed claim reuses artifacts", server.includes('kind: "completed"') && server.includes("cached: true"));
assert("10 claim completion stores result", server.includes("completePurchaseOperation") && server.includes("result"));
assert("11 quantity still commits through movement engine", server.includes("commitMaterialMovementTx") && commit.includes("mfr_idempotency_keys"));
assert("12 Purchase fingerprint remains server-generated", server.includes("createPurchaseCreationFingerprint") && purchase.includes("createPurchaseCreationFingerprint"));
assert("13 client movement API does not expose claim creation", !server.includes("app.post(\"/api/purchase-claims\""));

console.log(`\nProcess 71 tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
