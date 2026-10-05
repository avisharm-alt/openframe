# Safety operations and open decisions

The safeguards are in code (see README "Pickups are safe by default"). This page lists the **policy choices that are the owner's to make** and how to change each.

## Decisions needed before launch

| Decision | Current default | How to change |
|---|---|---|
| **Purge window**: how long address, notes and phone are kept after a pledge is collected, cancelled or a no-show | 7 days | `PICKUP_PURGE_DAYS`. Shorter is more private; longer helps resolve disputes. |
| **Visibility window**: how long before the pickup window coordinators and assigned volunteers can see the address | 24 hours | `PICKUP_VISIBLE_HOURS_BEFORE` |
| **Donor visibility**: the donor can always see their own address until the purge (the 24-hour rule applies to coordinators and volunteers) | donor always | `addressAccess` in `src/lib/services/pickups.ts` |
| **Overdue flag**: how late a pickup can be before coordinators are alerted | 2 hours after the window | `PICKUP_OVERDUE_HOURS` |
| **Insurance wording** on the Safety page | "OpenFrame does not provide insurance… chapters should confirm any coverage with their own campus group." | `INSURANCE_NOTICE` in `src/lib/copy.ts`. Have it checked against reality (campus club insurance, student union, an actual policy). |
| **Partner wording** | "Independent organisations… listing is not an endorsement or formal partnership." | `PARTNER_NOTICE` in `src/lib/copy.ts`. Agree wording with each agency; consider a written agreement. |
| **Emergency contact** | The Safety page tells volunteers to ask their coordinator for a number; OpenFrame does not store one. | Edit `SAFETY_RULES` in `src/lib/copy.ts`, or add a per-chapter field if you want it shown in the app. |
| **Email provider** | `console` (logs one line, sends nothing) | See [OPERATIONS.md](OPERATIONS.md). Until a real provider is configured nobody gets email. |
| **Dark-hours pickups**: windows run until 20:00, which is after sunset in winter | allowed | `WINDOW_LATEST` in `src/lib/types.ts` |

When the Safety rules change materially, bump `SAFETY_VERSION` in `src/lib/services/safety.ts`: volunteers must then acknowledge them again before their next assignment.

## Day-to-day

- **Pickups board:** check **Overdue** daily. Call the assigned pair (their emails are in Volunteers), then close the pickup (collected / no-show / cancelled) with a reason.
- **Concerns:** open reports are listed safety first. Set state and a resolution note. A volunteer's "safety concern" check-out cancels the pickup and files a priority report automatically.
- **Audit log** (Coordinate → Audit log): every address view with who and when. Review unexpected views.
- **Removing someone:** removing a volunteer releases their open assignments; a scheduled pickup left with fewer than two volunteers returns to "pledged".
