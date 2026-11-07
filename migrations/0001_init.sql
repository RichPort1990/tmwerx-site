-- TM WerX accounts: the same sign-up, agreement and billing model as CAD WerX (one database per product)
CREATE TABLE companies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  stripe_customer TEXT,
  stripe_sub TEXT,
  stripe_item TEXT,
  sub_status TEXT DEFAULT 'none',          -- none | incomplete | trialing | active | past_due | canceled | unpaid
  seats_paid INTEGER DEFAULT 0,
  period_end INTEGER,
  cancel_at_period_end INTEGER DEFAULT 0,
  logo_type TEXT,                          -- image/png | image/jpeg (file in R2 at logos/<id>)
  seats_dirty INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER,
  purged_at INTEGER,
  domain TEXT,                             -- the work email domain this organisation holds while it is paying
  domain_claim TEXT                        -- the domain it would hold
);
CREATE INDEX companies_sub ON companies(stripe_sub);
CREATE INDEX companies_cus ON companies(stripe_customer);
CREATE INDEX companies_domain ON companies(domain);

-- office users sign in with email; crew sign in with a username the office gives them (no email needed)
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id),
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'office',     -- admin | office (office web app) | lead | engineer (crew app)
  verified INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  phone TEXT,
  day_cost INTEGER,                        -- pence per working day (crew), for job costs
  installed_at INTEGER,                    -- the crew app was opened from the home screen
  push_ok INTEGER NOT NULL DEFAULT 0,      -- notifications allowed on the phone
  last_seen INTEGER                        -- the crew app last reached the server
);
CREATE INDEX users_company ON users(company_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_expires ON sessions(expires_at);
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                      -- verify | reset | invite
  user_id TEXT,
  company_id TEXT,
  email TEXT,
  role TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX tokens_expires ON tokens(expires_at);
CREATE TABLE acceptances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,
  version TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  signed_name TEXT NOT NULL,
  email TEXT NOT NULL,
  company_name TEXT NOT NULL,
  role TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT,
  accepted_at INTEGER NOT NULL
);
CREATE INDEX acc_user ON acceptances(user_id, version);
CREATE INDEX acc_company ON acceptances(company_id, version, doc_hash);
CREATE TABLE terms_docs (hash TEXT PRIMARY KEY, version TEXT NOT NULL, html TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, type TEXT, received_at INTEGER);
CREATE TABLE attempts (k TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX attempts_k ON attempts(k, at);
CREATE INDEX attempts_at ON attempts(at);
CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, to_addr TEXT, subject TEXT, body TEXT, created_at INTEGER);
CREATE TABLE domain_exempt (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
CREATE TABLE devices (user_id TEXT NOT NULL, id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (user_id, id));
CREATE TABLE device_codes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, dev TEXT NOT NULL, code_hash TEXT NOT NULL, tries INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE session_ends (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE trials (domain TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE alerts (k TEXT PRIMARY KEY, at INTEGER NOT NULL);
