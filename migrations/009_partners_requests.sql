-- OpenFrame becomes a link between community partners and neighbours:
--   partners' verified frontline workers post anonymous requests; neighbours claim them; student teams collect,
--   keep a small fast stock, and deliver to the agency. The agency worker hands items to the person.
--
-- This migration REPLACES the tables of the earlier "pledges and care packages" model (need, pledge, pledge_item,
-- pickup*, inventory_ledger, package*, package_template*, concern_report). That model never launched, so no data is
-- carried over. Kept as they are: chapter, chapter_member, safety_ack, zone, audit_event and the auth tables.
-- Privacy: there is still NO table or column for the people who receive items.

-- 1. Drop the replaced tables, children first (foreign keys are enforced). Triggers go with their tables.
DROP TABLE concern_report;
DROP TABLE package_item;
DROP TABLE package;
DROP TABLE pickup_assignment;
DROP TABLE pickup_window;
DROP TABLE pickup;
DROP TABLE pledge_item;
DROP TABLE pledge;
DROP TABLE need;
DROP TABLE inventory_ledger;
DROP TABLE package_template_item;
DROP TABLE package_template;

-- 2. The item catalog gains footwear / electronics / bags categories and an optional size scheme.
--    (A CHECK constraint cannot be altered in SQLite, so the table is rebuilt; nothing references it any more.)
CREATE TABLE item_new (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('clothing','footwear','winter_gear','hygiene','menstrual','first_aid','electronics','bags','snacks_sealed','other')),
  size_scheme TEXT NOT NULL DEFAULT 'none' CHECK (size_scheme IN ('none','shoe','letter','numeric')),
  unit TEXT NOT NULL,
  new_only INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);
INSERT INTO item_new (id, slug, name, category, size_scheme, unit, new_only, active)
  SELECT id, slug, name, category, 'none', unit, new_only, active FROM item;
DROP TABLE item;
ALTER TABLE item_new RENAME TO item;

-- 3. Partners (the old partner_agency table, renamed and extended).
ALTER TABLE partner_agency RENAME TO partner;
ALTER TABLE partner DROP COLUMN accepts_packages;
ALTER TABLE partner ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','suspended'));
ALTER TABLE partner ADD COLUMN excluded_items TEXT NOT NULL DEFAULT '';   -- items they won't accept, shown to neighbours

-- Delivery sites are the agency's buildings: public names, addresses and receiving hours (not private addresses).
CREATE TABLE delivery_site (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  receiving_hours TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX delivery_site_partner ON delivery_site(partner_id);

-- agency_worker role, scoped per partner. Workers sign up, request access, and a coordinator approves.
CREATE TABLE partner_member (
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agency_worker' CHECK (role = 'agency_worker'),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
  requested_at TEXT NOT NULL,
  decided_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  decided_at TEXT,
  PRIMARY KEY (partner_id, user_id)
);
CREATE INDEX partner_member_user ON partner_member(user_id);

-- 4. Kit templates: named contents of a ready-made bag, per chapter.
CREATE TABLE kit_template (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (chapter_id, name)
);
CREATE TABLE kit_template_item (
  template_id TEXT NOT NULL REFERENCES kit_template(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (template_id, item_id, size)
);

-- 5. Requests. type 'item' = an agency worker asks for a specific item; 'kit' = N ready-made bags from a kit
--    template; 'restock' = the chapter's own request, posted automatically when fast stock drops below target.
--    Nothing here describes or identifies a recipient; the note is short and screened.
CREATE TABLE request (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  partner_id TEXT REFERENCES partner(id),
  delivery_site_id TEXT REFERENCES delivery_site(id),
  type TEXT NOT NULL CHECK (type IN ('item','kit','restock')),
  item_id TEXT REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  kit_template_id TEXT REFERENCES kit_template(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  needed_by TEXT NOT NULL,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','in_transit','delivered','confirmed','expired','cancelled')),
  filled_from_stock INTEGER NOT NULL DEFAULT 0,
  status_reason TEXT,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  delivered_at TEXT,
  confirmed_at TEXT,
  confirmed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  risk_notified_at TEXT,
  CHECK ((type = 'kit' AND kit_template_id IS NOT NULL AND item_id IS NULL) OR (type <> 'kit' AND item_id IS NOT NULL AND kit_template_id IS NULL)),
  CHECK (type = 'restock' OR (partner_id IS NOT NULL AND delivery_site_id IS NOT NULL))
);
CREATE INDEX request_chapter_status ON request(chapter_id, status);
CREATE INDEX request_partner ON request(partner_id, created_at);

-- Favourites let a worker post a common request in a tap.
CREATE TABLE request_favourite (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  delivery_site_id TEXT REFERENCES delivery_site(id) ON DELETE SET NULL,
  urgency TEXT NOT NULL DEFAULT 'normal' CHECK (urgency IN ('normal','urgent')),
  created_at TEXT NOT NULL
);
CREATE INDEX favourite_user ON request_favourite(partner_id, user_id);

-- 6. Claims: a neighbour commits to a request, or to part of its quantity.
--    claimed -> scheduled -> collected -> received, or cancelled / no_show. A claim that is still `claimed`
--    when release_at passes (48 hours by default) is released and its request reopens.
CREATE TABLE claim (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES request(id),
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  neighbour_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  method TEXT NOT NULL CHECK (method IN ('pickup','dropoff')),
  zone_id TEXT REFERENCES zone(id),
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed','scheduled','collected','received','cancelled','no_show')),
  release_at TEXT,
  received_quantity INTEGER CHECK (received_quantity IS NULL OR received_quantity >= 0),
  closed_at TEXT,                   -- collected / cancelled / no_show: starts the purge clock
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (method = 'pickup' OR (zone_id IS NOT NULL AND expected_date IS NOT NULL))
);
CREATE INDEX claim_neighbour ON claim(neighbour_id, status);
CREATE INDEX claim_request ON claim(request_id, status);
CREATE INDEX claim_chapter ON claim(chapter_id, status);

-- Private pickup details: AES-256-GCM ciphertext, set to NULL by the purge job.
CREATE TABLE pickup (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL UNIQUE REFERENCES claim(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  address_enc TEXT,
  notes_enc TEXT,
  phone_enc TEXT,
  purged_at TEXT,
  scheduled_window_id TEXT,
  overdue_notified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX pickup_chapter ON pickup(chapter_id);

CREATE TABLE pickup_window (
  id TEXT PRIMARY KEY,
  pickup_id TEXT NOT NULL REFERENCES pickup(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL
);
CREATE INDEX pickup_window_pickup ON pickup_window(pickup_id);

CREATE TABLE pickup_assignment (
  id TEXT PRIMARY KEY,
  pickup_id TEXT NOT NULL REFERENCES pickup(id) ON DELETE CASCADE,
  volunteer_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assigned_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL,
  arrived_at TEXT,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN ('collected','could_not_complete')),
  outcome_reason TEXT,
  outcome_note TEXT,
  completed_at TEXT
);
CREATE UNIQUE INDEX pickup_assignment_unique ON pickup_assignment(pickup_id, volunteer_id) WHERE volunteer_id IS NOT NULL;
CREATE INDEX pickup_assignment_volunteer ON pickup_assignment(volunteer_id);

-- 7. Fast stock: per chapter, item and size. Stock is the ledger sum, append-only, never below zero.
CREATE TABLE stock_ledger (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  item_id TEXT NOT NULL REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('received','allocated_to_request','assembled_into_kit','adjusted','discarded')),
  claim_id TEXT REFERENCES claim(id) ON DELETE SET NULL,
  request_id TEXT REFERENCES request(id) ON DELETE SET NULL,
  kit_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (delta <> 0),
  CHECK (kind <> 'received' OR delta > 0),
  CHECK (kind NOT IN ('allocated_to_request','assembled_into_kit','discarded') OR delta < 0)
);
CREATE INDEX stock_ledger_stock ON stock_ledger(chapter_id, item_id, size);
CREATE INDEX stock_ledger_request ON stock_ledger(request_id);

CREATE TRIGGER stock_no_negative BEFORE INSERT ON stock_ledger
WHEN (SELECT COALESCE(SUM(delta), 0) FROM stock_ledger WHERE chapter_id = NEW.chapter_id AND item_id = NEW.item_id AND size = NEW.size) + NEW.delta < 0
BEGIN SELECT RAISE(ABORT, 'stock_negative'); END;
CREATE TRIGGER stock_ledger_no_delete BEFORE DELETE ON stock_ledger
BEGIN SELECT RAISE(ABORT, 'stock_ledger is append-only'); END;
CREATE TRIGGER stock_ledger_no_update BEFORE UPDATE ON stock_ledger
WHEN NOT (
  OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
  AND OLD.id = NEW.id AND OLD.chapter_id = NEW.chapter_id AND OLD.item_id = NEW.item_id AND OLD.size = NEW.size AND OLD.delta = NEW.delta
  AND OLD.kind = NEW.kind AND OLD.claim_id IS NEW.claim_id AND OLD.request_id IS NEW.request_id AND OLD.kit_id IS NEW.kit_id
  AND OLD.note = NEW.note AND OLD.created_at = NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'stock_ledger is append-only'); END;

-- Restock targets: below target the system posts a chapter "restock" request automatically.
CREATE TABLE restock_target (
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  target INTEGER NOT NULL CHECK (target >= 0),
  PRIMARY KEY (chapter_id, item_id, size)
);

-- Assembled kits wait in stock until allocated to a kit request.
CREATE TABLE kit (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  template_id TEXT REFERENCES kit_template(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assembled' CHECK (status IN ('assembled','allocated')),
  request_id TEXT REFERENCES request(id),
  assembled_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assembled_at TEXT NOT NULL,
  CHECK ((status = 'assembled' AND request_id IS NULL) OR (status = 'allocated' AND request_id IS NOT NULL))
);
CREATE INDEX kit_chapter ON kit(chapter_id, status);
CREATE TABLE kit_item (
  kit_id TEXT NOT NULL REFERENCES kit(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  size TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (kit_id, item_id, size)
);

-- 8. Deliveries: a batch of requests taken to one delivery site by volunteers.
CREATE TABLE delivery (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  delivery_site_id TEXT NOT NULL REFERENCES delivery_site(id),
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','out','completed')),
  planned_for TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX delivery_chapter ON delivery(chapter_id, status);
CREATE TABLE delivery_request (
  delivery_id TEXT NOT NULL REFERENCES delivery(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL UNIQUE REFERENCES request(id),
  PRIMARY KEY (delivery_id, request_id)
);
CREATE TABLE delivery_volunteer (
  delivery_id TEXT NOT NULL REFERENCES delivery(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  assigned_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (delivery_id, user_id)
);

-- 9. Weekly shifts. A slot recurs every week (weekday 0 = Monday); volunteers sign up for dated occurrences.
CREATE TABLE shift_slot (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  needed INTEGER NOT NULL DEFAULT 2 CHECK (needed >= 1),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE shift_signup (
  slot_id TEXT NOT NULL REFERENCES shift_slot(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reminded_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (slot_id, user_id, date)
);
CREATE INDEX shift_signup_user ON shift_signup(user_id, date);
-- Exam periods and holidays: plan extra cover (a buffer for absences) on top of each slot's normal need.
CREATE TABLE shift_period (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  extra_needed INTEGER NOT NULL DEFAULT 1 CHECK (extra_needed >= 0),
  created_at TEXT NOT NULL
);

-- 10. Concern reports between a neighbour and the volunteers on a pickup. Coordinators triage them.
CREATE TABLE concern_report (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  claim_id TEXT REFERENCES claim(id) ON DELETE SET NULL,
  reporter_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('neighbour','volunteer')),
  category TEXT NOT NULL CHECK (category IN ('safety','conduct','no_show','other')),
  details TEXT NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','investigating','resolved','dismissed')),
  resolution_note TEXT,
  handled_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX concern_chapter_state ON concern_report(chapter_id, state, priority);
