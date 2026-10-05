// Usage: npm run admin:notify-overdue
// Emails each chapter's coordinators once for every scheduled pickup that is still open more than
// PICKUP_OVERDUE_HOURS (normally 2) after its window ended. Run every 15 minutes from cron (docs/OPERATIONS.md).
import { notifyOverduePickups } from "../src/lib/services/pickups";

// Deliveries are fire-and-forget; give them a moment before the process exits.
const n = notifyOverduePickups();
console.log(`Flagged ${n} newly overdue pickup${n === 1 ? "" : "s"}.`);
setTimeout(() => process.exit(0), 1500);
