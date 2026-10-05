# Safety operations and open decisions

The safeguards are in code (see README "Pickups are safe by default"). This page lists the **policy choices that are the owner's to make** and how to change each.

## Decisions needed before launch

These six are the ones I need from you. Defaults are what the code does today.

| Decision | Current default | How to change |
|---|---|---|
| **1. Purge window**: how long address, notes and phone are kept after a claim is collected, cancelled or a no-show | 7 days | `PICKUP_PURGE_DAYS`. Shorter is more private; longer helps resolve disputes. |
| **2. Visibility window**: how long before the pickup window coordinators and assigned volunteers can see the address | 24 hours | `PICKUP_VISIBLE_HOURS_BEFORE` |
| **3. Claim auto-release time**: how long a pickup claim can sit without being scheduled before the request returns to the board | 48 hours | `CLAIM_RELEASE_HOURS`. Shorter keeps requests moving but gives coordinators less time to schedule; drop-offs are scheduled on creation and are not released. |
| **4. Safety page wording**, including the insurance statement | "OpenFrame does not provide insurance… chapters should confirm any coverage with their own campus group." | `SAFETY_RULES`, `NEIGHBOUR_SAFETY`, `INSURANCE_NOTICE` in `src/lib/copy.ts`. Have it checked against reality (campus club insurance, student union, an actual policy). When the rules change materially, bump `SAFETY_VERSION` in `src/lib/services/safety.ts` and every volunteer must acknowledge them again. |
| **5. Partnership-note wording**: the one-page note each partner signs (who may post, delivery sites, exclusions, the no-recipient-data rule) and the "Partners" statement on the Safety/About pages | Proposal in [PARTNER-ONBOARDING.md](PARTNER-ONBOARDING.md) and `PARTNER_NOTICE` in `src/lib/copy.ts` | Edit both. Consider legal review before a partner signs it. |
| **6. Email provider** | `console` (logs one line, sends nothing) | See [OPERATIONS.md](OPERATIONS.md). Until a real provider is configured nobody gets email, including volunteers' shift reminders and coordinators' at-risk alerts. |

## Other choices you may want to review

| Choice | Current default | Where |
|---|---|---|
| Neighbour visibility: a neighbour can always see their own address until the purge (the 24-hour rule applies to coordinators and volunteers) | always | `addressAccess` in `src/lib/services/pickups.ts` |
| Overdue flag: how late a pickup can be before coordinators are alerted | 2 hours after the window | `PICKUP_OVERDUE_HOURS` |
| At-risk alert: how close to its needed-by date an unfilled request is flagged | 2 days | `REQUEST_RISK_DAYS` |
| Request expiry | 7 days after the needed-by date | `EXPIRE_AFTER_DAYS` in `src/lib/services/sweep.ts` |
| Emergency contact | The Safety page tells volunteers to ask their coordinator for a number; OpenFrame does not store one | `SAFETY_RULES` in `src/lib/copy.ts`, or add a per-chapter field |
| Dark-hours pickups: windows run until 20:00, after sunset in winter | allowed | `WINDOW_LATEST` in `src/lib/types.ts` |
| Open pickup claims per neighbour | 3 | `MAX_OPEN_PICKUPS` in `src/lib/services/claims.ts` |

## Day-to-day

- **Requests tab:** triage daily. At-risk requests are highlighted; use **Fill from stock** when the shelf covers it. Call the partner if a request is going to miss its date.
- **Pickups board:** check **Overdue** daily. Call the assigned pair (their emails are in Volunteers), then close the pickup (collected / no-show / cancelled) with a reason.
- **Approvals:** verify new partners and workers before approving (see [PARTNER-ONBOARDING.md](PARTNER-ONBOARDING.md)). Suspend a partner from the Partners tab if their requests ever include anything identifying.
- **Concerns:** open reports are listed safety first. Set state and a resolution note. A volunteer's "safety concern" check-out cancels the pickup and files a priority report automatically.
- **Audit log** (Coordinate → Audit log): every address view with who and when. Review unexpected views.
- **Removing someone:** removing a volunteer releases their open assignments; a scheduled pickup left with fewer than two volunteers returns to "claimed".
