"""End-to-end test of TM WerX against `wrangler dev` (local D1/R2) and the mock Stripe server (test/dev.sh).
The office app in a desktop browser, the crew app on an emulated iPhone, including a stretch with no signal.
python3 test/tm.py   (CONSOLE=1 prints browser errors; SHOTS=dir saves screenshots for the home page)"""
import io, json, os, re, subprocess, sys, time, urllib.parse, urllib.request, zipfile
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = os.environ.get('BASE', 'http://localhost:8787')
RUN = str(int(time.time()))
ADMIN = f'boss{RUN}@test.co.uk'
SHOTS = os.environ.get('SHOTS')
SITE = {'lat': 53.8104, 'lng': -1.5711}   # Cardigan Road, Leeds
results = []
errors = []


def check(name, ok, detail=''):
    results.append((name, bool(ok)))
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  ' + str(detail)[:400]))


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def mail(to, needle):
    return [m for m in get(BASE + '/dev/outbox') if m['to_addr'] == to and needle in (m['subject'] + m['body'])]


def code_for(to):
    ms = [m for m in get(BASE + '/dev/outbox') if m['to_addr'] == to and 'sign-in code' in m['subject']]
    return re.search(r'\b(\d{6})\b', ms[0]['body']).group(1) if ms else None


def nav(page, sel):
    try:
        with page.expect_navigation(wait_until='load', timeout=20000):
            page.click(sel)
    except Exception as e:
        if 'Timeout' not in str(e):
            raise
    if page.url.endswith('/login/code'):
        to = re.search(r'<b>([^<]+)</b> has signed in', page.content()).group(1)
        page.fill('#code', code_for(to))
        nav(page, 'main form button[type=submit]')


def sql(cmd):
    return subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'tmwerx', '-c', '.wrangler-test.toml', '--local', '--json', '--command', cmd],
                          cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))), capture_output=True, text=True).stdout


def cron(expr='*+*+*+*+*'):
    with urllib.request.urlopen(BASE + '/__scheduled?cron=' + expr) as r:
        return r.status


def jpeg(text, color=(200, 120, 40)):
    im = Image.new('RGB', (2400, 1800), color)
    ImageDraw.Draw(im).text((60, 60), text, fill=(255, 255, 255))
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=85)
    path = f'/tmp/tm-{abs(hash(text))}.jpg'
    open(path, 'wb').write(b.getvalue())
    return path


PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'


def drained(page, timeout=30):
    # wait until the phone has sent everything (TMDB calls return promises, so poll from here)
    end = time.time() + timeout
    while time.time() < end:
        if page.evaluate("Promise.all([TMDB.count('outbox'), TMDB.count('photos')])") == [0, 0]:
            return True
        time.sleep(0.5)
    return False


def watch(page, who):
    page.on('console', lambda m: m.type == 'error' and errors.append(f'{who}: {m.text[:200]}'))
    page.on('pageerror', lambda e: errors.append(f'{who} pageerror: {str(e)[:300]}'))


with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- public pages ----------
    ctx = b.new_context(viewport={'width': 1400, 'height': 900}, bypass_csp=True)
    pg = ctx.new_page()
    watch(pg, 'office')
    c = pg.goto(BASE + '/') and pg.content()
    check('home page is TM WerX with demo, pricing and crew link', all(k in c for k in ('TM Wer<span>X', 'Book a demo', 'id="pricing"', 'href="/crew/"', '£100')) and 'CAD Wer<span>X</span></a>' not in c)
    for path, word in (('/terms', 'crew app'), ('/privacy', 'latest position')):
        r = pg.goto(BASE + path)
        check(f'{path} is the TM WerX draft', r.status == 200 and word in pg.content() and 'TM WerX' in pg.content())

    # ---------- sign up, verify, agree, pay ----------
    sql('DELETE FROM attempts')   # local runs repeat sign-ups from one address faster than the real limits allow
    sql(f"INSERT OR IGNORE INTO domain_exempt (email, created_at) VALUES ('{ADMIN}', 0)")   # a fresh company each run on the same test domain
    pg.goto(BASE + '/signup')
    pg.fill('#company', 'Acme Traffic Ltd'); pg.fill('#name', 'Jo Boss'); pg.fill('#email', ADMIN); pg.fill('#password', 'correct horse battery')
    nav(pg, 'main button[type=submit]')
    link = re.search(r'https?://\S+', mail(ADMIN, '/verify?t=')[0]['body']).group(0)
    pg.goto(link)
    pg.fill('#signed_name', 'Jo Boss'); pg.check('input[name=agree]'); nav(pg, 'main button[type=submit]')
    pg.goto(BASE + '/billing'); nav(pg, 'main button[type=submit]'); pg.wait_for_load_state()
    check('after payment the office app opens', '/app' in pg.url, pg.url)
    pg.wait_for_selector('#nav a', timeout=10000)
    pg.wait_for_selector('#view .stats', timeout=10000)
    check('office app shows the Live screen and navigation', 'Live' in pg.inner_text('#view') and pg.locator('#nav a').count() >= 14)
    boot = pg.evaluate('B.boot')
    check('starter documents are drafts and starter photo rules exist', len(boot['docs']) == 4 and not any(d['reviewed_at'] for d in boot['docs']) and len(boot['rules']) == 3)
    check('company has a private job request address', re.match(r'^jobs\+[a-z0-9x]{6,}@', boot['intake_address'] or ''), boot['intake_address'])

    def api(method, path, data=None, raw=None, headers=None):
        h = dict(headers or {})
        if data is not None:
            h['Content-Type'] = 'application/json'
        r = pg.request.fetch(BASE + '/api/office' + path, method=method, data=raw if raw is not None else (json.dumps(data) if data is not None else None), headers=h)
        try:
            return r.json()
        except Exception:
            return {'status': r.status}

    # ---------- set up: client, van, crew, job, drawing, visit ----------
    cl = api('POST', '/clients', {'name': 'Northern Gas', 'deduction_per_day': 2500})
    van = api('POST', '/vehicles', {'reg': 'yx70 abc', 'model': 'Transit', 'mot_due': time.strftime('%Y-%m-%d', time.gmtime(time.time() + 10 * 86400))})
    lead = api('POST', '/people', {'name': 'Sam Lead', 'username': f'sam{RUN}', 'role': 'lead', 'phone': '07700900123', 'day_cost': 18000})
    check('crew login made with a username and a word password', lead.get('ok') and re.match(r'^[a-z]+-[a-z]+-\d{3}$', lead.get('password', '')), lead)
    dup = api('POST', '/people', {'name': 'Other', 'username': f'sam{RUN}'})
    check('usernames are unique', not dup.get('ok') and 'taken' in dup.get('error', ''))
    api('POST', f"/people/{lead['id']}/quals", {'name': 'NHSS 12D T2', 'number': 'A1', 'expires': '2020-01-01'})
    rule = api('POST', '/rules', {'name': 'Client hourly', 'label': 'Layout from the advance sign', 'scope': 'client', 'scope_ref': cl['id'], 'trig': 'repeat', 'every_mins': 60, 'grace_mins': 10})
    check('client photo rule saved', rule.get('ok'), rule)
    job = api('POST', '/jobs', {'address': '12 Cardigan Road', 'town': 'Leeds', 'postcode': 'ls6 1lf', 'lat': SITE['lat'], 'lng': SITE['lng'], 'client_id': cl['id'], 'tm_type': '2-way lights', 'client_ref': 'NG-4471', 'hazards': ['Bus stop or bus route'], 'charge_basis': 'daily', 'client_rate': 45000, 'instructions': 'Keep the bus stop open.'})
    check('job gets a number', job.get('ok') and re.match(r'^TM-\d{4}-0001$', job['number']), job)
    jid = job['id']
    eq = [{'code': '7001', 'name': 'Sign 7001 Road works ahead', 'qty': 2}, {'code': 'C750', 'name': 'Cone 750 mm', 'qty': 20}]
    d = api('POST', f'/jobs/{jid}/drawing?rev=A&no=CW-1', raw=PDF, headers={'X-Equipment': urllib.parse.quote(json.dumps(eq))})
    check('drawing PDF stored with a fingerprint', d.get('ok') and len(d.get('sha256', '')) == 64, d)
    notpdf = api('POST', f'/jobs/{jid}/drawing?rev=B', raw=b'hello')
    check('a file that is not a PDF is refused', not notpdf.get('ok'))
    today = time.strftime('%Y-%m-%d')
    vis = api('POST', f'/jobs/{jid}/visits', {'date': today, 'start_time': '08:00', 'kind': 'install_remove', 'vehicle_ids': [van['id']], 'crew': [{'user_id': lead['id'], 'lead': True}]})
    check('visit added, with a warning for the expired card', vis.get('ok') and any('expired' in w for w in vis.get('warn', [])), vis)
    vid = vis['id']
    sent = api('POST', f'/jobs/{jid}/send')
    check('job sent to the crew', sent.get('ok'), sent)

    # office screens render
    for h, word in (('board', 'Board'), (f'job/{jid}/visits', 'Sam Lead'), (f'job/{jid}/drawing', 'Equipment to load'), ('crew', 'Sam Lead'), ('vehicles', 'YX70 ABC'), ('rules', 'Client hourly'), ('docs/ra', 'DRAFT'), ('settings', 'Sign-in distance'), ('requests', 'jobs+'), ('time', 'Timesheets'), ('costs', 'Margin'), ('safety', 'Near misses')):
        pg.evaluate(f"location.hash = '{h}'")
        try:
            pg.wait_for_function(f"document.querySelector('#view').innerText.includes({json.dumps(word)})", timeout=25000)
            ok = True
        except Exception:
            ok = False
        check(f'office screen #{h} shows "{word}"', ok, pg.inner_text('#view')[:300])
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)

    # ---------- the crew phone ----------
    iphone = p.devices['iPhone 13']
    cctx = b.new_context(**iphone, geolocation={'latitude': SITE['lat'], 'longitude': SITE['lng']}, permissions=['geolocation'], bypass_csp=True)
    ph = cctx.new_page()
    watch(ph, 'crew')
    ph.goto(BASE + '/crew/')
    ph.wait_for_selector('#un')
    ph.fill('#un', 'nobody'); ph.fill('#pw', 'wrong'); ph.click('#go')
    ph.wait_for_function("document.querySelector('#err').textContent.length > 0")
    check('wrong crew password refused', "don't match" in ph.inner_text('#err'), ph.inner_text('#err'))
    ph.fill('#un', f'SAM{RUN}'); ph.fill('#pw', lead['password']); ph.click('#go')
    ph.wait_for_selector('.guide', timeout=10000)
    check('first sign-in shows how to add the app to the home screen (iPhone)', 'Add to Home Screen' in ph.inner_text('#v') and 'Safari' in ph.inner_text('#v'))
    ph.click('#skip')
    ph.wait_for_selector('a.job')
    check("today's job is on the phone, marked New", 'TM-' in ph.inner_text('#v') and 'New' in ph.inner_text('#v') and '12 Cardigan Road' in ph.inner_text('#v'))
    check('office API refuses a crew login', ph.request.get(BASE + '/api/office/boot').status == 401)
    sw = ph.evaluate("navigator.serviceWorker.ready.then(r => !!r.active)")
    check('service worker installed for offline use', sw)
    ph.click('a.job')
    ph.wait_for_selector('[data-step=accepted]')
    check('visit screen lists the steps', all(k in ph.inner_text('#v') for k in ('Vehicle check', 'Load the van', 'RAMS', 'Check the drawing', 'Sign in on site', 'Start work', 'Count the kit back')))
    check('start is blocked until the RAMS and site check are done', ph.is_disabled('[data-step=started]'))

    def sign(page):
        page.locator('#sig').scroll_into_view_if_needed()
        box = page.locator('#sig').bounding_box()
        page.mouse.move(box['x'] + 20, box['y'] + 40); page.mouse.down()
        for i in range(30):
            page.mouse.move(box['x'] + 20 + i * 8, box['y'] + 40 + (i % 5) * 12)
        page.mouse.up()

    def step(name):
        ph.click(f'[data-step={name}]')

    step('accepted'); ph.wait_for_selector('.step.done')
    step('vehicle_check'); ph.wait_for_selector('.sheet #veh')
    ph.click('.sheet input[name=i0][value=defect] + span'); ph.fill('.sheet .note[data-i="0"]', 'Nearside front worn')
    sign(ph); ph.click('.sheet #ok')
    ph.wait_for_selector('.sheet #cam')
    with ph.expect_file_chooser() as fc:
        ph.click('.sheet #cam')
    fc.value.set_files(jpeg('defect'))
    ph.wait_for_function("document.querySelector('.sheet #pc') && document.querySelector('.sheet #pc').textContent.includes('saved')")
    ph.click('.sheet #fin')
    step('loaded'); ph.wait_for_selector('.sheet #ld')
    q = ph.eval_on_selector_all('.sheet #ld input[type=number]', 'els => els.map(e => +e.value)')
    check('loading list from the drawing with 10% spares', q == [2, 22], q)
    ph.click('.sheet #ok')
    step('ra_signoff'); ph.wait_for_selector('.sheet #rd')
    check('RAMS shows DRAFT wording and the job hazards', 'DRAFT' in ph.inner_text('.sheet') and 'Bus stop' in ph.inner_text('.sheet'))
    ph.check('.sheet #rd'); sign(ph); ph.click('.sheet #ok')
    step('drawing_ack'); ph.wait_for_selector('.sheet #op')
    href = ph.get_attribute('.sheet #op', 'href')
    r = ph.request.get(BASE + href)
    check('crew can open the drawing PDF', r.status == 200 and r.body().startswith(b'%PDF'))
    ph.evaluate("document.querySelector('.sheet #op').dispatchEvent(new Event('click'))")   # opening it unlocks the confirm button
    ph.click('.sheet #ok')
    ph.wait_for_function("!document.querySelector('.sheet')")

    # ---------- no signal ----------
    cctx.set_offline(True)
    ph.wait_for_function("document.querySelector('#net').textContent.includes('No signal')")
    step('signin'); ph.wait_for_selector('.sheet #ok', timeout=20000)
    check('at the site: no reason asked', not ph.query_selector('.sheet #why'))
    lone = ph.query_selector('.sheet #lone')
    if lone:
        lone.uncheck()
    ph.click('.sheet #ok')
    ph.wait_for_selector('[data-task]')
    check('arrival photos are due straight away, worked out on the phone with no signal', 'Site on arrival' in ph.inner_text('#v'))
    ph.click('[data-task]')
    for n in range(2):
        with ph.expect_file_chooser() as fc:
            ph.click('.sheet #cam')
        fc.value.set_files(jpeg(f'arrival {n}', (60, 90, 160)))
        if n == 0:
            ph.wait_for_function("document.querySelector('.sheet #pc').textContent.startsWith('1 of 2')")
    ph.wait_for_function("!document.querySelector('.sheet')")
    step('risk_check'); ph.wait_for_selector('.sheet #x')
    ph.click('.sheet input[name=m][value=no] + span'); ph.fill('.sheet #x', 'Skip parked in the taper'); ph.click('.sheet #ok')
    ph.wait_for_selector('.sheet #cam'); ph.click('.sheet #fin')
    ph.wait_for_selector('.sheet'); ph.click('.sheet [data-close]')
    waiting = ph.evaluate("Promise.all([TMDB.count('outbox'), TMDB.count('photos')])")
    check('records and photos wait on the phone with no signal', waiting[0] >= 2 and waiting[1] == 2, waiting)
    check('the phone says what is waiting to send', 'waiting to send' in ph.inner_text('#sendbar'))
    if SHOTS:
        ph.screenshot(path=f'{SHOTS}/crew-visit.png', full_page=False)

    # ---------- signal back ----------
    cctx.set_offline(False)
    check('everything sent once signal is back', drained(ph))
    J = api('GET', f'/jobs/{jid}')
    kinds = [e['kind'] for e in J['events']]
    check('office has the records in order', kinds[:6] == ['accepted', 'vehicle_check', 'loaded', 'ra_signoff', 'drawing_ack', 'signin'], kinds)
    check('photos arrived with fingerprints, the vehicle defect photo linked to its check', len(J['photos']) == 3 and all(len(x['sha256']) == 64 for x in J['photos']) and any(x['vehicle_id'] and x['event_id'] for x in J['photos']), len(J['photos']))
    arr = [t for t in J['tasks'] if 'arrival' in t['label'].lower()]
    check('arrival photo task done on time (taken offline, sent later)', arr and arr[0]['status'] == 'done' and arr[0]['late'] == 0, arr)
    sig = [e for e in J['events'] if e['kind'] == 'ra_signoff'][0]
    check('RAMS signature stored', sig['signed'] == 1 and pg.request.get(f"{BASE}/api/office/file/signature/{sig['id']}").headers['content-type'] == 'image/png')
    al = api('GET', '/alerts')['alerts']
    check('site check raised an alert for the office', any(a['kind'] == 'site_differs' and 'Skip parked' in (a['detail'] or '') for a in al), [a['kind'] for a in al])
    check('vehicle defect raised an alert', any(a['kind'] == 'vehicle_defect' for a in al))
    check('phone clock offset recorded with the records', all(e['skew'] is not None for e in J['events']))

    # ---------- the rest of the day ----------
    ph.reload(); ph.wait_for_selector('[data-step=started]')
    step('started'); ph.wait_for_selector('[data-step=installed]:not([disabled])')
    step('installed')
    ph.wait_for_function("document.querySelector('#v').innerText.includes('Completed layout')")
    ph.click('[data-task]')
    for n in range(2):
        with ph.expect_file_chooser() as fc:
            ph.click('.sheet #cam')
        fc.value.set_files(jpeg(f'setup {n}', (40, 140, 60)))
        if n == 0:
            ph.wait_for_function("document.querySelector('.sheet #pc').textContent.startsWith('1 of 2')")
    ph.wait_for_function("!document.querySelector('.sheet')")
    ph.click('[data-x=near_miss]'); ph.fill('.sheet #t', 'Van clipped a cone at speed'); ph.click('.sheet #ok2')
    step('returned'); ph.wait_for_selector('.sheet #ld')
    ph.fill('.sheet #ld tr:nth-child(2) input[type=number]', '19'); ph.click('.sheet #ok')
    ph.wait_for_function("!document.querySelector('.sheet')")
    step('complete'); ph.wait_for_selector('.sheet #sig')
    ph.click('.sheet input[name=f][value=yes] + span'); sign(ph); ph.click('.sheet #ok')
    ph.wait_for_function("document.querySelector('#v').innerText.includes('Site clear after removal')")
    ph.click('[data-task]')
    for n in range(2):
        with ph.expect_file_chooser() as fc:
            ph.click('.sheet #cam')
        fc.value.set_files(jpeg(f'clear {n}', (90, 90, 90)))
        if n == 0:
            ph.wait_for_function("document.querySelector('.sheet #pc').textContent.startsWith('1 of 2')")
    ph.wait_for_function("!document.querySelector('.sheet')")
    step('signout')
    check('the rest of the day sent', drained(ph))
    J = api('GET', f'/jobs/{jid}')
    al = api('GET', '/alerts')['alerts']
    check('count-back shortfall raised an alert', any(a['kind'] == 'kit_missing' and '3 × Cone 750 mm' in (a['detail'] or '') for a in al), [a['detail'] for a in al if a['kind'] == 'kit_missing'])
    check('near miss raised an alert and a safety action', any(a['kind'] == 'near_miss' for a in al) and any('Van clipped' in x['title'] for x in api('GET', '/safety')['actions']))
    check('job finished and the visit waits for review', J['job']['status'] == 'completed' and J['visits'][0]['review'] == 'pending', (J['job']['status'], J['visits'][0]['review']))
    done = {t['label']: t['status'] for t in J['tasks']}
    check('every event photo task done', all(s == 'done' for lbl, s in done.items() if 'advance sign' not in lbl), done)
    check('hourly photos after the finish are no longer owed', not [t for t in J['tasks'] if 'advance sign' in t['label'] and t['due_at'] > max(e['client_time'] or 0 for e in J['events'] if e['kind'] == 'job_complete')])
    rv = api('POST', f'/visits/{vid}/review', {'decision': 'approved'})
    check('office approves the visit', rv.get('ok'))
    t = api('GET', f'/time?from={today}&to={today}')
    check('timesheet from sign-in to sign-out', len(t['shifts']) == 1 and t['shifts'][0]['end'], t.get('shifts'))
    cs = api('GET', f'/costs?from={today}&to={today}')
    check('costs: day rate less crew cost and client deduction', cs['rows'] and cs['rows'][0]['income'] == 45000 and cs['rows'][0]['labour'] == 18000 and cs['rows'][0]['margin'] == 45000 - 18000 - 2500, cs.get('rows'))

    # ---------- packs, downloads and sharing ----------
    pack = pg.request.get(f'{BASE}/api/office/jobs/{jid}/pack').text()
    check('evidence pack has the job, signatures, photo schedule and fingerprints', all(k in pack for k in (job['number'], '/file/signature/', 'Site on arrival', 'SHA-256')) and 'DRAFT' in pack)
    z = pg.request.get(f'{BASE}/api/office/jobs/{jid}/zip')
    zf = zipfile.ZipFile(io.BytesIO(z.body()))
    names = zf.namelist()
    check('job zip has the record, drawing and every photo', 'job.json' in names and any(n.endswith('.pdf') for n in names) and len([n for n in names if n.endswith('.jpg')]) == 7 and zf.testzip() is None, names)
    sh = api('POST', f'/jobs/{jid}/share', {'days': 7})
    anon = b.new_context()
    ap = anon.new_page()
    r = ap.goto(BASE + sh['url'])
    check('share link shows the job record without signing in', r.status == 200 and job['number'] in ap.content())
    api('POST', f'/jobs/{jid}/share', {'off': True})
    check('share link can be switched off', ap.goto(BASE + sh['url']).status == 404)
    check('office files need a sign-in', ap.request.get(f"{BASE}/api/office/file/photo/{J['photos'][0]['id']}").status == 401)
    anon.close()

    # ---------- job requests ----------
    rq = api('POST', '/requests', {'source': 'paste', 'text': 'Hi, can you do 2-way lights at 14 Otley Road, Leeds LS6 3AA on 12/11/2026 starting 9:30am? Ref PO-88123. Site contact Dave 07700 900456'})
    ex = rq.get('extracted', {})
    check('pasted request read: postcode, type, date, time, ref', ex.get('postcode') == 'LS6 3AA' and ex.get('tm_type') == '2-way lights' and ex.get('start_date') == '2026-11-12' and ex.get('start_time') == '09:30' and ex.get('client_ref') == 'PO-88123', ex)
    again = api('POST', '/requests', {'source': 'paste', 'text': 'Hi, can you do 2-way lights at 14 Otley Road, Leeds LS6 3AA on 12/11/2026 starting 9:30am? Ref PO-88123. Site contact Dave 07700 900456'})
    check('the same request twice is flagged as a duplicate', again.get('duplicate_of') == rq.get('id'))
    raw = f"From: Dave <dave@client.test>\r\nTo: {boot['intake_address']}\r\nMessage-ID: <{RUN}@client.test>\r\nDate: Sat, 07 Nov 2026 10:00:00 +0000\r\nSubject: Stop/Go needed\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nStop/Go at 3 Kirkstall Lane, Leeds LS5 3BE on 20/11/2026=0D=0AThanks\r\n"
    try:
        er = pg.request.post(f"{BASE}/cdn-cgi/handler/email?from=dave@client.test&to={urllib.parse.quote(boot['intake_address'])}", data=raw, headers={'Content-Type': 'message/rfc822'})
        st = er.status
    except Exception as e:
        st = str(e)
    reqs = api('GET', '/requests')['requests']
    em = [x for x in reqs if x['source'] == 'email']
    check('a forwarded email becomes a job request', em and em[0]['extracted'].get('postcode') == 'LS5 3BE' and em[0]['extracted'].get('tm_type') == 'Stop/Go', (st, [x['source'] for x in reqs]))

    # ---------- alarms and the cron ----------
    ph.goto(BASE + f'/crew/#v/{vid}'); ph.wait_for_selector('#panic')
    ph.click('#panic'); ph.click('.sheet #go')
    ph.wait_for_function("document.querySelector('.sheet') && document.querySelector('.sheet').innerText.includes('Alarm sent')", timeout=15000)
    al = api('GET', '/alerts')['alerts']
    check('panic alarm: urgent alert with position and phone number', any(a['kind'] == 'panic' and a['level'] == 'urgent' and '07700900123' in a['detail'] and '53.81' in a['detail'] for a in al))
    check('panic alarm emailed to the office', mail(ADMIN, 'panic alarm'))
    check('cron runs', cron() == 200 and cron('17+3+*+*+SUN') == 200)
    dl = api('GET', '/alerts')['alerts']
    check('daily check: expired qualification flagged', any(a['kind'] in ('qual_expired', 'qual_expiring') or 'NHSS' in a['title'] for a in dl), [a['title'] for a in dl])

    # ---------- people and permissions ----------
    rs = api('POST', f"/people/{lead['id']}/reset")
    check('crew password reset signs the phone out', rs.get('ok') and ph.request.get(BASE + '/api/crew/sync').status == 401)
    other = api('GET', '/jobs/not-a-job')
    check('unknown job is not found', not other.get('ok'))
    ex = pg.request.get(BASE + '/api/office/export')
    check('export downloads every table', ex.status == 200 and 'tm_events' in ex.json()['tables'])

    if SHOTS:
        pg.evaluate("location.hash = 'board'"); pg.wait_for_timeout(800); pg.screenshot(path=f'{SHOTS}/board.png')
        pg.evaluate("location.hash = 'live'"); pg.wait_for_timeout(800); pg.screenshot(path=f'{SHOTS}/live.png')
    b.close()

bad = [e for e in errors if 'favicon' not in e and 'ERR_INTERNET_DISCONNECTED' not in e and 'Failed to fetch' not in e and '401' not in e and '404' not in e]
check('no script errors in either app', not bad, bad[:5])
f = [n for n, ok in results if not ok]
print(f'\n{len(results) - len(f)}/{len(results)} passed')
sys.exit(1 if f else 0)
