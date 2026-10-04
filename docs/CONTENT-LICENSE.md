# Content license (PROPOSAL — needs the owner's confirmation before real submissions open)

**Status: proposed, not confirmed.** Nothing in the app or this repository treats the terms below as final, and no "launch" setting has been changed. Do not open real submissions until the project owner has chosen and published the terms. Nothing here is legal advice.

## Proposal in one paragraph

Accepted, original, contributor-written questions (stems, options, explanations) are released under **Creative Commons Attribution 4.0 International (CC BY 4.0)**, credited to "OpenFrame contributors", or to the contributor's chosen pseudonym where they opted in to attribution. Application code stays under MIT. The bundled Western question banks are **not** covered by this proposal until the open questions below are settled.

## Code vs. content

| What | Proposed terms |
|---|---|
| **Application code** (everything in this repository except question content) | **MIT** (see `LICENSE`). |
| **Accepted original questions** contributed through the site | **CC BY 4.0** — <https://creativecommons.org/licenses/by/4.0/>. Anyone may copy, adapt and reuse them, including commercially, if they give credit. |
| **Demo seed questions** in `src/lib/seed-data.ts` | Demonstration content, licensed with the code under MIT, and never shipped in production. |
| **Bundled Western banks** in `content/western/` (300 AI-generated questions supplied by the project owner) | **Unresolved. Not covered by CC BY 4.0 for now.** See "Open question: the bundled Western banks". |

## Why CC BY 4.0

- It matches the positioning: a free, open alternative to paid exam prep. Anyone, including other student groups and instructors, can reuse the questions with credit and no friction.
- Attribution is the only condition, which is easy to meet and keeps contributors credited.
- Alternatives the owner may prefer:
  - **CC BY-SA 4.0** (the earlier proposal): derivatives must stay open. Keeps the bank open if someone republishes it, but blocks inclusion in some textbooks and platforms.
  - **CC0**: no conditions and no credit. Simplest to reuse, but contributors lose attribution.

## What contributors would be told

Proposed wording, shown in the contribution guidelines and next to the submission attestation (the About page carries a shorter summary). It is displayed as a **proposal** and is not part of the stored attestation:

> If your question is accepted, OpenFrame proposes to release it under **CC BY 4.0**, credited to “OpenFrame contributors” (or to your pseudonym if you opt in to attribution). This is not final until the project owner confirms it. A release cannot be undone for copies already shared, although OpenFrame will stop showing a question that is withdrawn. Do not submit anything you are not entitled to share under these terms.

The stored submission attestation is unchanged for now: *"This is original practice content. It is not copied, reconstructed, or adapted from an actual university assessment. I have permission to share the submitted material."* Once the owner confirms a license, consider adding the release sentence to that stored text so the exact wording each contributor agreed to is on record.

## Contributor permissions

- Every submission requires the attestation above. The text and time are stored with each submission.
- Contributors write against the public syllabus and learning outcomes. Questions derived from instructor slides, handouts, notes, recordings or exam material are not accepted without the instructor's permission (see Contribution guidelines and `CONTRIBUTING.md`). This matters for licensing: material derived from an instructor's copyrighted work is not the contributor's to license.
- Reviewers who verify a question are credited by display name on the question ("Verified by …"). That credit is separate from license attribution and is not a transfer of any rights.

## Attribution mechanics (to confirm)

CC BY needs credit that reasonable users can find. **The app does not display per-question attribution today**: the "show my pseudonym" opt-in is stored (`question.public_attribution`) but nothing renders it, there is no per-question license footer, and there is no bulk export. Proposed first step once the license is confirmed: credit "OpenFrame contributors" with a link to the license on the About page and in the site footer, then add per-question credit (and pseudonyms for those who opted in) wherever questions are shown or exported. Until then, do not tell contributors their pseudonym will appear.

## Open question: the bundled Western banks

The 300 questions in `content/western/` were supplied by the project owner as AI-generated lecture practice banks. Three things need an owner decision before any license is stated for them:

1. **Source material.** The banks were generated from course lecture materials (the importer keeps private source-page references for them). Instructor slides are usually the instructor's copyrighted work. Under the new contribution rule ("write against the public syllabus and learning outcomes, never derive from instructor materials without permission") these questions would not be accepted from a contributor without the instructor's permission. Decide whether permission exists, whether to obtain it, or whether to rework the questions against the public syllabus.
2. **Authority to license.** The owner can license what they own. If the questions reproduce or closely follow instructor material, they may not be the owner's to license.
3. **AI authorship.** Labelling a question AI-generated or AI-assisted does **not** establish who owns it or whether it can be licensed. Contributors state the facts; the owner decides how to treat AI-generated material under the chosen license, ideally with advice from someone qualified.

Until these are settled, do not describe the Western banks as CC BY 4.0. They are published as **unverified** and are not offered under any license by this repository (see `content/README.md`).

## Decisions needed from the owner

- [ ] Confirm CC BY 4.0 (or choose CC BY-SA 4.0 / CC0) for accepted contributor questions.
- [ ] Confirm the attribution form ("OpenFrame contributors" and opt-in pseudonyms).
- [ ] Confirm the contributor wording above, and whether to add the release sentence to the stored attestation.
- [ ] Decide what to do about the bundled Western banks (permission, rework, or remove from public delivery).
- [ ] Only then: open real submissions. (Nothing in this change flips that switch.)
