// User-facing text kept in one place so wording stays consistent. The Safety, insurance and partner wording is
// the project's proposal, not legal advice: the owner should review it (see docs/SAFETY-OPERATIONS.md).

export const SITE_NOTICE =
  "OpenFrame is an independent, student-run project. It is not affiliated with or endorsed by any university, and it is not a registered charity.";

/** Shown inline wherever someone pledges items. */
export const ACCEPTED = [
  "New socks and new underwear, in their packaging",
  "New hygiene items: toothbrushes, toothpaste, soap, deodorant, wipes",
  "Sealed, in-date snacks that need no cooking or refrigeration",
  "Clean winter outerwear in good condition: coats, toques, gloves, scarves",
  "New menstrual products and basic first-aid supplies (bandages, wipes)",
];
export const NOT_ACCEPTED = [
  "Used bedding or blankets (new ones only)",
  "Opened or homemade food, or anything that needs refrigeration",
  "Medication of any kind, prescription or over-the-counter",
  "Anything not on the list of current needs: we cannot store or use it",
  "Used underwear or socks, or damaged or dirty clothing",
];
export const NEW_ONLY_NOTE = "Items marked “new only” must be new and unopened. Clean, good-condition second-hand items are fine only where an item says so.";

export const DROPOFF_NOTE = "Drop-off zones are public places, such as a campus front desk. We never ask you to leave items anywhere private.";
export const PICKUP_NOTE =
  "Pickup: two volunteers come together, in daytime, and collect the items at your door. They will not come inside. Your address is encrypted, shown only to you, your chapter's coordinators and the two assigned volunteers (from 24 hours before the window), and erased after the pickup.";

export const SAFETY_RULES: { title: string; body: string }[] = [
  { title: "Always in pairs", body: "Every pickup has two volunteers. A pickup cannot be scheduled until two are assigned, and you can only check in once both are assigned. Arrive together or meet before you go. Never do a pickup alone." },
  { title: "Daytime only", body: "Pickup windows are between 9:00 a.m. and 8:00 p.m. local time. Stay within the window you were given. If it is getting dark or you do not feel comfortable, reschedule instead of going." },
  { title: "Doorstep handoff", body: "Do not go inside anyone's home, car or room. Take the items at the door, the lobby or the curb. If you are invited inside, politely say no. If someone insists, leave." },
  { title: "Know your emergency contact", body: "In an emergency, call 911 first. Then tell your chapter coordinator. Before your first pickup, ask your coordinator for the number to call if something goes wrong, and save it in your phone. Keep your phone charged and with you." },
  { title: "Leave whenever you feel unsafe", body: "You never need to justify leaving. Walk away, then tap “Couldn’t complete” and choose “I had a safety concern”. That cancels the pickup and sends a priority report to your coordinators." },
  { title: "Only collect what is on the list", body: "Decline medication, sharp objects, alcohol, cash, or anything that looks unsafe or unwell-kept. Do not accept payment or gifts." },
  { title: "Protect privacy", body: "The address is shown to you only from 24 hours before the window and is erased after the pickup. Do not copy, photograph or share it. Do not take photos of donors or their homes, and never record anything about the people who receive packages: we do not keep that information at all." },
  { title: "Report any concern", body: "Use “Report a concern” on the pickup in My pickups, or ask your coordinator. Reports go to your chapter’s coordinators. If anything happened that you are not sure how to describe, report it anyway." },
];

export const DONOR_SAFETY = [
  "Two volunteers come together, in daytime, within the window you choose (9:00 a.m. to 8:00 p.m.).",
  "They will not come inside. Please hand items over at the door.",
  "Your address, notes and phone number are encrypted, shown only to you, your chapter’s coordinators and the two assigned volunteers (from 24 hours before your window), and erased 7 days after the pickup.",
  "If a volunteer makes you uncomfortable, report a concern from My pledges. Coordinators review every report.",
];

// To be confirmed by the project owner before launch.
export const INSURANCE_NOTICE =
  "OpenFrame is an independent, student-run project. It does not provide insurance for volunteers or donors, and volunteering through OpenFrame is not an activity of any university. Volunteers take part at their own discretion. Chapters should confirm with their own campus group whether any coverage applies before running pickups.";
export const PARTNER_NOTICE =
  "Packages are handed to partner agencies, which are independent organisations that serve people directly. Being listed on OpenFrame is not an endorsement or a formal partnership, and OpenFrame does not direct an agency’s services. We record only which agency received a package and when.";
