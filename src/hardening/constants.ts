export const VALID_MANUFACTURING_DEPARTMENTS = [
  "Purchase",
  "Raw Material Store",
  "Dispatch",
  "Production",
  "Heat Treatment",
  "Plating",
  "Packing",
  "Store",
  "Admin",
  "Management",
  "Cutting",
  "Machining",
  "Welding",
  "Assembly",
  "Painting",
  "Quality",
  "Completed"
] as const;

export const HARDCODED_SESSION_SECRETS = [
  "pmw-tracker-production-cloud-secret-2026-auth",
  "pmw-tracker-secure-auth-secret-key-2026"
];

export const OPERATIONAL_RESET_COLLECTIONS = [
  "mfr_job_cards",
  "mfr_movements",
  "mfr_process_transfers",
  "mfr_notifications",
  "mfr_items",
  "mfr_outsource_orders",
  "mfr_idempotency_keys",
  "mfr_deleted_job_cards",
  "mfr_deleted_movements"
] as const;
