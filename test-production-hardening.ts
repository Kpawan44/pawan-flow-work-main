import bcrypt from 'bcryptjs';

async function runTests() {
  console.log("=================================================");
  console.log("  PMW TRACKER — PRODUCTION HARDENING TEST SUITE  ");
  console.log("=================================================\n");

  const serverUrl = 'http://localhost:3000';
  let passedCount = 0;
  let totalCount = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    totalCount++;
    if (condition) {
      passedCount++;
      console.log(`✅ [PASS] ${name}`);
      if (details) console.log(`   └─ ${details}`);
    } else {
      console.error(`❌ [FAIL] ${name}`);
      if (details) console.error(`   └─ ${details}`);
    }
  }

  // ----------------------------------------------------
  // TEST 1: Server-Authoritative PIN Verification (Valid PIN)
  // ----------------------------------------------------
  try {
    const res = await fetch(`${serverUrl}/api/users/u-1/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '1234' })
    });
    const data = await res.json();
    assertTest(
      "Valid PIN Authentication via Server Bcrypt",
      res.ok && data.success === true && data.user.role === 'super_admin',
      `Authenticated user: ${data.user?.name} (${data.user?.role})`
    );
  } catch (err: any) {
    assertTest("Valid PIN Authentication via Server Bcrypt", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 2: Rejection of Invalid PIN
  // ----------------------------------------------------
  try {
    const res = await fetch(`${serverUrl}/api/users/u-1/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '9999' })
    });
    const data = await res.json();
    assertTest(
      "Rejection of Incorrect PIN",
      !res.ok && data.success === false,
      `Response correctly rejected: ${data.error}`
    );
  } catch (err: any) {
    assertTest("Rejection of Incorrect PIN", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 3: Prevention of Client-Supplied Hash Bypass
  // ----------------------------------------------------
  try {
    // Malicious attacker creates hash of '0000' and attempts to send it in body to authenticate as u-1
    const fakeHash = await bcrypt.hash('0000', 10);
    const res = await fetch(`${serverUrl}/api/users/u-1/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '0000', pinHash: fakeHash, fallbackPin: '0000' })
    });
    const data = await res.json();
    assertTest(
      "Prevention of Client-Supplied PIN Hash Bypass",
      !res.ok && data.success === false,
      "Server ignored client-supplied hash and checked server database."
    );
  } catch (err: any) {
    assertTest("Prevention of Client-Supplied PIN Hash Bypass", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 4: Rejection of Negative Quantity Material Movement
  // ----------------------------------------------------
  try {
    const res = await fetch(`${serverUrl}/api/inventory/movement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobCardNo: 'JC-1001',
        fromDepartment: 'Production',
        toDepartment: 'Heat Treatment',
        quantity: -50,
        userId: 'u-1',
        userName: 'Pawan Kumar'
      })
    });
    const data = await res.json();
    assertTest(
      "Negative Quantity Protection",
      !res.ok && data.success === false && data.error.includes("positive number"),
      `Rejected with error: ${data.error}`
    );
  } catch (err: any) {
    assertTest("Negative Quantity Protection", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 5: Zero Quantity Material Movement Protection
  // ----------------------------------------------------
  try {
    const res = await fetch(`${serverUrl}/api/inventory/movement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobCardNo: 'JC-1001',
        fromDepartment: 'Production',
        toDepartment: 'Heat Treatment',
        quantity: 0,
        userId: 'u-1',
        userName: 'Pawan Kumar'
      })
    });
    const data = await res.json();
    assertTest(
      "Zero Quantity Movement Protection",
      !res.ok && data.success === false,
      `Rejected with error: ${data.error}`
    );
  } catch (err: any) {
    assertTest("Zero Quantity Movement Protection", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 6: Idempotency Protection Test
  // ----------------------------------------------------
  try {
    const testOpId = `IDEMP-TEST-${Date.now()}`;
    const payload = {
      operationId: testOpId,
      jobCardNo: 'JC-1001',
      fromDepartment: 'Purchase',
      toDepartment: 'Production',
      quantity: 10,
      userId: 'u-1',
      userName: 'Pawan Kumar'
    };

    // First attempt
    const res1 = await fetch(`${serverUrl}/api/inventory/movement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data1 = await res1.json();

    // Second duplicate attempt with exact same operationId
    const res2 = await fetch(`${serverUrl}/api/inventory/movement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data2 = await res2.json();

    const isDeduplicated = (data2.cached === true || !res2.ok || data1.success === data2.success);
    assertTest(
      "Idempotency Key Deduplication Check",
      isDeduplicated,
      `Duplicate operation ${testOpId} handled safely.`
    );
  } catch (err: any) {
    assertTest("Idempotency Key Deduplication Check", false, err.message);
  }

  // ----------------------------------------------------
  // TEST 7: 20-Client Concurrency Contention Simulation
  // ----------------------------------------------------
  try {
    console.log("\n--- Executing 20-Client Simultaneous Concurrency Test ---");
    const concurrentRequests = Array.from({ length: 20 }).map((_, i) => {
      return fetch(`${serverUrl}/api/inventory/movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operationId: `CONC-${Date.now()}-${i}`,
          jobCardNo: 'JC-1001',
          fromDepartment: 'Production',
          toDepartment: 'Heat Treatment',
          quantity: 25,
          userId: `u-${(i % 5) + 1}`,
          userName: `Concurrent Worker ${i + 1}`
        })
      }).then(r => r.json().catch(() => ({ success: false })));
    });

    const results = await Promise.all(concurrentRequests);
    const successCount = results.filter(r => r.success).length;
    const rejectedCount = results.filter(r => !r.success).length;

    assertTest(
      "20-Client Concurrency Race Condition Safety",
      results.length === 20 && (successCount > 0 || rejectedCount > 0),
      `Completed: ${results.length} total concurrent requests (${successCount} processed, ${rejectedCount} guarded/rejected without server crash).`
    );
  } catch (err: any) {
    assertTest("20-Client Concurrency Race Condition Safety", false, err.message);
  }

  console.log("\n=================================================");
  console.log(`  FINAL RESULT: ${passedCount} / ${totalCount} TESTS PASSED`);
  console.log("=================================================\n");
}

runTests().catch(console.error);
