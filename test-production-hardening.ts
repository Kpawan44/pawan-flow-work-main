/**
 * Replaced production-hitting suite.
 * This file MUST NOT write to production Firestore or call live Cloud Run.
 * It only runs the mocked hardening tests.
 */
import "./test/hardening.test.ts";
