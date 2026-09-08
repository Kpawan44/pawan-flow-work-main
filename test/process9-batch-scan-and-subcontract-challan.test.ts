import { describe, it } from 'node:test';
import assert from 'node:assert';
import { verifyBatchManifestTx } from '../src/hardening/batchManifestScanner';
import { createSubcontractChallanTx } from '../src/hardening/subcontractChallan';

describe('PROCESS 9 — BATCH SCAN & SUBCONTRACT CHALLAN INTEGRATION TESTS', () => {
  it('TEST 1: Valid batch scan verification succeeds and marks isDispatchable = true', () => {
    const jobMap = new Map<string, any>([
      ['JC-101', { jobCardNo: 'JC-101', currentQty: 500, unit: 'PCS', status: 'In Production' }],
      ['JC-102', { jobCardNo: 'JC-102', currentQty: 300, unit: 'KG', status: 'In Store' }]
    ]);

    const result = verifyBatchManifestTx(
      [
        { scannedCode: 'JC-101', expectedQty: 200 },
        { scannedCode: 'JC-102', expectedQty: 300 }
      ],
      jobMap,
      'MAN-9001',
      'GRP-9001'
    );

    assert.strictEqual(result.totalScanned, 2);
    assert.strictEqual(result.validCount, 2);
    assert.strictEqual(result.invalidCount, 0);
    assert.strictEqual(result.isDispatchable, true);
    assert.strictEqual(result.items[0].status, 'VALID');
    assert.strictEqual(result.items[1].status, 'VALID');
    assert.strictEqual(result.manifestId, 'MAN-9001');
  });

  it('TEST 2: Scan verification rejects non-existent job card', () => {
    const jobMap = new Map<string, any>([
      ['JC-101', { jobCardNo: 'JC-101', currentQty: 500, unit: 'PCS', status: 'In Store' }]
    ]);

    const result = verifyBatchManifestTx(
      [
        { scannedCode: 'JC-101' },
        { scannedCode: 'JC-UNKNOWN' }
      ],
      jobMap
    );

    assert.strictEqual(result.totalScanned, 2);
    assert.strictEqual(result.validCount, 1);
    assert.strictEqual(result.invalidCount, 1);
    assert.strictEqual(result.isDispatchable, false);
    assert.strictEqual(result.items[1].status, 'INVALID_JOB');
  });

  it('TEST 3: Scan verification rejects completed or 0-qty job card', () => {
    const jobMap = new Map<string, any>([
      ['JC-COMPLETED', { jobCardNo: 'JC-COMPLETED', currentQty: 0, unit: 'PCS', status: 'Completed' }]
    ]);

    const result = verifyBatchManifestTx(
      [{ scannedCode: 'JC-COMPLETED' }],
      jobMap
    );

    assert.strictEqual(result.isDispatchable, false);
    assert.strictEqual(result.items[0].status, 'ALREADY_DISPATCHED');
  });

  it('TEST 4: Scan verification rejects quantity exceeding available store stock', () => {
    const jobMap = new Map<string, any>([
      ['JC-LIMITED', { jobCardNo: 'JC-LIMITED', currentQty: 100, unit: 'PCS', status: 'In Store' }]
    ]);

    const result = verifyBatchManifestTx(
      [{ scannedCode: 'JC-LIMITED', expectedQty: 150 }],
      jobMap
    );

    assert.strictEqual(result.isDispatchable, false);
    assert.strictEqual(result.items[0].status, 'QUANTITY_MISMATCH');
  });

  it('TEST 5: Scan verification correctly parses JSON QR payloads', () => {
    const jobMap = new Map<string, any>([
      ['JC-QR-999', { jobCardNo: 'JC-QR-999', currentQty: 400, unit: 'PCS', status: 'In Store' }]
    ]);

    const qrPayload = JSON.stringify({ jobCardNo: 'JC-QR-999', customer: 'Acme Corp' });
    const result = verifyBatchManifestTx(
      [{ scannedCode: qrPayload }],
      jobMap
    );

    assert.strictEqual(result.isDispatchable, true);
    assert.strictEqual(result.items[0].jobCardNo, 'JC-QR-999');
    assert.strictEqual(result.items[0].status, 'VALID');
  });

  it('TEST 6: Valid subcontract challan creation succeeds with OUTBOUND status', () => {
    const jobMap = new Map<string, any>([
      ['JC-SUB-1', { jobCardNo: 'JC-SUB-1', itemName: 'Gear Pin', currentQty: 1000, unit: 'PCS' }]
    ]);
    const existingChallans = new Set<string>();

    const res = createSubcontractChallanTx(
      {
        vendorName: 'Apex Plating Works',
        vendorGstin: '27AAAAA0000A1Z5',
        vendorAddress: 'Industrial Zone, Plot 42',
        expectedReturnDate: '2026-09-15',
        items: [
          { jobCardNo: 'JC-SUB-1', itemName: 'Gear Pin', processRequired: 'Zinc Plating', sentQty: 600, unit: 'PCS' }
        ],
        userId: 'usr-operator-1',
        userName: 'Pawan Operator'
      },
      jobMap,
      existingChallans
    );

    assert.strictEqual(res.success, true);
    assert.ok(res.challan);
    assert.strictEqual(res.challan.challanNo, 'SCH-000001');
    assert.strictEqual(res.challan.status, 'OUTBOUND');
    assert.strictEqual(res.challan.totalSentQty, 600);
    assert.strictEqual(res.challan.items[0].processRequired, 'Zinc Plating');
  });

  it('TEST 7: Subcontract challan creation fails when vendorName is empty', () => {
    const jobMap = new Map<string, any>([
      ['JC-SUB-1', { jobCardNo: 'JC-SUB-1', currentQty: 1000 }]
    ]);

    const res = createSubcontractChallanTx(
      {
        vendorName: '   ',
        items: [{ jobCardNo: 'JC-SUB-1', itemName: 'Gear Pin', processRequired: 'Plating', sentQty: 100 }],
        userId: 'u1',
        userName: 'User One'
      },
      jobMap,
      new Set()
    );

    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /Vendor name is required/);
  });

  it('TEST 8: Subcontract challan creation fails when items array is empty', () => {
    const res = createSubcontractChallanTx(
      {
        vendorName: 'Apex Plating',
        items: [],
        userId: 'u1',
        userName: 'User One'
      },
      new Map(),
      new Set()
    );

    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /At least one item is required/);
  });

  it('TEST 9: Subcontract challan fails when sentQty exceeds available stock', () => {
    const jobMap = new Map<string, any>([
      ['JC-OVER', { jobCardNo: 'JC-OVER', currentQty: 250, unit: 'PCS' }]
    ]);

    const res = createSubcontractChallanTx(
      {
        vendorName: 'HeatTreat Co',
        items: [{ jobCardNo: 'JC-OVER', itemName: 'Shaft', processRequired: 'Hardening', sentQty: 500 }],
        userId: 'u1',
        userName: 'User One'
      },
      jobMap,
      new Set()
    );

    assert.strictEqual(res.success, false);
    assert.match(res.error || '', /exceeds available quantity/);
  });

  it('TEST 10: Sequential challan generation produces SCH-000001, SCH-000002 without collision', () => {
    const jobMap = new Map<string, any>([
      ['JC-SEQ', { jobCardNo: 'JC-SEQ', currentQty: 1000 }]
    ]);
    const existing = new Set<string>(['SCH-000001']);

    const res = createSubcontractChallanTx(
      {
        vendorName: 'Vendor B',
        items: [{ jobCardNo: 'JC-SEQ', itemName: 'Part B', processRequired: 'Coating', sentQty: 100 }],
        userId: 'u1',
        userName: 'User One'
      },
      jobMap,
      existing
    );

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.challan?.challanNo, 'SCH-000002');
  });
});
