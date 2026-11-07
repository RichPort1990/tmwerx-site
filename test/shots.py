"""Screenshots of the real app for the home page (public/img/tm-*.webp), from a demo company made on the local server.
python3 test/shots.py   (expects test/dev.sh running). The people, clients and vans are made up."""
import io, json, os, re, subprocess, time, uuid, urllib.parse, urllib.request
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = os.environ.get('BASE', 'http://localhost:8787')
RUN = str(int(time.time()))
ADMIN = f'demo{RUN}@test.co.uk'
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'public', 'img')
NOW = int(time.time() * 1000)


def get(url):
    with urllib.request.urlopen(url) as r:
        return json.loads(r.read())


def sql(cmd):
    subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'tmwerx', '-c', '.wrangler-test.toml', '--local', '--command', cmd], cwd=os.path.dirname(OUT).rsplit('/public', 1)[0], capture_output=True)


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


def webp(png, path, size):
    im = Image.open(io.BytesIO(png)).convert('RGB')
    if im.size != size:
        im = im.resize(size, Image.LANCZOS)
    im.save(path, 'WEBP', quality=82, method=6)
    print('wrote', path, im.size)


def day(n):
    return time.strftime('%Y-%m-%d', time.localtime(time.time() + n * 86400))


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1600, 'height': 1000}, bypass_csp=True)
    pg = ctx.new_page()
    sql('DELETE FROM attempts')   # local runs repeat sign-ups from one address faster than the real limits allow
    sql(f"INSERT OR IGNORE INTO domain_exempt (email, created_at) VALUES ('{ADMIN}', 0)")
    pg.goto(BASE + '/signup')
    pg.fill('#company', 'Westgate Traffic Management'); pg.fill('#name', 'Claire Dawson'); pg.fill('#email', ADMIN); pg.fill('#password', 'correct horse battery')
    nav(pg, 'main button[type=submit]')
    link = re.search(r'https?://\S+', [m for m in get(BASE + '/dev/outbox') if m['to_addr'] == ADMIN and '/verify?t=' in m['body']][0]['body']).group(0)
    pg.goto(link)
    pg.fill('#signed_name', 'Claire Dawson'); pg.check('input[name=agree]'); nav(pg, 'main button[type=submit]')
    pg.goto(BASE + '/billing'); nav(pg, 'main button[type=submit]'); pg.wait_for_selector('#nav a')

    def api(method, path, data=None, raw=None, headers=None):
        h = dict(headers or {})
        if data is not None:
            h['Content-Type'] = 'application/json'
        return pg.request.fetch(BASE + '/api/office' + path, method=method, data=raw if raw is not None else (json.dumps(data) if data is not None else None), headers=h).json()

    clients = [api('POST', '/clients', {'name': n})['id'] for n in ('Aire Valley Water', 'Northbridge Utilities', 'Kirkgate Civils')]
    vans = [api('POST', '/vehicles', {'reg': r, 'model': m})['id'] for r, m in (('YX70 KLM', 'Transit 350'), ('YB21 TRF', 'Iveco Daily'), ('YH19 WRK', 'Transit 350'))]
    crew = {}
    for name, role in (('Dan Hughes', 'lead'), ('Priya Shah', 'engineer'), ('Tom Walsh', 'lead'), ('Lee Carter', 'engineer'), ('Marek Nowak', 'lead')):
        r = api('POST', '/people', {'name': name, 'username': name.split()[0].lower() + RUN[-4:], 'role': role, 'day_cost': 17500})
        crew[name] = r
    api('POST', '/rules', {'name': 'Hourly check', 'label': 'Whole layout from the advance sign', 'scope': 'company', 'trig': 'repeat', 'every_mins': 60, 'grace_mins': 10})
    PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 842 595]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
    eq = [{'code': '7001', 'name': 'Road works ahead (7001)', 'qty': 2}, {'code': '7010.1', 'name': 'Single file traffic (7010.1)', 'qty': 2}, {'code': 'SIG', 'name': 'Portable signal heads', 'qty': 2},
          {'code': 'C750', 'name': 'Cones 750 mm', 'qty': 24}, {'code': 'LMP', 'name': 'Cone lamps', 'qty': 12}, {'code': 'BAR', 'name': 'Pedestrian barrier 2 m', 'qty': 8}, {'code': 'RMP', 'name': 'Kerb ramps', 'qty': 2}, {'code': 'SB', 'name': 'Sandbags', 'qty': 16}]
    jobs = [
        ('14 Otley Road', 'LS6 3AA', 53.8205, -1.5762, 0, '2-way lights', 'T', [('Dan Hughes', True), ('Priya Shah', False)], 0, 'install_remove', '07:30'),
        ('Kirkstall Lane', 'LS5 3BE', 53.8150, -1.5970, 1, 'Stop/Go', 'T', [('Tom Walsh', True), ('Lee Carter', False)], 1, 'install', '08:00'),
        ('Harehills Road', 'LS8 5HS', 53.8130, -1.5250, 2, 'Lane closure', 'T', [('Marek Nowak', True)], 2, 'check', '10:00'),
        ('Roundhay Road', 'LS8 4DY', 53.8170, -1.5180, 0, 'Give and take', 1, [('Dan Hughes', True), ('Priya Shah', False)], 0, 'install', '08:00'),
        ('Burley Road', 'LS4 2PJ', 53.8040, -1.5770, 1, '3-way lights', 1, [('Tom Walsh', True), ('Lee Carter', False)], 1, 'install_remove', '09:00'),
        ('Chapeltown Road', 'LS7 3HY', 53.8190, -1.5340, 2, 'Road closure', 2, [('Marek Nowak', True), ('Priya Shah', False)], 2, 'install', '06:30'),
        ('Woodhouse Lane', 'LS2 9JT', 53.8060, -1.5520, 0, '2-way lights', 3, [('Dan Hughes', True), ('Lee Carter', False)], 0, 'install_remove', '08:00'),
        ('Kirkstall Lane', 'LS5 3BE', 53.8150, -1.5970, 1, 'Stop/Go', 3, [('Tom Walsh', True)], 1, 'removal', '13:00'),
        ('Street Lane', 'LS8 1BW', 53.8360, -1.5300, 1, 'Lane closure', 4, [('Marek Nowak', True), ('Lee Carter', False)], 2, 'install', '07:00'),
        ('Otley Road', 'LS16 5PL', 53.8400, -1.5960, 2, '2-way lights', 4, [], 0, 'install', '09:30'),
    ]
    made = []
    for i, (addr, pc, lat, lng, cl, tm, d, cw, van, kind, start) in enumerate(jobs):
        j = api('POST', '/jobs', {'address': addr, 'town': 'Leeds', 'postcode': pc, 'lat': lat, 'lng': lng, 'client_id': clients[cl], 'tm_type': tm, 'client_ref': f'WO-{4410 + i}', 'hazards': ['Bus stop or bus route'] if i % 2 == 0 else ['School nearby'], 'client_rate': 42000})
        api('POST', f"/jobs/{j['id']}/drawing?rev=A", raw=PDF, headers={'X-Equipment': urllib.parse.quote(json.dumps(eq))})
        date = day(0) if d == 'T' else day(7 - time.localtime().tm_wday + d)
        v = api('POST', f"/jobs/{j['id']}/visits", {'date': date, 'start_time': start, 'kind': kind, 'vehicle_ids': [vans[van]] if cw else [], 'crew': [{'user_id': crew[n]['id'], 'lead': l} for n, l in cw]})
        if d == 'T' and cw:   # multi-day jobs: daily checks next week too
            for k in (0, 1):
                api('POST', f"/jobs/{j['id']}/visits", {'date': day(7 - time.localtime().tm_wday + k), 'start_time': '07:00', 'kind': 'check', 'vehicle_ids': [vans[van]], 'crew': [{'user_id': crew[n]['id'], 'lead': l} for n, l in cw]})
        if cw:
            api('POST', f"/jobs/{j['id']}/send")
        made.append((j, v, cw, d))

    # two crews already on site today (records sent from their phones)
    def crew_session(name):
        c = b.new_context()
        r = c.request.post(BASE + '/api/crew/login', data=json.dumps({'username': crew[name]['username'], 'password': crew[name]['password']}), headers={'Content-Type': 'application/json'})
        assert r.ok, r.text()
        return c

    def events(c, job, visit, items):
        evs = [{'id': str(uuid.uuid4()), 'kind': k, 'job_id': job['id'], 'visit_id': visit['id'], 'data': dd, 'client_time': NOW - mins * 60000, 'lat': job_lat, 'lng': job_lng, 'acc': 8} for k, mins, dd in items]
        r = c.request.post(BASE + '/api/crew/events', data=json.dumps({'events': evs, 'client_now': int(time.time() * 1000)}), headers={'Content-Type': 'application/json'})
        assert r.ok, r.text()

    today_jobs = [(j, v, cw) for j, v, cw, d in made if cw and d == 'T']
    for idx, (j, v, cw) in enumerate(today_jobs[:2]):
        job_lat, job_lng = jobs[idx][2], jobs[idx][3]
        c = crew_session(cw[0][0])
        dr = api('GET', f"/jobs/{j['id']}")['drawings'][-1]
        steps = [('accepted', 200, {}), ('vehicle_check', 150, {'safe': True, 'items': []}), ('loaded', 140, {'items': eq}), ('ra_signoff', 130, {}), ('drawing_ack', 125, {'drawing_id': dr['id'], 'rev': dr['rev']}), ('signin', 95, {}), ('risk_check', 90, {'matches': True, 'controls': True}), ('started', 85 if idx == 0 else 40, {})]
        if idx == 0:
            steps.append(('installed', 70, {}))
        events(c, j, v, steps)
        c.close()

    # the first crew has taken its arrival and set-up photos
    import random
    from PIL import ImageDraw
    c = crew_session(today_jobs[0][2][0][0])
    J = api('GET', f"/jobs/{today_jobs[0][0]['id']}")
    for t in J['tasks']:
        if t['due_at'] <= NOW and 'advance sign' not in t['label']:
            for k in range(t['count']):
                im = Image.new('RGB', (1200, 900), (random.randint(60, 120), 90, 70)); ImageDraw.Draw(im).text((40, 40), t['label'], fill=(255, 255, 255))
                bb = io.BytesIO(); im.save(bb, 'JPEG')
                meta = {'job_id': J['job']['id'], 'visit_id': t['visit_id'], 'task_id': t['id'], 'category': 'Scheduled', 'taken_at': t['due_at'] + 120000 + k * 20000, 'client_now': int(time.time() * 1000)}
                r = c.request.put(f"{BASE}/api/crew/photo/{uuid.uuid4()}", data=bb.getvalue(), headers={'Content-Type': 'image/jpeg', 'X-Photo': urllib.parse.quote(json.dumps(meta))})
                assert r.ok, r.text()
    c.close()

    # ---------- office screenshots ----------
    nextmon = day(7 - time.localtime().tm_wday)
    pg.goto(BASE + f'/app#board/{nextmon}'); pg.wait_for_selector('.board'); pg.wait_for_timeout(600)
    webp(pg.screenshot(), f'{OUT}/tm-board.webp', (1600, 1000))
    pg.goto(BASE + '/app#live'); pg.wait_for_selector('#view .stats'); pg.wait_for_timeout(800)
    webp(pg.screenshot(), f'{OUT}/tm-live.webp', (1600, 1000))

    # ---------- the crew phone ----------
    lead = today_jobs[0][2][0][0]
    cc = b.new_context(**p.devices['iPhone 13'], geolocation={'latitude': 53.8205, 'longitude': -1.5762}, permissions=['geolocation'], bypass_csp=True)
    ph = cc.new_page()
    ph.goto(BASE + '/crew/'); ph.wait_for_selector('#un')
    ph.fill('#un', crew[lead]['username']); ph.fill('#pw', crew[lead]['password']); ph.click('#go')
    ph.wait_for_selector('.guide'); ph.evaluate("TMDB.put('kv', 1, 'guide')"); ph.click('#skip'); ph.wait_for_selector('a.job')
    ph.evaluate(f"location.hash = 'v/{today_jobs[0][1]['id']}'"); ph.wait_for_selector('[data-step]'); ph.wait_for_timeout(500)
    ph.evaluate("document.querySelector('.card.bad') && document.querySelector('.card.bad').scrollIntoView({block: 'start'}); window.scrollBy(0, -70)")
    webp(ph.screenshot(), f'{OUT}/tm-crew-photos.webp', (780, 1500))
    ph.evaluate("window.scrollTo(0, 0)")
    ph.evaluate("[...document.querySelectorAll('.card h2')].find(h => h.textContent === 'Before you go').scrollIntoView({block: 'start'}); window.scrollBy(0, -70)")
    webp(ph.screenshot(), f'{OUT}/tm-crew-visit.webp', (780, 1500))
    # the load sheet on a visit that has not loaded yet
    later = [v for j, v, cw, d in made if cw and lead in [n for n, _ in cw] and d != 'T']
    ph.evaluate(f"location.hash = 'v/{later[0]['id']}'"); ph.wait_for_selector('[data-step=loaded]')
    ph.click('[data-step=loaded]'); ph.wait_for_selector('.sheet #ld'); ph.wait_for_timeout(300)
    webp(ph.screenshot(), f'{OUT}/tm-crew-load.webp', (780, 1500))
    b.close()
