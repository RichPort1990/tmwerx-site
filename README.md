# TM WerX

Jobs, crews and site records for traffic management companies, at **tmwerx.co.uk**. A sister product to CAD WerX,
run by CAD WerX Limited.

- **Office app** (`/app`): live view, weekly board, jobs with visits, crews, vans and drawings, job requests from
  email or pasted messages, crew logins and qualifications, vehicles, clients, versioned RAMS and vehicle-check
  documents, photo rules, safety (near misses, actions, audits, lone working), timesheets, costs and invoicing,
  evidence packs, job zips and client share links.
- **Crew app** (`/crew/`): an installable web app (no app store). Crews sign in with a username, add it to the home
  screen (the first sign-in shows how, for iPhone and Android), and work through each visit: accept, vehicle check,
  load the van, RAMS, drawing, sign in on site, site check, start, set up, scheduled photos, count back, finish,
  sign out, plus notes, change requests, near misses, lone working and a panic alarm. **It works without signal**:
  everything is saved on the phone first and sent when signal returns.
- **Account, billing and sign-in** are the same modules as CAD WerX: email sign-in with codes for office users,
  Stripe per-seat billing, the customer agreement, the operator admin page, weekly encrypted backups.

## Stack

| Part | What | Notes |
|---|---|---|
| Hosting | Cloudflare Workers (Paid plan) | One Worker serves pages, the two JSON APIs, static files, cron and email |
| Database | Cloudflare D1 `tmwerx` | Western Europe. Schema in `migrations/` |
| Files | Cloudflare R2 `tmwerx-files-eu` | Photos, drawings, logos, backups. Private: served only through the Worker |
| Timers | Cron triggers | Every minute: photo schedules, overdue alerts, lone-working check-ins, positions clean-up. Sunday 03:17: backup |
| Job request email | Cloudflare Email Routing → the Worker | `jobs+<company key>@tmwerx.co.uk` |
| Phone notifications | Web Push with VAPID, encrypted in the Worker | No third-party push SDK |
| Payments | Stripe | One monthly per-user price |
| Email out | Resend | Sign-in codes, invitations, urgent alerts |
| Postcodes | postcodes.io | Free, open data, no key |
| Drawings from CAD WerX | Service binding `CADWERX` | Private Worker-to-Worker call (see below) |

No frameworks: the office app is plain scripts in `public/assets/office/`, the crew app is `public/crew/`.

## Layout

```
src/worker.js            routes, cron and email entry points
src/tm/                  TM WerX: office-api, crew-api, events (what site records mean), tasks (photo schedules),
                         cron, intake (job requests), pack (evidence pack), zip, share, push, cadwerx, purge
src/auth.js signin.js billing.js account.js admin.js backup.js housekeeping.js health.js   shared with CAD WerX
src/home.js terms.js privacy.js   the public pages (terms and privacy are DRAFTS for a solicitor)
public/assets/office/    the office app (core.js first, main.js last: see src/tm/shell.js)
public/crew/             the crew app: index.html, app.js, outbox.js (offline store), sw.js (service worker)
migrations/              0001 accounts, 0002 TM WerX tables
test/tm.py               end-to-end test (office + crew app on an emulated iPhone, with and without signal)
test/shots.py            makes the home-page screenshots from a demo company
test/devices.py          every screen on phones and tablets: sideways scrolling, clipped controls, tap sizes, errors
```

## Setting it up (once)

You need: the Cloudflare account that holds tmwerx.co.uk (Workers Paid), Stripe, Resend, and Node 22.

1. **Database and file store**
   ```
   npm ci
   npx wrangler d1 create tmwerx --location weur        # paste the database_id into wrangler.toml
   npx wrangler r2 bucket create tmwerx-files-eu --location weur
   npx wrangler d1 migrations apply tmwerx --remote
   ```
2. **Phone notification keys**: `npm run vapid` prints a key pair. Save both as secrets (below). Never change them
   once crews have switched alerts on, or every phone has to switch alerts on again.
3. **Stripe**: make a product "TM WerX user" with a monthly per-unit price; put its id in `STRIPE_PRICE_ID` in
   `wrangler.toml`. Add a webhook to `https://tmwerx.co.uk/stripe/webhook` for `checkout.session.completed`,
   `customer.subscription.*`, `invoice.payment_failed`, `customer.deleted` and `charge.dispute.created`.
4. **Resend**: add the domain tmwerx.co.uk and its DNS records, so `no-reply@tmwerx.co.uk` can send.
5. **Secrets** (`npx wrangler secret put NAME`, or the dashboard):
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `BACKUP_KEY` (any long random string; keep a copy
   somewhere safe, it is needed to restore), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ADMIN_EMAILS` (operators,
   comma separated), `SIGNUP_ALLOW` (while testing: who may sign up, e.g. `@port.holdings`), and later
   `CADWERX_LINK_SECRET`.
6. **Job request email**: in Cloudflare, Email Routing for tmwerx.co.uk → enable, then a rule (or the catch-all)
   sending `jobs+*@tmwerx.co.uk` to the Worker `tmwerx`. Each company's address is shown under Settings.
7. **Fill in** `PROVIDER_ICO` in `wrangler.toml`, and have a solicitor review `src/terms.js` and `src/privacy.js`
   (both say DRAFT on the page until then). The liability cap in the terms is `£[X]`.
8. **Deploy**: connect the GitHub repo in Cloudflare (Workers & Pages → the Worker → Settings → Builds), with the
   production branch `production`. CI (`.github/workflows/ci.yml`) runs the tests on every push to `main` and moves
   `production` on only when they pass. Or deploy by hand: `npm run deploy`.

## Linking CAD WerX

TM WerX reads issued drawings from the `cadwerx` Worker through a service binding: no public endpoint. To switch it
on, uncomment `[[services]]` in `wrangler.toml`, set the same `CADWERX_LINK_SECRET` on both Workers, and add these
three routes to CAD WerX (`POST`, JSON in, called only via the binding, refused unless `X-TM-Secret` matches):

| Route | Body | Answer |
|---|---|---|
| `/internal/tm/search` | `{ q }` | `{ results: [{ id, name, address, updated, version }] }`: issued projects of the company whose link code is in `X-TM-Link` |
| `/internal/tm/issue` | `{ project, version }` | `{ issued, rev, drawing_no, approved_by, approved_at, sha256, pages, equipment: [{code, name, qty}], street, town, postcode, usrn, client_ref, hours, w3w, tm_type, start_date, end_date, lat, lng }` |
| `/internal/tm/pdf` | `{ project, version }` | the issued PDF |

`X-TM-Link` is a code a CAD WerX administrator makes (CAD WerX Account → TM WerX link) and pastes into TM WerX
Settings; answer 403 if it is unknown or revoked. The PDF's SHA-256 must match `sha256`. Until this exists, jobs take
uploaded PDF drawings with an equipment list typed in.

## Working on it

```
sh test/dev.sh                 # local Worker on :8787 with a mock Stripe; emails go to /dev/outbox
npx wrangler d1 migrations apply tmwerx -c .wrangler-test.toml --local    # first time, and after a new migration
python3 test/tm.py             # the end-to-end test (pip install -r test/requirements.txt)
python3 test/shots.py          # refresh the home-page screenshots
python3 test/devices.py        # every screen on iPhone, Android, iPad and Android tablet sizes (about 25 minutes)
npm run check                  # formatting and lint (npm run format to fix)
```

`wrangler dev` reads the list of static files when it starts: restart it after adding files under `public/`.

## How the offline crew app works

- `/api/crew/sync` gives the phone everything for its visits from 14 days ago to 60 days ahead: jobs, visits, crews,
  drawings' details, the company documents, photo rules, earlier records and photos. The phone keeps it in
  IndexedDB and the service worker keeps the drawing PDFs, so the app opens and works with no signal.
- Every record and photo gets an id on the phone and goes into an outbox. Sending is retried when the app opens,
  every 30 seconds, when signal returns, and (Android) by background sync with the app closed. The server keeps
  the first copy of each id, so retries can't duplicate anything.
- Photo tasks have ids made the same way on the phone and the server (`visit:rule:due time`), so a photo taken with
  no signal is linked to its task before the server has heard of it. A photo taken on time counts as on time if it
  arrives within the company's late-photo allowance (12 hours by default).
- Each batch carries the phone's clock, so a wrong phone clock shows up in the record and the evidence pack.
