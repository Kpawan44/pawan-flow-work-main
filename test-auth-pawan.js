/**
 * Standalone Test Script: Authenticate 'Pawan Kumar' with PIN '1234'
 * 
 * Verifies each layer:
 * 1. User Profile Lookup
 * 2. Credential Verification (bcrypt)
 * 3. Token Issuance
 * 4. Protected Route / Middleware Verification
 */

async function runAuthTest() {
  const base = "http://localhost:3000";

  console.log("===============================================================");
  console.log("  PMW AUTHENTICATION ISOLATION TEST: 'Pawan Kumar' (PIN: 1234)");
  console.log("===============================================================\n");

  // Step 1: Query the diagnostic isolation endpoint
  console.log("--> [TEST 1] Calling Diagnostic Endpoint GET /api/auth/test-pawan...");
  try {
    const diagRes = await fetch(`${base}/api/auth/test-pawan?name=Pawan%20Kumar&pin=1234`);
    const diagData = await diagRes.json();
    console.log(`    Status Code: ${diagRes.status}`);
    console.log(`    Overall Result: ${diagData.overallStatus}`);
    console.log("    Detailed Diagnostic Breakdown:");
    if (diagData.diagnostics) {
      for (const step of diagData.diagnostics) {
        console.log(`      [${step.status}] ${step.step} ->`, JSON.stringify(step.details));
      }
    }
  } catch (err) {
    console.error("    [ERROR] Diagnostic endpoint failed:", err.message);
  }

  // Step 2: Test production /api/auth/login by Name ("Pawan Kumar")
  console.log("\n--> [TEST 2] Calling Standard Endpoint POST /api/auth/login with Name: 'Pawan Kumar'...");
  try {
    const loginRes1 = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Pawan Kumar", pin: "1234" })
    });
    const loginData1 = await loginRes1.json();
    console.log(`    Status Code: ${loginRes1.status}`);
    console.log(`    Success: ${loginData1.success}`);
    console.log(`    Authenticated User: ${loginData1.user?.name} (ID: ${loginData1.user?.userId}, Role: ${loginData1.user?.role})`);
    console.log(`    Custom Token Present: ${Boolean(loginData1.customToken)} (Length: ${loginData1.customToken?.length})`);
    console.log(`    Credential Leaks Check: ${!loginData1.user?.pinHash && !loginData1.user?.pin ? "SECURE (No secrets leaked)" : "INSECURE"}`);

    if (loginData1.customToken) {
      // Step 3: Test token authorization on a protected route
      console.log("\n--> [TEST 3] Verifying Generated Token on Protected Route GET /api/users...");
      const usersRes = await fetch(`${base}/api/users`, {
        headers: { "Authorization": `Bearer ${loginData1.customToken}` }
      });
      const usersData = await usersRes.json();
      console.log(`    Status Code: ${usersRes.status}`);
      console.log(`    Protected Route Access: ${usersRes.ok && usersData.success ? "GRANTED (Middleware Verified)" : "DENIED"}`);
    }
  } catch (err) {
    console.error("    [ERROR] Standard login endpoint failed:", err.message);
  }

  // Step 4: Test production /api/auth/login by User ID ("pawan-001")
  console.log("\n--> [TEST 4] Calling Standard Endpoint POST /api/auth/login with User ID: 'pawan-001'...");
  try {
    const loginRes2 = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "pawan-001", pin: "1234" })
    });
    const loginData2 = await loginRes2.json();
    console.log(`    Status Code: ${loginRes2.status}`);
    console.log(`    Success: ${loginData2.success}`);
    console.log(`    Authenticated User: ${loginData2.user?.name} (ID: ${loginData2.user?.userId}, Role: ${loginData2.user?.role})`);
  } catch (err) {
    console.error("    [ERROR] Standard login by ID failed:", err.message);
  }

  // Step 5: Test negative case with incorrect PIN ('0000')
  console.log("\n--> [TEST 5] Negative Test: Attempting login with incorrect PIN '0000'...");
  try {
    const wrongRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "pawan-001", pin: "0000" })
    });
    console.log(`    Status Code: ${wrongRes.status} (Expected: 401)`);
    console.log(`    Rejected Incorrect PIN: ${wrongRes.status === 401 ? "PASS" : "FAIL"}`);
  } catch (err) {
    console.error("    [ERROR] Negative test failed:", err.message);
  }

  console.log("\n===============================================================");
  console.log("  TEST COMPLETE");
  console.log("===============================================================\n");
}

runAuthTest().catch(console.error);
