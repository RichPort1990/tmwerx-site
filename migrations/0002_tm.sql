-- TM WerX: jobs, visits, crews, drawings, site records, photos, checks, alerts and costs.
-- Every row carries company_id, and every query is scoped by it. Site records (tm_events, tm_photos) are never
-- changed or deleted by anyone in a company: corrections are new records.

-- company settings (JSON): working week, alert limits, spares, retention, which steps block Start, ...
CREATE TABLE tm_settings (company_id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', intake_key TEXT UNIQUE, updated_at INTEGER);

CREATE TABLE tm_clients (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL, contact TEXT, email TEXT, phone TEXT, notes TEXT,
  deduction_per_day INTEGER NOT NULL DEFAULT 0,   -- pence taken off each working day for this client (e.g. a fee)
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);
CREATE INDEX tm_clients_co ON tm_clients(company_id, name);

CREATE TABLE tm_vehicles (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, reg TEXT NOT NULL, model TEXT, kind TEXT,
  mot_due TEXT, tax_due TEXT, service_due TEXT, insurance_due TEXT,   -- YYYY-MM-DD
  off_road INTEGER NOT NULL DEFAULT 0,
  unsafe INTEGER NOT NULL DEFAULT 0,          -- the latest check said Not safe (cleared by the office)
  notes TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX tm_vehicles_co ON tm_vehicles(company_id);

CREATE TABLE tm_quals (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, number TEXT,
  expires TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX tm_quals_user ON tm_quals(company_id, user_id);

-- the document library: each save is a new version; the newest is current. reviewed_at NULL = DRAFT
CREATE TABLE tm_docs (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, kind TEXT NOT NULL,   -- ra | method | vehicle_checks | hazards
  version INTEGER NOT NULL, title TEXT, content TEXT NOT NULL,          -- JSON
  created_by TEXT, created_at INTEGER NOT NULL, reviewed_by TEXT, reviewed_at INTEGER,
  UNIQUE (company_id, kind, version)
);

-- photo rules: who they apply to, what triggers them, and what happens when one is missed
CREATE TABLE tm_photo_rules (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, name TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'company',      -- company | client | tm_type | job
  scope_ref TEXT,                             -- client id, TM type or job id
  trig TEXT NOT NULL,                         -- event | repeat | daily
  event TEXT,                                 -- arrival | before_work | setup | handover | removal | site_clear
  every_mins INTEGER, at_time TEXT,           -- repeat: every N minutes while signed in; daily: HH:MM
  grace_mins INTEGER NOT NULL DEFAULT 10,
  label TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
  escalate_mins INTEGER NOT NULL DEFAULT 30,  -- after the due time + grace: alert the office; again after this
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
);
CREATE INDEX tm_rules_co ON tm_photo_rules(company_id);

CREATE TABLE tm_jobs (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, number TEXT NOT NULL, title TEXT,
  client_id TEXT, client_ref TEXT,
  address TEXT, town TEXT, postcode TEXT, lat REAL, lng REAL, usrn TEXT, w3w TEXT,
  tm_type TEXT, permit_ref TEXT, permit_end TEXT,
  start_date TEXT, end_date TEXT, hours TEXT,
  site_contact TEXT, nearest_ae TEXT, instructions TEXT,
  hazards TEXT NOT NULL DEFAULT '[]',          -- JSON list of picked hazards and free text
  status TEXT NOT NULL DEFAULT 'scheduled',    -- scheduled | in_progress | completed | cancelled
  source TEXT NOT NULL DEFAULT 'manual',       -- cadwerx | pdf | manual | request
  intake_id TEXT,
  client_rate INTEGER,                         -- pence per working day (or the fixed price, by charge basis)
  charge_basis TEXT NOT NULL DEFAULT 'daily',  -- daily | hourly | fixed
  invoice_ready INTEGER NOT NULL DEFAULT 0, invoiced_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1, sent_version INTEGER NOT NULL DEFAULT 0, sent_at INTEGER,
  removed_at INTEGER,                          -- taken off the crew's phones
  share_hash TEXT, share_expires INTEGER,      -- a read-only evidence link for the client
  created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX tm_jobs_co ON tm_jobs(company_id, status, start_date);
CREATE UNIQUE INDEX tm_jobs_num ON tm_jobs(company_id, number);
CREATE INDEX tm_jobs_share ON tm_jobs(share_hash);

-- issued drawings: a fixed PDF and its equipment list (from CAD WerX or uploaded). Never changed once issued.
CREATE TABLE tm_drawings (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT NOT NULL, rev TEXT NOT NULL,
  source TEXT NOT NULL,                        -- cadwerx | pdf
  cad_project TEXT, cad_version TEXT, drawing_no TEXT, approved_by TEXT, approved_at INTEGER,
  pdf_key TEXT NOT NULL, sha256 TEXT NOT NULL, pages INTEGER,
  equipment TEXT NOT NULL DEFAULT '[]',        -- [{code, name, qty}]
  note TEXT, created_by TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX tm_drawings_job ON tm_drawings(company_id, job_id, created_at);

-- a visit is one crew's shift on a job (install, daily check, removal, ...)
CREATE TABLE tm_visits (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT NOT NULL,
  date TEXT NOT NULL, start_time TEXT, end_time TEXT, kind TEXT NOT NULL DEFAULT 'install',
  vehicle_ids TEXT NOT NULL DEFAULT '[]',
  drawing_id TEXT,                             -- the revision this visit works from
  status TEXT NOT NULL DEFAULT 'scheduled',    -- scheduled | in_progress | completed | cancelled | failed
  review TEXT NOT NULL DEFAULT 'none',         -- none | pending | approved | returned
  review_note TEXT, reviewed_by TEXT, reviewed_at INTEGER,
  client_rate INTEGER,                         -- pence for this working day, if different from the job's
  notes TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX tm_visits_date ON tm_visits(company_id, date);
CREATE INDEX tm_visits_job ON tm_visits(company_id, job_id);

CREATE TABLE tm_assign (
  visit_id TEXT NOT NULL, user_id TEXT NOT NULL, company_id TEXT NOT NULL,
  lead INTEGER NOT NULL DEFAULT 0, cost INTEGER,  -- pence for this person's day (defaults to their day cost)
  PRIMARY KEY (visit_id, user_id)
);
CREATE INDEX tm_assign_user ON tm_assign(user_id);

-- everything recorded from site, append only. id is made on the phone, so a retry never duplicates.
CREATE TABLE tm_events (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT, visit_id TEXT, vehicle_id TEXT, user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}', signature TEXT,
  lat REAL, lng REAL, acc REAL,
  client_time INTEGER, server_time INTEGER NOT NULL, skew INTEGER,   -- skew = phone clock minus server clock (ms) at upload
  by_office INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tm_events_job ON tm_events(company_id, job_id, server_time);
CREATE INDEX tm_events_visit ON tm_events(visit_id);
CREATE INDEX tm_events_kind ON tm_events(company_id, kind, server_time);
CREATE INDEX tm_events_user ON tm_events(company_id, user_id, server_time);

CREATE TABLE tm_photos (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT, visit_id TEXT, vehicle_id TEXT, event_id TEXT,
  user_id TEXT NOT NULL, task_id TEXT, category TEXT, caption TEXT,
  r2_key TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL, mime TEXT NOT NULL,
  lat REAL, lng REAL, acc REAL, taken_at INTEGER, received_at INTEGER NOT NULL, skew INTEGER,
  source TEXT NOT NULL DEFAULT 'camera'          -- camera | gallery | office
);
CREATE INDEX tm_photos_job ON tm_photos(company_id, job_id, taken_at);
CREATE INDEX tm_photos_visit ON tm_photos(visit_id);

-- the photos each visit owes under its rules, made by the minute-by-minute check
CREATE TABLE tm_photo_tasks (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT NOT NULL, visit_id TEXT NOT NULL, rule_id TEXT NOT NULL,
  label TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1,
  due_at INTEGER NOT NULL, grace_until INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'due',            -- due | done | missed
  done_at INTEGER, late INTEGER NOT NULL DEFAULT 0, reason TEXT,
  alert_level INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  UNIQUE (visit_id, rule_id, due_at)
);
CREATE INDEX tm_tasks_open ON tm_photo_tasks(status, grace_until);
CREATE INDEX tm_tasks_visit ON tm_photo_tasks(visit_id);

-- alerts for the office: overdue photos, unsafe vans, site not matching, near misses, check-ins, stuck uploads, ...
CREATE TABLE tm_alerts (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, job_id TEXT, user_id TEXT,
  level TEXT NOT NULL DEFAULT 'warn',            -- info | warn | urgent
  title TEXT NOT NULL, detail TEXT, created_at INTEGER NOT NULL, ack_by TEXT, ack_at INTEGER,
  UNIQUE (company_id, kind, ref)
);
CREATE INDEX tm_alerts_open ON tm_alerts(company_id, ack_at, created_at);

-- job requests from the forwarding address or pasted in, waiting for the office to approve
CREATE TABLE tm_intake (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, source TEXT NOT NULL, from_addr TEXT, subject TEXT,
  body TEXT NOT NULL, extracted TEXT NOT NULL DEFAULT '{}', hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',            -- new | approved | rejected
  duplicate_of TEXT, job_id TEXT, created_at INTEGER NOT NULL, decided_by TEXT, decided_at INTEGER
);
CREATE INDEX tm_intake_co ON tm_intake(company_id, status, created_at);
CREATE INDEX tm_intake_hash ON tm_intake(company_id, hash);

-- actions from near misses, audits and checks, tracked to closure
CREATE TABLE tm_actions (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, source TEXT, ref TEXT, title TEXT NOT NULL, owner TEXT,
  due TEXT, status TEXT NOT NULL DEFAULT 'open', note TEXT, created_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE INDEX tm_actions_co ON tm_actions(company_id, status);

CREATE TABLE tm_audits (
  id TEXT PRIMARY KEY, company_id TEXT NOT NULL, job_id TEXT, visit_id TEXT, auditor TEXT NOT NULL,
  data TEXT NOT NULL, score INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX tm_audits_co ON tm_audits(company_id, created_at);

-- phones that accept notifications
CREATE TABLE tm_push (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, company_id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL,
  auth TEXT NOT NULL, created_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX tm_push_user ON tm_push(user_id);

-- the latest position of each signed-in person (working time only), kept 30 days
CREATE TABLE tm_locations (
  user_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, lat REAL, lng REAL, acc REAL, at INTEGER NOT NULL
);

-- lone working: who is on a timer, and when their next check-in is due
CREATE TABLE tm_lone (
  user_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, visit_id TEXT, every_mins INTEGER NOT NULL,
  next_due INTEGER NOT NULL, last_checkin INTEGER, missed INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL
);

-- who changed what in the office (jobs, crews, documents, settings)
CREATE TABLE tm_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, company_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL,
  ref TEXT, detail TEXT, at INTEGER NOT NULL
);
CREATE INDEX tm_log_ref ON tm_log(company_id, ref, at);
