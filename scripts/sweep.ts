// Usage: npm run admin:sweep
// The periodic housekeeping job. Run it every 15 minutes from cron (see docs/OPERATIONS.md). Safe to run any time and as
// often as you like: every step is idempotent.
//   - puts pickup claims that nobody scheduled within CLAIM_RELEASE_HOURS back on the board,
//   - expires requests a week after their needed-by date,
//   - posts and withdraws restock requests to match the chapters' restock targets,
//   - alerts coordinators to requests at risk of missing their needed-by date and to overdue pickups,
//   - sends shift reminders to volunteers.
import { sweep } from "../src/lib/services/sweep";

const r = sweep();
console.log(
  `Released ${r.released} unscheduled claim(s), expired ${r.expired} request(s), posted ${r.restockPosted} restock request(s), alerted on ${r.atRisk} at-risk request(s) and ${r.overdue} overdue pickup(s), sent ${r.reminders} shift reminder(s).`,
);
