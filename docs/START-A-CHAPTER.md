# Start a chapter

Chapters are data, not code. Any campus can add one with no code change. You need an OpenFrame admin and one person who will coordinate.

## 1. Create the chapter (admin)

Either use **Admin → Start a chapter** in the site, or from a shell:

```bash
npm run admin:add-chapter -- "Toronto (UofT)" "Toronto, ON" America/Toronto toronto
```

You provide a name, a city, an IANA timezone (pickup windows of 09:00 to 20:00 are judged in this zone) and optionally a web address slug. The chapter appears on the home page straight away at `/?chapter=toronto`. Deactivate it with `PATCH /api/chapters/toronto {"active": false}` if you need to hide it.

## 2. Appoint its first coordinator

The person signs in once (so an account exists), then an admin appoints them on the Admin page, or:

```bash
npm run admin:grant -- coordinator@example.org coordinator --chapter toronto
```

Only admins can appoint coordinators. Coordinators add volunteers themselves (Coordinate → Volunteers, by the sign-in email).

## 3. The coordinator sets up the chapter

In **Coordinate → [chapter]**:

1. **Zones**: public drop-off locations (a campus front desk, a lobby). Never a private address.
2. **Partners**: sign the partnership note with each agency first ([PARTNER-ONBOARDING.md](PARTNER-ONBOARDING.md)), then add the partner (or approve its application on **Approvals**), add its **delivery sites** (public name, address, receiving hours) and approve its workers.
3. **Kits** (optional): the item catalog is shared. Review and activate the sample "Winter outreach kit" (each chapter has one, inactive) or create your own template, so workers can request N kits.
4. **Stock**: count what you have on the shelf and set **restock targets** for the essentials you want ready every day (socks, toques, gloves, toiletries). Below target, a restock request appears on the public board automatically.
5. **Shifts**: add weekly slots (for example "Tuesday evening run", 2 volunteers) and any exam-period or holiday boosts. Volunteers sign up for dates; coverage gaps show on the Shifts tab.
6. **Volunteers**: add volunteers. They must acknowledge the Safety rules before they can be assigned.

## 4. Before the first pickup

- Give every volunteer the chapter's emergency contact number (the Safety page asks them to get it from you).
- Decide who triages the **Requests** tab every day, who checks the **Pickups** board for the overdue flag, and who reads the **Concerns** queue (safety concerns first).
- Make sure the operator runs the two cron jobs in [OPERATIONS.md](OPERATIONS.md) (daily purge, 15-minute sweep).
- Confirm whether your campus group's insurance covers pickups. OpenFrame does not provide insurance.

## 5. Daily and weekly rhythm

**Daily:** triage Requests (fill from stock, call about anything at risk) → schedule claims and assign pairs on Pickups → count arrivals on Receive → plan a delivery run per site on Deliveries.

**Weekly:** check Shifts coverage for the next four weeks, top up Stock against the targets, and look at the Impact page: the number to watch is the median time from request to delivery (target: under 72 hours).
