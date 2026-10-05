# OpenFrame design system

OpenFrame is a warm, trustworthy, local community service run by students. It connects partner agencies
(shelters, outreach teams), neighbours who donate, and student volunteer teams. The interface should feel like a
well-run neighbourhood organisation: human, hopeful, calm. It should not feel like an academic tool, a corporate
charity, a SaaS dashboard or a generic AI-made site.

Live reference: **`/styleguide`** shows every token and primitive in light and dark, side by side. Keep it open
while you work. Everything below is implemented in `src/app/globals.css` and `src/components/ui/`.

## 1. Palette

Three directions were considered. All three use the same warm paper and ink; they differ in the one confident accent.

| | A. Evergreen & Amber (**chosen**) | B. Terracotta & Dark Teal | C. Plum & Marigold |
|---|---|---|---|
| Paper | `#faf6ee` | `#fbf5ee` | `#faf6f0` |
| Ink | `#2b2218` | `#2d2420` | `#2a2230` |
| Accent | evergreen `#1f5c46` | terracotta `#b4502f` | plum `#6a2f63` |
| Highlight | amber `#e9a23b` | dark teal `#1d5560` | marigold `#e8b020` |
| Feels | growth, shelter, calm, "garden and hearth" | earthy, hearty, craft | distinctive, celebratory |
| Risk | green is common in "eco" brands; we avoid that by pairing it with amber and a serif | the accent sits close to the "urgent" red-orange, which would blur the status colours | strong identity, but reads less "neighbourly" and plum buttons feel formal |

**Why A.** Evergreen reads as trustworthy and local without being corporate blue, and it keeps the whole red/orange
range free for **urgent** and **overdue**, which matters because status colours must stay unmistakable. Amber is the
"light in the window": used sparingly for hope (hero sun, selection, highlights), never for body text. The paper
background has a subtle warm tint (not white), and text is a deep warm brown-black rather than pure black.

### Status colours

Six statuses, each with a distinct hue, a distinct icon and a word. Colour is never the only signal.

| Status | Hue | Icon | Used for |
|---|---|---|---|
| `urgent` | brick red | alert | needed soon, needs attention now |
| `open` | ocean blue | box | posted, waiting for a neighbour or team |
| `claimed` | amber | heart | someone has taken it on |
| `in-transit` | violet | truck | on its way |
| `delivered` | green | check | arrived (the rewarding state) |
| `overdue` | wine, **solid fill** | clock | past its date; the only status with an inverted pill so it cannot be confused with `urgent` |

Each status has four tokens: `--status-<name>-fg` (text), `-bg` (soft fill), `-border`, `-solid` (bars, dots, rails).
The in-transit tokens are named `--status-transit-*`.

### Accessibility (WCAG AA)

Verified against the actual CSS values for **both themes**: 76 foreground/background pairs each (body and muted text
on every surface, button text, accent/link text, every status fg on its bg, avatar pairs, highlight pairs) all meet
4.5:1; non-text UI (input borders, focus ring, status bars and dots against the page and surfaces) all meet 3:1.
The tightest text pair is muted text on the soft accent tint at about 5.8:1. If you add or change a colour token, re-run the check:
parse the three token blocks in `globals.css` and assert the pairs above (the two dark blocks must also stay
identical, see "Dark mode"). `npm run e2e` additionally runs axe (WCAG 2.0, 2.1, 2.2 A/AA) on `/styleguide`
in both themes.

## 2. Type

**Fraunces** (headings) + **Figtree** (body, UI, numbers), both loaded with `next/font/google` in `layout.tsx`.
Next downloads and self-hosts them at build time, so the CSP stays `font-src 'self' data:` with no change to
`next.config.ts`, and there is no runtime request to Google.

- **Fraunces** is a "soft", slightly wonky old-style serif with optical sizing. It gives the product a human,
  handmade voice (closer to a community newsletter than a tech product) and stays legible at card-title size.
  It is used for `h1`-`h3`, the wordmark, card titles, empty-state titles. We load the `opsz` and `SOFT` axes only.
- **Figtree** is a geometric-humanist sans designed for legibility: open apertures, generous x-height, clear
  numerals, friendly without being childish. It carries all body copy, forms, buttons and statistics. It has
  tabular figures, so counts and stats line up (`font-variant-numeric: tabular-nums` on `.num`, `.stat-value`,
  tables, course counts).
- Body is 17px (`--text-base`) at 1.6 line height. Form controls are never below 16px (prevents iOS zoom).

Tokens: `--font-display`, `--font-body`, `--font-mono` (code only). Scale: `--text-xs` 13px, `-sm` 15px, `-base` 17px,
`-lg` 19px, `-xl` 22px, `-2xl` 24-28px, `-3xl` 28-36px, `-4xl` 34-52px (the last three are fluid `clamp()`).

## 3. Token reference

Defined in `globals.css`. **Always use semantic tokens, never hex.**

| Group | Tokens |
|---|---|
| Surfaces | `--color-bg` (page), `--color-bg-sunken` (recessed bands, table heads), `--color-surface` (cards), `--color-surface-raised` (menus, dialogs), `--color-field` (inputs) |
| Text | `--color-text`, `--color-text-muted` (secondary; still AA) |
| Lines | `--color-border` (decorative hairlines), `--color-border-strong` (control edges, 3:1) |
| Accent | `--color-accent`, `--color-accent-hover`, `--color-on-accent`, `--color-accent-soft`, `--color-accent-text` (accent as text on page/soft backgrounds), `--color-link`, `--color-focus` |
| Highlight | `--color-highlight`, `--color-highlight-soft`, `--color-on-highlight`, `--color-highlight-text` |
| Danger (buttons) | `--color-danger`, `--color-danger-hover`, `--color-on-danger` |
| Status | `--status-{urgent,open,claimed,transit,delivered,overdue}-{fg,bg,border,solid}`, `--status-delivered-on` |
| Avatars | `--avatar-1..6-{bg,fg}` |
| Spacing | `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64px (8px rhythm; use 12 sparingly) |
| Radius | `--radius-sm` 8, `-md` 10 (buttons, inputs), `-lg` 14 (cards), `-xl` 20 (hero, dialogs, empty states), `--radius-pill` |
| Shadow | `--shadow-sm` (cards), `--shadow-md` (hover), `--shadow-pop` (menus, dialogs) |
| Layout | `--max` 66rem, `--measure` 42rem (reading width), `--gutter` (16-32px), `--tap` 44px |
| Motion | `--dur-fast` 120ms, `--dur` 200ms, `--dur-slow` 420ms, `--ease` |
| Type | see section 2 |

**Legacy aliases** (`--bg`, `--surface`, `--surface-2`, `--text`, `--muted`, `--border`, `--border-strong`, `--link`,
`--primary`, `--primary-hover`, `--on-primary`, `--header-bg`, `--header-text`, `--good*`, `--bad*`, `--warn*`,
`--info-*`, `--radius`, `--mono`) are kept and mapped onto the new tokens so nothing breaks. Do not use them in new
code; remove them once no page references them.

### Dark mode

Tokens are **redefined** under `@media (prefers-color-scheme: dark)`, there is no second stylesheet. The same dark
set is repeated under `[data-theme="dark"]` so `/styleguide` can render light and dark panels together
(`[data-theme="light"]` forces light inside a dark OS). **If you edit a dark token, edit it in both dark blocks.**
Dark accent buttons are light green with dark text (not dark green), and shadows are replaced by deeper, flatter ones.

## 4. Primitives

All in `src/components/ui/` (import from `@/components/ui`). Small, typed, built on semantic HTML. Their class names
(`.btn`, `.notice`, `.badge`, `.card`, `.tabs`, ...) are the same ones existing pages already use, so hand-written
markup and primitives look identical.

| Primitive | Use it for | Notes |
|---|---|---|
| `Button` | any action (`<button>`), or navigation that should look like an action (`href` renders a `Link`) | variants `primary` (one per view), `secondary`, `ghost`, `danger`; sizes `sm` / `md` / `lg` (all >= 44px tall); `block` for full width; `icon`; `loading` keeps focus (`aria-disabled`, `aria-busy`) and ignores clicks |
| `ActionBar` | the single primary action of a page on phones | sticky at the bottom (safe-area aware) under 48rem, an inline row above. Put it last in the page. `sticky={false}` for demos |
| `Card`, `CardTitle` | one unit of content (a request, a listing) | `tone` default / soft / accent / outline; `padding`; `interactive` (hover lift) only if the whole card is one link target; `status` draws a coloured left rail (always pair with `StatusPill`) |
| `StatusPill` | the state of a request or delivery | one per status, icon + word |
| `Badge` | small labels: category, "Demo", "Student team" | tones neutral / accent / info / success / warning / danger. Not for request status |
| `Field` + `Input` / `Select` / `Textarea` | every form control | `Field` supplies label, hint, error, `required`, and wires `for`, `aria-describedby`, `aria-invalid` automatically |
| `ProgressBar` | needed / claimed / delivered, and any "x of y" | stacked `segments`, always has `role="progressbar"`, an accessible name, value text and a visible legend |
| `Stat`, `Stats` | impact numbers | big tabular figure + label; wrap several in `Stats` (grid, labelled group) |
| `Tabs` | switching panels on one page | full WAI-ARIA tabs (arrows, Home, End). For tabs that are separate URLs use `<nav class="tabs">` with `aria-current="page"` links |
| `Notice` | inline messages | tones info / success / warning / danger; `live="polite"` or `"assertive"` only for messages that appear after an action |
| `EmptyState` | lists with nothing in them | icon, one sentence, one clear next action |
| `DeliveredState` | the reward moment when something is delivered | animated check, short warm line; animation off under reduced motion |
| `Avatar` | a person or team | initials, tint derived from the name; `decorative` when the name is written next to it |
| `Icon` | all icons | `box truck home pin clock check alert heart users menu close info arrow-right`; decorative by default, pass `title` to name it |
| `Stack`, `Cluster` | layout | `Stack` = vertical rhythm, `Cluster` = wrapping row; `gap` 1-6 maps to `--space-*`; `as="ul"` for real lists |
| `SiteMenu`, `NavLink`, `BrandMark` | the shell (`layout.tsx`) | `SiteMenu` is a disclosure button (`aria-expanded`, `aria-controls`, Esc closes); without JS the links render open in the page flow |

### Shell (`layout.tsx`)

Skip link, demo banner and site notice stay. Header = wordmark + **chapter-switcher slot** + menu. Set the
`chapterSwitcher` constant in `layout.tsx` to a node (for example a `<label className="chapter-switch">` with a
`<select>`, see the styleguide) and it appears between wordmark and menu. Footer = About, Safety, Privacy,
Guidelines (plus two minor links to pages that still exist).

### Utility classes

`.measure`, `.measure-sm` (reading widths), `.mt-0/2/3/4/5/6`, `.mb-0`, `.grow`, `.input-xs`, `.input-sm`,
`textarea.textarea-sm`. These exist only to replace inline `style` props. Prefer a primitive or a token first.

## 5. Do and don't

**Do**
- Use semantic tokens, the spacing scale and the radius scale. Think in an 8px rhythm.
- Say the status in words and an icon, then colour it. Every status pill has both.
- Keep tap targets at least 44px (`--tap`). Buttons, nav links, inputs, tabs, radio and checkbox rows already are.
- Put the one primary action of a mobile page in an `ActionBar`.
- Give every empty list an `EmptyState` with a next step, and celebrate a delivery with `DeliveredState`.
- Keep copy short and warm: "Thank you", "Someone will be warmer this winter", not "Operation successful".
- Use `Field` for every control so labels, hints and errors are always connected.
- Use `Stat` for numbers people compare; figures are tabular.

**Don't**
- Don't hard-code hex, px spacing or `rgba()` colours in components or inline styles.
- Don't use colour alone for meaning (urgent vs open, correct vs incorrect, required fields).
- Don't use amber/`--color-highlight` for text on paper (use `--color-highlight-text`), or `--color-accent` as text colour (use `--color-accent-text`).
- Don't stack heavy shadows, gradients or glass. One soft shadow on cards; the hero's single "sun" is the only decoration.
- Don't use more than one primary button per view, or put `danger` next to `primary` without a `secondary` between.
- Don't add `role="alert"` to static notices; reserve `live` for messages that appear after an action.
- Don't animate without a reduced-motion fallback. The global rule already disables transitions and animations; use `from`-only keyframes so the resting state is the finished state.
- Don't add an icon font, an icon package or a UI library. Add the path to `icons.tsx` instead.
- Don't use academic-looking mono eyebrows, hairline-only boxes or the old blue-grey palette.

## 6. Migrating a page

1. **Delete page-level colours.** Replace any `var(--primary)`, `var(--muted)`, `var(--surface-2)` etc. with the new semantic names (`--color-accent`, `--color-text-muted`, `--color-bg-sunken`).
2. **Replace inline `style={{…}}`:**
   - `maxWidth: "44rem"` etc. on a page wrapper -> `className="measure"` (or `measure-sm`).
   - `marginTop: 0` on a heading in a card/dialog -> `className="mt-0"`; other margins -> `mt-*` or wrap in `Stack gap={…}`.
   - `minHeight` on a textarea -> `<Textarea rows={…}>` or `className="textarea-sm"`.
   - `maxWidth` on an input -> `input-xs` / `input-sm`.
   - `fontSize`/`padding` on a button -> `<Button size="lg">`.
   - `style={{ flex: 1 }}` spacers -> `className="grow"`.
   - Keep inline style only for genuinely dynamic values (none should remain except data-driven widths; prefer `ProgressBar`, which owns that).
3. **Swap hand-rolled markup for primitives:** button/link buttons -> `Button`; `<div class="notice …">` -> `Notice`; label+input+error triplets -> `Field`; `.progress` -> `ProgressBar`; `.stat` blocks -> `Stat`; "no results" paragraphs -> `EmptyState`.
4. **Status:** anything that shows a request or delivery state uses `StatusPill` (and `Card status=…` for the rail).
5. **Mobile:** open the page at 375px. One primary action? Move it into `ActionBar`. Nothing under 44px? No horizontal scroll?
6. **Both themes:** view in light and dark (browser dev tools "emulate prefers-color-scheme"), or compare with `/styleguide`.
7. **Empty / loading / error / delivered:** give each state a designed treatment (`EmptyState`, `Button loading`, `Notice tone="danger"`, `DeliveredState`).
8. **Run** `npm run check` and `npm run e2e` (axe must stay at zero violations; `/styleguide` is part of the scan).

## 7. Known follow-ups for the pages

Inline `style` props and legacy markup that still exist at the time of writing (the restructure will replace most of
these pages; port the pattern, not the file):

- `maxWidth` wrappers: `about`, `guidelines`, `academic-integrity`, `privacy`, `content-removal`, `auth/sign-in`, `course-notes`.
- `GoogleButton` (`AuthForms.tsx`): inline `fontSize`/`padding` -> `<Button size="lg">`. `SignOutButton` uses `.link-btn` (restyled, 44px).
- `SessionPlayer.tsx`: `.progress > span` with inline width -> `ProgressBar`; the timer `badge` with inline `fontSize`; several `margin`/`flex` inline styles; `.qnav` and `.option` already inherit the new look.
- `ContributionEditor.tsx`, `ModerationPanels.tsx`, `CourseRequestForm.tsx`, `SetupForm.tsx`: label/control pairs -> `Field`; textarea `minHeight`; the sticky preview card uses inline `position: sticky`.
- `Dialog.tsx`: inline `marginTop: 0` on its `h2`.
- `ContributionEditor.tsx` uses a `preview-hidden` class that has no CSS rule (pre-existing).
- Home and university pages: `style={{ marginTop: "2rem" }}` on `<details>`.
- The footer links to `/safety`, a route owned by the restructure; `prefetch={false}` on the Safety link can be removed once `/safety` exists.
