"""The CAD WerX link, end to end, with both sites running locally and joined by the same private service binding as on
Cloudflare: CAD WerX (its test/dev.sh, port 8787, TMWERX_LINK_SECRET set) and TM WerX (port 8788, CADWERX_LINK_SECRET
set to the same). A drawing goes across only with both subscriptions and a live link code.
python3 test/link.py"""
import json, os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

CWX = os.environ.get('CWX', 'http://localhost:8787')
TMX = os.environ.get('TMX', 'http://localhost:8788')
CWX_DIR = os.environ.get('CWX_DIR', '/home/claude/cadwerx-site')
TMX_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRET = os.environ.get('LINK_SECRET', 'local-test-link-secret-0123456789abcdef')
RUN = str(int(time.time()))
results = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:300]))


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def sql(dirn, db, cmd):
    return subprocess.run(['npx', 'wrangler', 'd1', 'execute', db, '-c', '.wrangler-test.toml', '--local', '--json', '--command', cmd], cwd=dirn, capture_output=True, text=True).stdout


def nav(page, base, sel):
    try:
        with page.expect_navigation(wait_until='load', timeout=20000):
            page.click(sel)
    except Exception:
        pass
    if page.url.endswith('/login/code'):
        to = re.search(r'<b>([^<]+)</b> has signed in', page.content()).group(1)
        ms = [m for m in get(base + '/dev/outbox') if m['to_addr'] == to and 'sign-in code' in m['subject']]
        page.fill('#code', re.search(r'\b(\d{6})\b', ms[0]['body']).group(1))
        nav(page, base, 'main form button[type=submit]')


def signup(b, base, dirn, db, email, company):
    sql(dirn, db, 'DELETE FROM attempts')
    sql(dirn, db, f"INSERT OR IGNORE INTO domain_exempt (email, created_at) VALUES ('{email}', 0)")
    c = b.new_context(bypass_csp=True)
    pg = c.new_page()
    if 'cadwerx' in dirn:   # the designer's map libraries come from a CDN: not needed for these pages
        pg.route(re.compile(r'https://(cdn|unpkg|tiles)\.'), lambda r: r.abort())
    pg.goto(base + '/signup')
    pg.fill('#company', company); pg.fill('#name', 'Pat Boss'); pg.fill('#email', email); pg.fill('#password', 'correct horse battery')
    nav(pg, base, 'main button[type=submit]')
    link = re.search(r'https?://\S+', [m for m in get(base + '/dev/outbox') if m['to_addr'] == email and '/verify?t=' in m['body']][0]['body']).group(0)
    pg.goto(link); pg.fill('#signed_name', 'Pat Boss'); pg.check('input[name=agree]'); nav(pg, base, 'main button[type=submit]')
    pg.goto(base + '/billing'); nav(pg, base, 'main button[type=submit]')
    cid = json.loads(sql(dirn, db, f"SELECT company_id FROM users WHERE email = '{email}'"))[0]['results'][0]['company_id']
    return c, pg, cid


def jpost(pg, url, data):
    r = pg.request.post(url, data=json.dumps(data), headers={'Content-Type': 'application/json', 'Origin': re.match(r'https?://[^/]+', url).group(0)})
    try:
        return r.status, r.json()
    except Exception:
        return r.status, {}


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- CAD WerX: a company, a link code, a drawing sent ----------
    cc, cp, ccid = signup(b, CWX, CWX_DIR, 'cadwerx', f'cad{RUN}@test.co.uk', 'Link Test Traffic')
    check('CAD WerX company subscribed', '/billing' not in cp.url, cp.url)
    cp.goto(CWX + '/account')
    check('CAD WerX account page offers the TM WerX link', 'TM WerX link' in cp.content() and 'Make a link code' in cp.content())
    with cp.expect_navigation():
        cp.click('form[action="/account/tm-link"] button')
    code = cp.input_value('input[aria-label="Link code"]')
    check('a link code is shown once', re.match(r'^cwx_[\w-]{40,}$', code), code)
    st, proj = jpost(cp, CWX + '/api/projects', {'meta': {'title': 'Otley Road lights', 'street': 'Otley Road', 'town': 'Leeds', 'postcode': 'ls6 3aa', 'client_ref': 'WO-77', 'drawing_no': 'CW-0042', 'rev': 'B'}, 'file': json.dumps({'app': 'CAD WerX', 'format': 1})})
    check('a project saved in CAD WerX', st == 200 and proj.get('id'), (st, proj))
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1188 840"><rect width="1188" height="840" fill="#fff"/><text x="40" y="60">Otley Road lights rev B</text><script>parent.document.title="pwned"</script></svg>'
    issue = {'version': proj.get('version'), 'pages': [svg, svg], 'equipment': [{'code': '7001', 'name': 'Sign 7001: Road works ahead', 'qty': 2}, {'code': '', 'name': 'Cones, 450 mm minimum', 'qty': 30, 'note': 'Code minimum'}],
             'site': {'lat': 53.8205, 'lng': -1.5762, 'usrn': '12345678', 'w3w': 'index.home.raft', 'control': {'control': 'pts', 'ways': 2, 'closure': False}, 'start_date': '2026-11-20', 'end_date': '2026-11-22', 'hours': '09:30–15:30'}}
    st, j = jpost(cp, CWX + f"/api/projects/{proj['id']}/tm-issue", dict(issue, version='not-the-latest'))
    check('only the latest saved version can be sent', st == 409, (st, j))
    st, sent = jpost(cp, CWX + f"/api/projects/{proj['id']}/tm-issue", issue)
    check('the saved drawing is sent to TM WerX', st == 200 and sent.get('ok'), (st, sent))
    outsider = b.new_context()
    st = outsider.request.post(CWX + f"/api/projects/{proj['id']}/tm-issue", data=json.dumps(issue), headers={'Content-Type': 'application/json'}).status
    check('nobody signed out can send', st == 401, st)

    # ---------- the private addresses can't be used from the internet ----------
    for hdr, what in (({}, 'no secret'), ({'X-TM-Secret': 'wrong', 'X-TM-Link': code}, 'a wrong secret')):
        r = outsider.request.post(CWX + '/internal/tm/search', data='{}', headers=dict({'Content-Type': 'application/json'}, **hdr))
        check(f"CAD WerX's link address is 'not found' with {what}", r.status == 404, r.status)
    outsider.close()

    # ---------- TM WerX: a company links and puts the drawing on a job ----------
    tc, tp, tcid = signup(b, TMX, TMX_DIR, 'tmwerx', f'tm{RUN}@test.co.uk', 'Link Test Traffic')
    tp.goto(TMX + '/app'); tp.wait_for_selector('#nav a')
    check('TM WerX offers CAD WerX drawings once the secret is set', tp.evaluate('B.boot.cadwerx') is True)

    def tapi(method, path, data=None):
        r = tp.request.fetch(TMX + '/api/office' + path, method=method, data=json.dumps(data) if data is not None else None, headers={'Content-Type': 'application/json'} if data is not None else {})
        try:
            return r.status, r.json()
        except Exception:
            return r.status, {}
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('before linking, TM WerX asks for the link code', j.get('results') == [] and 'Link your CAD WerX' in (j.get('error') or ''), j)
    tapi('PUT', '/settings', {'cadwerx_link': 'cwx_' + 'x' * 43})
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('a made-up link code is refused', 'refused the link code' in (j.get('error') or ''), j)
    tapi('PUT', '/settings', {'cadwerx_link': code})
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    res = j.get('results') or []
    check('linked: the sent drawing is found in TM WerX', len(res) == 1 and 'rev B' in res[0]['name'] and 'Otley Road' in res[0]['address'], j)
    st, job = tapi('POST', '/jobs', {'title': 'Lights for the gas main'})
    st, d = tapi('POST', f"/jobs/{job['id']}/cadwerx", {'project': res[0]['id'], 'version': res[0]['version']})
    check('the drawing is copied onto the job', st == 200 and d.get('ok'), (st, d))
    st, J = tapi('GET', f"/jobs/{job['id']}")
    dr = J['drawings'][-1]
    jb = J['job']
    check('with its equipment list', [e['name'] for e in dr['equipment']] == ['Sign 7001: Road works ahead', 'Cones, 450 mm minimum'] and dr['equipment'][1]['qty'] == 30, dr['equipment'])
    check("and the job's empty details filled from the drawing", jb['tm_type'] == '2-way lights' and jb['postcode'] == 'LS6 3AA' and jb['usrn'] == '12345678' and jb['w3w'] == 'index.home.raft' and jb['start_date'] == '2026-11-20', {k: jb[k] for k in ('tm_type', 'postcode', 'usrn', 'w3w', 'start_date', 'address')})
    f = tp.request.get(f"{TMX}/api/office/file/drawing/{dr['id']}")
    csp = f.headers.get('content-security-policy', '')
    check('the sheets are served as a page that cannot run anything', f.status == 200 and f.headers['content-type'].startswith('text/html') and 'sandbox' in csp and 'script-src' not in csp and "default-src 'none'" in csp and f.text().count('<svg') == 2, (f.status, f.headers.get('content-type'), csp))
    # a normal browser (the test sessions above skip page security policies to drive the apps)
    vc = b.new_context(storage_state=tc.storage_state())
    view = vc.new_page(); errs = []
    view.on('console', lambda m: errs.append(m.text))
    view.goto(f"{TMX}/api/office/file/drawing/{dr['id']}"); view.wait_for_timeout(800)
    check('a script hidden in a sheet does not run', view.title() != 'pwned' and view.evaluate("document.querySelectorAll('svg').length") == 2, (view.title(), errs[:2]))
    vc.close()

    # ---------- both subscriptions, every time ----------
    sql(CWX_DIR, 'cadwerx', f"UPDATE companies SET sub_status = 'canceled' WHERE id = '{ccid}'")
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('CAD WerX subscription lapsed: TM WerX says so and gets nothing', j.get('results') == [] and "CAD WerX subscription isn't active" in (j.get('error') or ''), j)
    st, d2 = tapi('POST', f"/jobs/{job['id']}/cadwerx", {'project': res[0]['id'], 'version': res[0]['version']})
    check('and cannot copy another drawing', st >= 400 and "isn't active" in (d2.get('error') or ''), (st, d2))
    check('drawings already on jobs stay', tp.request.get(f"{TMX}/api/office/file/drawing/{dr['id']}").status == 200)
    sql(CWX_DIR, 'cadwerx', f"UPDATE companies SET sub_status = 'active' WHERE id = '{ccid}'")
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('CAD WerX active again: the link works again', len(j.get('results') or []) == 1, j)
    sql(TMX_DIR, 'tmwerx', f"UPDATE companies SET sub_status = 'canceled' WHERE id = '{tcid}'")
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('TM WerX subscription lapsed: no CAD WerX drawings either', st in (401, 403) and not j.get('results'), (st, j))
    sql(TMX_DIR, 'tmwerx', f"UPDATE companies SET sub_status = 'active' WHERE id = '{tcid}'")
    sql(CWX_DIR, 'cadwerx', f"UPDATE companies SET sub_status = 'canceled' WHERE id = '{ccid}'")
    cp.goto(CWX + '/account')
    check('a lapsed CAD WerX company cannot make a link code', cp.locator('#tmwerx button', has_text='Make a link code').count() == 0 and 'An active subscription is needed' in cp.inner_text('#tmwerx'))
    sql(CWX_DIR, 'cadwerx', f"UPDATE companies SET sub_status = 'active' WHERE id = '{ccid}'")

    # ---------- cancelling the code ----------
    cp.goto(CWX + '/account#tmwerx')
    check('the code shows when it was last used', 'Not yet' not in cp.inner_text('#tmwerx'))
    with cp.expect_navigation():
        cp.click('#tmwerx button.danger')
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check('a cancelled code stops working at once', 'refused the link code' in (j.get('error') or ''), j)
    check('the drawing on the job is still there', tp.request.get(f"{TMX}/api/office/file/drawing/{dr['id']}").status == 200)

    # ---------- another company's code shows only its own drawings ----------
    oc, op, ocid = signup(b, CWX, CWX_DIR, 'cadwerx', f'other{RUN}@test.co.uk', 'Other Company')
    op.goto(CWX + '/account')
    with op.expect_navigation():
        op.click('form[action="/account/tm-link"] button')
    code2 = op.input_value('input[aria-label="Link code"]')
    tapi('PUT', '/settings', {'cadwerx_link': code2})
    st, j = tapi('GET', '/cadwerx/search?q=otley')
    check("another company's code shows only that company's drawings", j.get('results') == [], j)
    b.close()

f = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(f)}/{len(results)} passed')
sys.exit(1 if f else 0)
