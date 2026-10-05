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
2. **Partners**: agencies that will receive packages. Note the [partner and insurance wording](SAFETY-OPERATIONS.md) before listing one.
3. **Templates**: the catalog is shared. Create a package template (for example "Winter kit") with its contents and a weekly target, then set it active. Active templates generate the standing needs on the public board: *packages still needed this week × contents − stock*. (Each new chapter does not get the sample "Winter kit" automatically; copy the contents from another chapter's template.)
4. **Needs**: post one-off needs with a priority and a public note.
5. **Volunteers**: add volunteers. They must acknowledge the Safety rules before they can be assigned.

## 4. Before the first pickup

- Give every volunteer the chapter's emergency contact number (the Safety page asks them to get it from you).
- Decide who checks the **Pickups** board daily for the overdue flag, and who reads the **Concerns** queue (safety concerns first).
- Make sure the operator runs the two cron jobs in [OPERATIONS.md](OPERATIONS.md) (purge, overdue emails).
- Confirm whether your campus group's insurance covers pickups. OpenFrame does not provide insurance.

## 5. Weekly rhythm

Receive what arrived (Receive tab) → assemble from templates (Packages tab shows what can be fully assembled) → hand off to a partner (agency and date only) → watch the Impact page.
