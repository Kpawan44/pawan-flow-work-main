import {
  isAllFilterValue,
  jobCardMatchesCustomerAndItemName,
  jobCardMatchesSelectedCustomer,
  jobCardMatchesSelectedItemName,
  uniqueJobCardItemNames
} from "../src/hardening/departmentJobCardFilter";

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    console.error(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

const jobs = [
  { jobCardNo: "JC-1", partyName: "Acme", itemName: "Item A" },
  { jobCardNo: "JC-2", partyName: "Acme", itemName: "Item B" },
  { jobCardNo: "JC-3", partyName: "Beta Ltd", itemName: "Item A" },
  { jobCardNo: "JC-4", partyName: "Beta Ltd", itemName: "item a" },
  { jobCardNo: "JC-5", partyName: undefined, itemName: undefined },
  { jobCardNo: "JC-6", partyName: "Acme", itemName: null as unknown as string }
];

function apply(customer: string, item: string) {
  return jobs.filter((j) => jobCardMatchesCustomerAndItemName(j, customer, item)).map((j) => j.jobCardNo);
}

assert("A All Items leaves customer-only set unchanged", apply("All", "All").length === 6);
assert("A All Items with Acme is same as customer-only", JSON.stringify(apply("Acme", "All")) === JSON.stringify(["JC-1", "JC-2", "JC-6"]));

assert("B Item A exact (normalized) JC-1 JC-3 JC-4", JSON.stringify(apply("All", "Item A")) === JSON.stringify(["JC-1", "JC-3", "JC-4"]));
assert("B Item A does not include Item B", !apply("All", "Item A").includes("JC-2"));

assert("C Item B only JC-2", JSON.stringify(apply("All", "Item B")) === JSON.stringify(["JC-2"]));

assert("D Customer Acme + Item A only JC-1", JSON.stringify(apply("Acme", "Item A")) === JSON.stringify(["JC-1"]));

assert("E Clear Customer keep Item A", JSON.stringify(apply("All", "Item A")) === JSON.stringify(["JC-1", "JC-3", "JC-4"]));

assert("F Clear Item keep Acme", JSON.stringify(apply("Acme", "All")) === JSON.stringify(["JC-1", "JC-2", "JC-6"]));

assert(
  "G missing itemName does not throw and is excluded from Item A",
  (() => {
    try {
      const r = jobCardMatchesSelectedItemName({ itemName: undefined }, "Item A");
      const r2 = jobCardMatchesSelectedItemName(null, "Item A");
      return r === false && r2 === false;
    } catch {
      return false;
    }
  })()
);

assert("G missing itemName still included when All Items", jobCardMatchesSelectedItemName({ itemName: undefined }, "All") === true);

assert("H empty Item Name search treated as All", isAllFilterValue("") === true && apply("Acme", "").join() === apply("Acme", "All").join());

assert("I case-insensitive Item A vs item a", jobCardMatchesSelectedItemName({ itemName: "Item A" }, "item a") === true);
assert("I case-insensitive dropdown label ITEM A", jobCardMatchesSelectedItemName({ itemName: "item a" }, "ITEM A") === true);
assert("I substring must not match dropdown exact", jobCardMatchesSelectedItemName({ itemName: "Item A Extra" }, "Item A") === false);

assert("J Customer filter still includes (Acme matches Acme Corp style)", jobCardMatchesSelectedCustomer({ partyName: "Acme Corp" }, "Acme") === true);
assert("J Customer All includes missing partyName", jobCardMatchesSelectedCustomer({ partyName: undefined }, "All") === true);
assert("J Customer selected excludes missing partyName without throw", jobCardMatchesSelectedCustomer({ partyName: undefined }, "Acme") === false);

const names = uniqueJobCardItemNames(jobs);
assert("unique items ignore blank/null", names.includes("Item A") && names.includes("Item B") && names.length === 3);

console.log(`\nProcess 291 Item Name filter: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
