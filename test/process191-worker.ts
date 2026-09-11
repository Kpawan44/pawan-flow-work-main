import { commitMaterialMovementTx } from "../src/hardening/commitMaterialMovement";
import { FileJsonStore } from "./process191-file-store";

const dataFile = process.env.P191_STORE || "";
const lockRoot = process.env.P191_LOCK || "";
const jobCardNo = process.env.P191_JOB || "JC-P191";
const operationId = process.env.P191_OP || "op";
const quantity = Number(process.env.P191_QTY || "600");

if (!dataFile || !lockRoot) {
  console.error(JSON.stringify({ success: false, error: "missing store paths" }));
  process.exit(2);
}

const store = new FileJsonStore(dataFile, lockRoot);
const result = await commitMaterialMovementTx(store, {
  operationId,
  jobCardNo,
  fromDepartment: "Production",
  toDepartment: "Heat Treatment",
  quantity,
  requireRawMaterialForProduction: true,
  actor: {
    userId: "u-production",
    userName: "Production User",
    role: "staff",
    department: "Production",
    allowedDepartments: ["Production"],
    accessList: ["Production"]
  }
});

console.log(
  JSON.stringify({
    success: result.success,
    cached: result.cached || false,
    statusCode: result.statusCode || (result.success ? 200 : 400),
    error: result.error || null,
    quantity: result.movement?.quantity || 0
  })
);
process.exit(result.success ? 0 : 0);
