import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ChoiceDemo } from "./choice-demo";
import {
  ActionBar, Avatar, Badge, Button, Card, CardTitle, Cluster, DeliveredState, EmptyState, Field, ICON_NAMES, Icon, Input, Notice, ProgressBar, Select,
  Stack, Stat, Stats, StatusPill, STATUSES, STATUS_KEYS, Tabs, Textarea, type StatusKey,
} from "@/components/ui";

export const metadata: Metadata = {
  title: "Style guide",
  description: "OpenFrame design tokens and UI primitives, shown in light and dark.",
  robots: { index: false, follow: false },
};

/** Renders the same content in a light and a dark theme panel (scoped via data-theme), side by side on wide screens. */
function ThemePair({ children }: { children: ReactNode }) {
  return (
    <div className="sg-pair">
      {(["light", "dark"] as const).map((t) => (
        <div key={t} className="sg-panel" data-theme={t}>
          <span className="sg-theme-tag">{t} theme</span>
          {children}
        </div>
      ))}
    </div>
  );
}

const var_ = (name: string) => `var(${name})`;
const FILLS: Array<[string, string]> = [
  ["--color-bg", "--color-text"], ["--color-bg-sunken", "--color-text"], ["--color-surface", "--color-text"], ["--color-surface-raised", "--color-text"],
  ["--color-accent", "--color-on-accent"], ["--color-accent-soft", "--color-accent-text"], ["--color-highlight", "--color-on-highlight"],
  ["--color-highlight-soft", "--color-highlight-text"], ["--color-danger", "--color-on-danger"],
];
const TEXTS = ["--color-text", "--color-text-muted", "--color-accent-text", "--color-link", "--color-highlight-text"];

function Swatches() {
  return (
    <>
      <ul className="sg-swatches" aria-label="Colour tokens">
        {FILLS.map(([bg, fg]) => (
          <li key={bg}>
            <span className="sg-chip" style={{ background: var_(bg), color: var_(fg) }}>Aa</span>
            <code>{bg}</code>
          </li>
        ))}
        {TEXTS.map((t) => (
          <li key={t}>
            <span className="sg-chip" style={{ background: "var(--color-bg)", color: var_(t) }}>Text</span>
            <code>{t}</code>
          </li>
        ))}
        {["--color-border", "--color-border-strong"].map((t) => (
          <li key={t}>
            <span className="sg-chip" style={{ background: "var(--color-surface)", borderColor: var_(t), borderWidth: 3 }}>Line</span>
            <code>{t}</code>
          </li>
        ))}
      </ul>
      <h4>Status</h4>
      <ul className="sg-swatches" aria-label="Status tokens">
        {STATUS_KEYS.map((k) => {
          const key = k === "in-transit" ? "transit" : k;
          return (
            <li key={k}>
              <span className="sg-chip" style={{ background: `var(--status-${key}-bg)`, color: `var(--status-${key}-fg)`, borderColor: `var(--status-${key}-border)` }}>{STATUSES[k].label}</span>
              <span className="sg-chip" style={{ background: `var(--status-${key}-solid)`, borderColor: "transparent" }} aria-hidden="true" />
              <code>--status-{key}-*</code>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const SCALE: Array<[string, string]> = [["--text-4xl", "Display"], ["--text-3xl", "Heading"], ["--text-2xl", "Section"], ["--text-xl", "Card title"], ["--text-lg", "Lead"], ["--text-base", "Body text is comfortable to read"], ["--text-sm", "Small and supporting text"], ["--text-xs", "Caption and labels"]];

/** One request card per status. The status is always stated in text (pill) as well as colour (rail). */
function RequestCard({ status }: { status: StatusKey }) {
  const needed = 4;
  const seg = {
    urgent: [],
    open: [{ tone: "claimed" as const, value: 1, label: "claimed" }],
    claimed: [{ tone: "claimed" as const, value: 4, label: "claimed" }],
    "in-transit": [{ tone: "transit" as const, value: 4, label: "in transit" }],
    delivered: [{ tone: "delivered" as const, value: 4, label: "delivered" }],
    overdue: [{ tone: "claimed" as const, value: 2, label: "claimed" }],
  }[status];
  const due = status === "overdue" ? "Was needed by Tue" : "Needed by Fri";
  const action = {
    urgent: <Button icon="heart">Claim this request</Button>,
    open: <Button icon="heart">Help with this</Button>,
    claimed: <Button variant="secondary" icon="truck">Mark in transit</Button>,
    "in-transit": <Button icon="check">Mark delivered</Button>,
    delivered: null,
    overdue: <Button variant="secondary" icon="users">Contact volunteer</Button>,
  }[status];
  return (
    <Card as="article" status={status} aria-label={`Request, ${STATUSES[status].label}`}>
      <Stack gap={3}>
        <Cluster justify="between" gap={2}>
          <StatusPill status={status} />
          {status === "urgent" && <Badge tone="danger" icon="clock">Needed within 48 hours</Badge>}
        </Cluster>
        <div>
          <CardTitle>Winter boots, men’s size 11</CardTitle>
          <ul className="sg-request-meta">
            <li><Icon name="clock" /> {due}</li>
            <li><Icon name="home" /> Ark Aid</li>
            <li><Icon name="pin" /> London</li>
          </ul>
        </div>
        {status === "delivered" ? (
          <DeliveredState title="Delivered. Thank you!">Ark Aid has the boots. Someone will be warmer this winter because of you.</DeliveredState>
        ) : (
          <ProgressBar label="Pairs needed" max={needed} segments={seg} size="sm" />
        )}
        {status === "claimed" && (
          <Cluster gap={2}><Avatar name="Priya Nair" size="sm" decorative /><span className="small">Claimed by Priya Nair</span></Cluster>
        )}
        {action}
      </Stack>
    </Card>
  );
}

export default function StyleGuide() {
  return (
    <div className="sg">
      <p className="eyebrow">Design system</p>
      <h1>Style guide</h1>
      <p className="muted">Every token and primitive, in the light and dark themes. Keep this page open when building or migrating a page. Rules and rationale live in <code>docs/DESIGN.md</code>.</p>
      <nav aria-label="Sections">
        <ul className="sg-anchor-nav">
          {[["colour", "Colour"], ["type", "Type"], ["space", "Space and shape"], ["buttons", "Buttons"], ["forms", "Forms"], ["status", "Status and badges"], ["requests", "Request cards"], ["impact", "Impact and progress"], ["feedback", "Notices"], ["navigation", "Tabs and shell"], ["states", "Empty and delivered"], ["people", "Avatars, layout, icons"]].map(([id, label]) => (
            <li key={id}><a href={`#${id}`}>{label}</a></li>
          ))}
        </ul>
      </nav>

      <section id="colour" aria-labelledby="colour-h">
        <h2 id="colour-h">Colour</h2>
        <p className="muted">Evergreen &amp; Amber. Always use semantic tokens (<code>--color-*</code>, <code>--status-*</code>), never raw hex.</p>
        <ThemePair><Swatches /></ThemePair>
      </section>

      <section id="type" aria-labelledby="type-h">
        <h2 id="type-h">Type</h2>
        <p className="muted">Fraunces for headings (<code>--font-display</code>), Figtree for everything else (<code>--font-body</code>). Figures are tabular wherever they are compared.</p>
        <ThemePair>
          <div className="sg-scale">
            {SCALE.map(([token, sample], i) => (
              <p key={token} style={{ fontSize: var_(token), fontFamily: i < 4 ? "var(--font-display)" : undefined, fontWeight: i < 4 ? 600 : undefined, lineHeight: 1.2 }}>
                {sample} <code>{token}</code>
              </p>
            ))}
            <p className="num">Tabular numbers line up: 1,111 · 2,222 · 9,876 · 0123456789</p>
            <p><a href="#type">A link inside running text</a> keeps its underline.</p>
          </div>
        </ThemePair>
      </section>

      <section id="space" aria-labelledby="space-h">
        <h2 id="space-h">Space and shape</h2>
        <ThemePair>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <div className="sg-space" key={n}><code>--space-{n}</code><i style={{ width: `var(--space-${n})` }} /></div>
          ))}
          <h4>Radius</h4>
          <div className="sg-radius">
            {["sm", "md", "lg", "xl"].map((r) => <div key={r} style={{ borderRadius: `var(--radius-${r})` }}>{r}</div>)}
          </div>
          <h4>Shadow</h4>
          <div className="sg-shadows">
            {["sm", "md", "pop"].map((s) => <div key={s} style={{ boxShadow: `var(--shadow-${s})` }}>{s}</div>)}
          </div>
          <p className="small muted">Motion: <code>--dur-fast</code> 120ms · <code>--dur</code> 200ms · <code>--dur-slow</code> 420ms · <code>--ease</code>. All animation stops under <code>prefers-reduced-motion</code>.</p>
        </ThemePair>
      </section>

      <section id="buttons" aria-labelledby="buttons-h">
        <h2 id="buttons-h">Buttons</h2>
        <ThemePair>
          <Stack gap={4}>
            <Cluster><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button></Cluster>
            <Cluster><Button size="sm">Small</Button><Button>Medium</Button><Button size="lg">Large</Button></Cluster>
            <Cluster><Button icon="heart">With icon</Button><Button loading>Saving</Button><Button disabled>Disabled</Button><Button href="#buttons" variant="secondary" icon="arrow-right">Link button</Button></Cluster>
            <Button block icon="check">Full width (for phones)</Button>
          </Stack>
        </ThemePair>
      </section>

      <section id="forms" aria-labelledby="forms-h">
        <h2 id="forms-h">Forms</h2>
        <ThemePair>
          <Field label="What is needed?" hint="Be specific so a neighbour can find the right size." required>
            <Input name="item" defaultValue="Winter boots, men’s size 11" />
          </Field>
          <Field label="Delivery area">
            <Select name="area" defaultValue="london">
              <option value="london">London, Ontario</option>
              <option value="oshawa">Oshawa, Ontario</option>
            </Select>
          </Field>
          <Field label="Notes for the volunteer" error="Please add a note, even a short one." required>
            <Textarea name="notes" defaultValue="" />
          </Field>
          <ChoiceDemo />
        </ThemePair>
      </section>

      <section id="status" aria-labelledby="status-h">
        <h2 id="status-h">Status and badges</h2>
        <p className="muted">Each status has its own hue, icon and word. Never rely on colour alone.</p>
        <ThemePair>
          <Cluster>{STATUS_KEYS.map((k) => <StatusPill key={k} status={k} />)}</Cluster>
          <h4>Badges</h4>
          <Cluster>
            <Badge>Neutral</Badge><Badge tone="accent" icon="users">Student team</Badge><Badge tone="info">Info</Badge><Badge tone="success">Verified</Badge><Badge tone="warning">Demo</Badge><Badge tone="danger">Needs attention</Badge>
          </Cluster>
        </ThemePair>
      </section>

      <section id="requests" aria-labelledby="requests-h">
        <h2 id="requests-h">Request cards</h2>
        <p className="muted">A composed example (not a primitive): Card + StatusPill + ProgressBar + Button, one per status.</p>
        <ThemePair>
          <Stack gap={4}>{STATUS_KEYS.map((k) => <RequestCard key={k} status={k} />)}</Stack>
        </ThemePair>
      </section>

      <section id="impact" aria-labelledby="impact-h">
        <h2 id="impact-h">Impact and progress</h2>
        <ThemePair>
          <Stats label="Community impact this winter">
            <Stat tone="accent" icon="box" value="128" label="Items delivered" hint="since October" />
            <Stat icon="users" value="34" label="Neighbours giving" />
            <Stat icon="home" value="9" label="Partner agencies" />
            <Stat icon="clock" value="212" label="Volunteer hours" />
          </Stats>
          <Stack gap={4}>
            <ProgressBar label="Winter coat drive" max={120} segments={[{ tone: "delivered", value: 64, label: "delivered" }, { tone: "claimed", value: 22, label: "claimed" }]} />
            <ProgressBar label="Profile complete" max={5} value={3} />
          </Stack>
        </ThemePair>
      </section>

      <section id="feedback" aria-labelledby="feedback-h">
        <h2 id="feedback-h">Notices</h2>
        <ThemePair>
          <Notice title="Heads up">Pickups at Ark Aid are Tuesday to Friday, 10 to 4.</Notice>
          <Notice tone="success" title="Request posted">Neighbours near you have been told.</Notice>
          <Notice tone="warning" title="Running low">Only two volunteer slots are left this week.</Notice>
          <Notice tone="danger" title="Could not save">Check your connection and try again.</Notice>
          <div className="notice good">Legacy markup (<code>.notice.good</code>) gets the same look.</div>
        </ThemePair>
      </section>

      <section id="navigation" aria-labelledby="navigation-h">
        <h2 id="navigation-h">Tabs and shell</h2>
        <ThemePair>
          <Tabs label="Request views" tabs={[
            { id: "open", label: "Open", count: 6, content: <p>Six requests are waiting for a neighbour.</p> },
            { id: "mine", label: "Claimed by me", count: 2, content: <p>You have two deliveries coming up.</p> },
            { id: "done", label: "Delivered", count: 41, content: <p>Forty-one deliveries so far. Thank you.</p> },
          ]} />
          <h4>Link tabs (separate pages)</h4>
          <nav className="tabs" aria-label="Moderation sections">
            <a href="#navigation" aria-current="page">Queue</a><a href="#navigation">Reports</a><a href="#navigation">History</a>
          </nav>
          <h4>Chapter switcher slot</h4>
          <label className="chapter-switch">
            <Icon name="pin" />
            <span className="sr-only">Chapter</span>
            <select defaultValue="london"><option value="london">London</option><option value="oshawa">Oshawa</option></select>
          </label>
          <h4>Sticky action area</h4>
          <p className="small muted">On phones, <code>ActionBar</code> sticks to the bottom of the screen. Shown static here.</p>
          <ActionBar sticky={false} label="Example actions"><Button icon="heart">Claim</Button><Button variant="secondary">Not now</Button></ActionBar>
        </ThemePair>
      </section>

      <section id="states" aria-labelledby="states-h">
        <h2 id="states-h">Empty and delivered</h2>
        <ThemePair>
          <Stack gap={4}>
            <EmptyState icon="box" title="Nothing needed right now" action={<Button variant="secondary" icon="heart">Tell me when something is posted</Button>}>
              When a partner agency posts a request, it will show up here.
            </EmptyState>
            <EmptyState icon="truck" title="No deliveries today">Enjoy the quiet. Your next claimed item will appear here.</EmptyState>
            <DeliveredState title="Delivered. Thank you!">The boots reached Ark Aid this afternoon. That made a real difference.</DeliveredState>
          </Stack>
        </ThemePair>
      </section>

      <section id="people" aria-labelledby="people-h">
        <h2 id="people-h">Avatars, layout, icons</h2>
        <ThemePair>
          <Cluster>
            {["Priya Nair", "Marcus Webb", "Aisha Khan", "Jordan Lee", "Sam O’Brien", "Léa Tremblay"].map((n) => <Avatar key={n} name={n} />)}
            <Avatar name="Priya Nair" size="sm" /><Avatar name="Marcus Webb" size="lg" />
          </Cluster>
          <h4>Icons</h4>
          <ul className="sg-icons">
            {ICON_NAMES.map((n) => <li key={n}><Icon name={n} /><code>{n}</code></li>)}
          </ul>
          <h4>Stack and Cluster</h4>
          <Stack gap={2}><Card padding="sm">Stack gap 2</Card><Card padding="sm" tone="soft">Items separated by tokens</Card></Stack>
        </ThemePair>
      </section>
    </div>
  );
}
