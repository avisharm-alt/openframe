-- Care-package network schema.
-- Privacy: there is deliberately NO table or column for the people who receive packages.
-- Packages record only a partner agency and a date. See tests/no-recipient-data.test.ts.

CREATE TABLE chapter (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  timezone TEXT NOT NULL,           -- IANA zone, e.g. America/Toronto; windows are validated in this zone
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Chapter roles. A user's global role (member | admin) lives on "user"; volunteer and coordinator are per chapter.
CREATE TABLE chapter_member (
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('volunteer','coordinator')),
  granted_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chapter_id, user_id)
);
CREATE INDEX chapter_member_user ON chapter_member(user_id);

-- Volunteers acknowledge the Safety rules before their first assignment.
CREATE TABLE safety_ack (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  acknowledged_at TEXT NOT NULL,
  PRIMARY KEY (user_id, version)
);

-- Shared item catalog.
CREATE TABLE item (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hygiene','clothing','winter_gear','menstrual','first_aid','snacks_sealed','other')),
  unit TEXT NOT NULL,
  new_only INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1
);

-- What goes in a package, per chapter, with a weekly target.
CREATE TABLE package_template (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weekly_target INTEGER NOT NULL DEFAULT 0 CHECK (weekly_target >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (chapter_id, name)
);
CREATE TABLE package_template_item (
  template_id TEXT NOT NULL REFERENCES package_template(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (template_id, item_id)
);

-- A need is either posted by a coordinator (source 'manual': quantity is a target for pledges to fill)
-- or the standing need derived from active templates (source 'template': quantity is the stock level
-- weekly_target x contents; the shortfall is that minus stock on hand and is recomputed live).
CREATE TABLE need (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  source TEXT NOT NULL CHECK (source IN ('manual','template')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','met','closed')),
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX need_chapter_status ON need(chapter_id, status);
CREATE UNIQUE INDEX need_template_unique ON need(chapter_id, item_id) WHERE source = 'template';

-- Drop-off zones: public descriptions only, never a private address.
CREATE TABLE zone (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  hours TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Partner agencies hand packages to the people they serve. We record the agency, never the recipient.
CREATE TABLE partner_agency (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  accepts_packages INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- pledged -> scheduled -> collected -> received (counted into stock) | cancelled | no_show
CREATE TABLE pledge (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  donor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  method TEXT NOT NULL CHECK (method IN ('pickup','dropoff')),
  zone_id TEXT REFERENCES zone(id),
  expected_date TEXT,
  status TEXT NOT NULL DEFAULT 'pledged' CHECK (status IN ('pledged','scheduled','collected','received','cancelled','no_show')),
  closed_at TEXT,                   -- set when the pledge reaches collected / cancelled / no_show; starts the purge clock
  status_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (method = 'pickup' OR (zone_id IS NOT NULL AND expected_date IS NOT NULL))
);
CREATE INDEX pledge_donor ON pledge(donor_id, status);
CREATE INDEX pledge_chapter ON pledge(chapter_id, status);

CREATE TABLE pledge_item (
  id TEXT PRIMARY KEY,
  pledge_id TEXT NOT NULL REFERENCES pledge(id) ON DELETE CASCADE,
  need_id TEXT REFERENCES need(id),            -- NULL for items counted at receipt that no pledge line covered
  item_id TEXT NOT NULL REFERENCES item(id),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  received_quantity INTEGER CHECK (received_quantity IS NULL OR received_quantity >= 0)
);
CREATE INDEX pledge_item_pledge ON pledge_item(pledge_id);
CREATE INDEX pledge_item_need ON pledge_item(need_id);

-- Private pickup details. address / notes / phone are AES-256-GCM ciphertext (see src/lib/crypto.ts)
-- and are set to NULL by the purge job. Nothing else in the schema stores them.
CREATE TABLE pickup (
  id TEXT PRIMARY KEY,
  pledge_id TEXT NOT NULL UNIQUE REFERENCES pledge(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  address_enc TEXT,
  notes_enc TEXT,
  phone_enc TEXT,
  purged_at TEXT,
  scheduled_window_id TEXT,         -- the donor window a coordinator confirmed
  overdue_notified_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX pickup_chapter ON pickup(chapter_id);

-- Preferred windows. Times are local to the chapter; start_at / end_at are the same instants in UTC.
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

-- Stock is the sum of this ledger. It is append-only and can never push stock below zero.
CREATE TABLE inventory_ledger (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  item_id TEXT NOT NULL REFERENCES item(id),
  delta INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('received','assembled_into_package','adjusted','discarded')),
  pledge_id TEXT REFERENCES pledge(id) ON DELETE SET NULL,
  package_id TEXT,
  note TEXT NOT NULL DEFAULT '',
  actor_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  CHECK (delta <> 0),
  CHECK (kind <> 'received' OR delta > 0),
  CHECK (kind NOT IN ('assembled_into_package','discarded') OR delta < 0)
);
CREATE INDEX ledger_stock ON inventory_ledger(chapter_id, item_id);

CREATE TRIGGER ledger_no_negative_stock BEFORE INSERT ON inventory_ledger
WHEN (SELECT COALESCE(SUM(delta), 0) FROM inventory_ledger WHERE chapter_id = NEW.chapter_id AND item_id = NEW.item_id) + NEW.delta < 0
BEGIN SELECT RAISE(ABORT, 'stock_negative'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON inventory_ledger
BEGIN SELECT RAISE(ABORT, 'inventory_ledger is append-only'); END;
-- Only actor_id may change, and only to NULL (account deletion).
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON inventory_ledger
WHEN NOT (
  OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
  AND OLD.id = NEW.id AND OLD.chapter_id = NEW.chapter_id AND OLD.item_id = NEW.item_id AND OLD.delta = NEW.delta
  AND OLD.kind = NEW.kind AND OLD.pledge_id IS NEW.pledge_id AND OLD.package_id IS NEW.package_id AND OLD.note = NEW.note
  AND OLD.created_at = NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'inventory_ledger is append-only'); END;

-- A package: which template, which partner agency it went to, and the date. Nothing about recipients.
CREATE TABLE package (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  template_id TEXT REFERENCES package_template(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'assembled' CHECK (status IN ('assembled','handed_off')),
  agency_id TEXT REFERENCES partner_agency(id),
  handed_off_on TEXT,
  assembled_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  assembled_at TEXT NOT NULL,
  handed_off_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  CHECK ((status = 'assembled' AND agency_id IS NULL AND handed_off_on IS NULL)
      OR (status = 'handed_off' AND agency_id IS NOT NULL AND handed_off_on IS NOT NULL))
);
CREATE INDEX package_chapter ON package(chapter_id, status);
CREATE TABLE package_item (
  package_id TEXT NOT NULL REFERENCES package(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES item(id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (package_id, item_id)
);

-- Concerns raised by a donor about a volunteer or by a volunteer about a donor. Coordinators triage them.
CREATE TABLE concern_report (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapter(id),
  pledge_id TEXT REFERENCES pledge(id) ON DELETE SET NULL,
  reporter_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reporter_role TEXT NOT NULL CHECK (reporter_role IN ('donor','volunteer')),
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
