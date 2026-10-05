// Usage: npm run admin:purge-pickups [-- <days>]   (default: PICKUP_PURGE_DAYS, normally 7)
// Erases the address, access notes and phone number of pickups whose pledge was collected, cancelled or a no-show
// more than N days ago. Run once a day from cron (see docs/OPERATIONS.md). Safe to run any time: it is idempotent.
import { config } from "../src/lib/config";
import { purgePickups } from "../src/lib/services/pickups";

const days = process.argv[2] ? Number(process.argv[2]) : config.pickupPurgeDays;
if (!Number.isFinite(days) || days < 0) {
  console.error("Usage: npm run admin:purge-pickups [-- <days>]");
  process.exit(1);
}
const n = purgePickups(undefined, days);
console.log(`Purged private details of ${n} pickup${n === 1 ? "" : "s"} closed more than ${days} days ago.`);
