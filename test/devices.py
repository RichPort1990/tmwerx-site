"""Every screen on phones and tablets (iPhone, Android, iPad, Android tablet, portrait and landscape): sideways
scrolling, things wider than the screen, controls too small to tap, script errors. Screenshots to SHOTS (default
/tmp/devices). python3 test/devices.py   (expects test/dev.sh running). Exit 1 if any check fails."""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8787')
SHOTS = os.environ.get('SHOTS', '/tmp/devices')
RUN = str(int(time.time()))
ADMIN = f'dev{RUN}@test.co.uk'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.makedirs(SHOTS, exist_ok=True)
DEVICES = ['iPhone SE', 'iPhone 15', 'iPhone 15 landscape', 'iPhone 15 Pro Max', 'Pixel 7', 'Galaxy S9+', 'iPad Mini', 'iPad Pro 11', 'iPad Pro 11 landscape', 'Galaxy Tab S4', 'Galaxy Tab S4 landscape']
problems = []

# what is wrong on the page now: sideways scroll, elements past the right edge, small tap targets
AUDIT = """() => {
  const W = document.documentElement.clientWidth, out = [];
  if (document.documentElement.scrollWidth > W + 1) out.push('page scrolls sideways: ' + document.documentElement.scrollWidth + ' > ' + W);
  const scrollers = el => { for (let p = el.parentElement; p; p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowX) && p.scrollWidth > p.clientWidth) return true; } return false; };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.position === 'fixed') continue;
    if (r.right > W + 2 && !scrollers(el)) { out.push('past right edge: ' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' right=' + Math.round(r.right) + ' "' + (el.innerText || '').slice(0, 30).replace(/\\s+/g, ' ') + '"'); if (out.length > 6) break; }
  }
  // a tick box inside its label is tapped anywhere on the label, so the label is what has to be big enough
  const small = [...document.querySelectorAll('button, a.btn, input[type=checkbox], input[type=radio], select')].filter(b => { const t = (b.type === 'checkbox' || b.type === 'radio') && b.closest('label') ? b.closest('label') : b; const r = t.getBoundingClientRect(); return r.width && r.height && r.height < 24 && getComputedStyle(b).visibility !== 'hidden'; });
  if (small.length) out.push(small.length + ' controls under 24px tall, e.g. ' + small.slice(0, 3).map(b => (b.innerText || b.type || b.tagName).trim().slice(0, 20)).join(', '));
  return [...new Set(out)];
}"""


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def sql(cmd):
    subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'tmwerx', '-c', '.wrangler-test.toml', '--local', '--command', cmd], cwd=ROOT, capture_output=True)


def nav(page, sel):
    try:
        with page.expect_navigation(wait_until='load', timeout=20000):
            page.click(sel)
    except Exception:
        pass
    if page.url.endswith('/login/code'):
        to = re.search(r'<b>([^<]+)</b> has signed in', page.content()).group(1)
        ms = [m for m in get(BASE + '/dev/outbox') if m['to_addr'] == to and 'sign-in code' in m['subject']]
        page.fill('#code', re.search(r'\b(\d{6})\b', ms[0]['body']).group(1))
        nav(page, 'main form button[type=submit]')


def audit(page, dev, name):
    try:
        found = page.evaluate(AUDIT)
    except Exception as e:
        found = ['audit failed: ' + str(e)[:100]]
    safe = re.sub(r'\W+', '_', f'{dev}-{name}')
    page.screenshot(path=f'{SHOTS}/{safe}.png')
    for f in found:
        problems.append(f'{dev} | {name} | {f}')
        print('PROBLEM', problems[-1], flush=True)


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- a company with data, set up on a desktop ----------
    sql('DELETE FROM attempts')
    sql(f"INSERT OR IGNORE INTO domain_exempt (email, created_at) VALUES ('{ADMIN}', 0)")
    dctx = b.new_context(viewport={'width': 1400, 'height': 900}, bypass_csp=True)
    pg = dctx.new_page()
    pg.goto(BASE + '/signup')
    pg.fill('#company', 'Device Test Traffic Management Limited'); pg.fill('#name', 'Alexandra Montgomery-Smith'); pg.fill('#email', ADMIN); pg.fill('#password', 'correct horse battery')
    nav(pg, 'main button[type=submit]')
    link = re.search(r'https?://\S+', [m for m in get(BASE + '/dev/outbox') if m['to_addr'] == ADMIN and '/verify?t=' in m['body']][0]['body']).group(0)
    pg.goto(link); pg.fill('#signed_name', 'Alexandra Montgomery-Smith'); pg.check('input[name=agree]'); nav(pg, 'main button[type=submit]')
    pg.goto(BASE + '/billing'); nav(pg, 'main button[type=submit]'); pg.wait_for_selector('#nav a')

    def api(method, path, data=None, raw=None, headers=None):
        h = dict(headers or {})
        if data is not None:
            h['Content-Type'] = 'application/json'
        return pg.request.fetch(BASE + '/api/office' + path, method=method, data=raw if raw is not None else (json.dumps(data) if data is not None else None), headers=h).json()

    cl = api('POST', '/clients', {'name': 'Aire Valley Water Services and Maintenance Ltd', 'deduction_per_day': 2500})
    van = api('POST', '/vehicles', {'reg': 'YX70 KLM', 'model': 'Ford Transit 350 L3H2 crew cab'})
    crew = api('POST', '/people', {'name': 'Daniel Hughes-Whittaker', 'username': f'dan{RUN}', 'role': 'lead', 'phone': '07700900123', 'day_cost': 17500})
    api('POST', f"/people/{crew['id']}/quals", {'name': 'NHSS 12D T2 Sector Scheme', 'number': 'A123456789', 'expires': '2027-01-01'})
    job = api('POST', '/jobs', {'address': '14 Otley Road, Headingley, opposite the bus station', 'town': 'Leeds', 'postcode': 'LS6 3AA', 'lat': 53.8205, 'lng': -1.5762, 'client_id': cl['id'], 'tm_type': '2-way lights', 'client_ref': 'WO-2026-0004471-A', 'hazards': ['Bus stop or bus route', 'School nearby'], 'instructions': 'Keep the bus stop open at all times. ' * 6, 'client_rate': 42000})
    PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
    eq = [{'code': '7001', 'name': 'Road works ahead sign 1050 mm on frame (7001)', 'qty': 2}, {'code': 'C750', 'name': 'Cones 750 mm', 'qty': 24}]
    api('POST', f"/jobs/{job['id']}/drawing?rev=A", raw=PDF, headers={'X-Equipment': urllib.parse.quote(json.dumps(eq))})
    vis = api('POST', f"/jobs/{job['id']}/visits", {'date': time.strftime('%Y-%m-%d'), 'start_time': '07:30', 'kind': 'install_remove', 'vehicle_ids': [van['id']], 'crew': [{'user_id': crew['id'], 'lead': True}], 'notes': 'Meet the client supervisor at the depot gate first.'})
    api('POST', f"/jobs/{job['id']}/send")
    api('POST', '/requests', {'source': 'paste', 'text': 'Hi, can you do 2-way lights at 14 Otley Road, Leeds LS6 3AA on 12/11/2026 starting 9:30am? Ref PO-88123.'})
    state = dctx.storage_state()
    jid, vid = job['id'], vis['id']

    OFFICE = ['live', 'board', 'jobs', 'jobs/new', f'job/{jid}/visits', f'job/{jid}/drawing', f'job/{jid}/record', f'job/{jid}/details', f'job/{jid}/history', 'requests', 'crew', 'vehicles', 'clients', 'docs/ra', 'docs/method', 'rules', 'safety', 'alerts', 'time', 'costs', 'settings']

    for dev in DEVICES:
        d = p.devices[dev]
        # public pages, signed out
        c = b.new_context(**d, bypass_csp=True)
        pp = c.new_page()
        errs = []
        pp.on('pageerror', lambda e: errs.append(str(e)[:150]))
        for path in ('/', '/login', '/signup', '/terms', '/privacy', '/forgot'):
            pp.goto(BASE + path); pp.wait_for_timeout(200)
            audit(pp, dev, 'public' + path.replace('/', '_'))
        pp.goto(BASE + '/crew/'); pp.wait_for_selector('#un'); audit(pp, dev, 'crew_login')
        c.close()

        # office app
        c = b.new_context(**d, storage_state=state, bypass_csp=True)
        op = c.new_page()
        op.on('pageerror', lambda e: errs.append('office: ' + str(e)[:150]))
        op.goto(BASE + '/app'); op.wait_for_selector('#nav a')
        for h in OFFICE:
            op.evaluate(f"location.hash = '{h}'")
            try:
                op.wait_for_function("!document.querySelector('#view').innerText.startsWith('Loading')", timeout=15000)
            except Exception:
                problems.append(f'{dev} | office {h} | did not finish loading')
            op.wait_for_timeout(250)
            audit(op, dev, 'office_' + h.split('/')[0] + ('_' + h.split('/')[-1] if '/' in h else ''))
        # the visit dialog and the job menu
        op.evaluate(f"location.hash = 'job/{jid}/visits'"); op.wait_for_selector('[data-edit]')
        for sel, wait, name in (('[data-edit]', 'dialog #ok', 'office_visit_dialog'), ('#more', 'dialog #mShare', 'office_job_menu'), ('#addV', 'dialog #ok', 'office_add_visit')):
            try:
                op.click(sel, timeout=8000); op.wait_for_selector(wait, timeout=8000); audit(op, dev, name)
            except Exception as e:
                problems.append(f'{dev} | {name} | could not open: {str(e).splitlines()[0][:120]}')
            op.evaluate("document.querySelectorAll('dialog').forEach(d => d.close())")
        c.close()

        # crew app
        c = b.new_context(**d, geolocation={'latitude': 53.8205, 'longitude': -1.5762}, permissions=['geolocation'], bypass_csp=True)
        cp = c.new_page()
        cp.on('pageerror', lambda e: errs.append('crew: ' + str(e)[:150]))
        cp.goto(BASE + '/crew/'); cp.wait_for_selector('#un')
        cp.fill('#un', crew['username']); cp.fill('#pw', crew['password']); cp.click('#go')
        cp.wait_for_selector('.guide'); audit(cp, dev, 'crew_guide')
        cp.click('#skip'); cp.wait_for_selector('a.job'); audit(cp, dev, 'crew_home')
        cp.wait_for_timeout(1500)
        if 'Signed out' in (cp.inner_text('#sendbar') if cp.is_visible('#sendbar') else ''):
            problems.append(f'{dev} | crew_home | says Signed out right after signing in'); print('PROBLEM', problems[-1], flush=True)
        cp.click('a.job'); cp.wait_for_selector('[data-step=accepted]'); audit(cp, dev, 'crew_visit')
        cp.evaluate("window.scrollTo(0, document.body.scrollHeight)"); audit(cp, dev, 'crew_visit_bottom')
        for step in ('vehicle_check', 'loaded', 'ra_signoff', 'signin', 'risk_check', 'complete'):
            cp.evaluate("window.scrollTo(0,0)")
            btn = cp.query_selector(f'[data-step={step}]:not([disabled])')
            if not btn:
                continue
            btn.click()
            try:
                cp.wait_for_selector('.sheet #ok, .sheet #cam', timeout=20000)
            except Exception:
                problems.append(f'{dev} | crew sheet {step} | did not open')
                continue
            audit(cp, dev, 'crew_sheet_' + step)
            cp.evaluate("document.querySelector('.sheet > div').scrollTo(0, 1e6)"); audit(cp, dev, 'crew_sheet_' + step + '_end')
            cp.evaluate("document.querySelectorAll('.sheet').forEach(s => s.remove())")
        for x in ('note', 'near_miss'):
            cp.click(f'[data-x={x}]'); cp.wait_for_selector('.sheet #t'); audit(cp, dev, 'crew_extra_' + x); cp.evaluate("document.querySelectorAll('.sheet').forEach(s => s.remove())")
        cp.click('#panic'); cp.wait_for_selector('.sheet #go'); audit(cp, dev, 'crew_panic'); cp.evaluate("document.querySelectorAll('.sheet').forEach(s => s.remove())")
        cp.evaluate(f"location.hash = 'info/{vid}'"); cp.wait_for_timeout(300); audit(cp, dev, 'crew_info')
        cp.evaluate("location.hash = 'more'"); cp.wait_for_timeout(300); audit(cp, dev, 'crew_more')
        c.close()
        for e in errs:
            problems.append(f'{dev} | script error | {e}')
        print('done', dev, flush=True)
    b.close()

for x in problems:
    if ' | script error | ' in x or 'could not open' in x or 'did not' in x:
        print('PROBLEM', x)
print(f'\n{len(problems)} problems; screenshots in {SHOTS}')
sys.exit(1 if problems else 0)
