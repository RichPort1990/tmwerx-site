"""A tiny stand-in for the Stripe API, enough for the planner's checkout, subscription and seat calls."""
import json, sys, time, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer as HTTPServer
S = {'sessions': {}, 'subs': {}, 'log': [], 'customers': {}}
def sub_obj(sid):
    s = S['subs'][sid]
    return {'id': sid, 'object': 'subscription', 'customer': s['customer'], 'status': s['status'], 'cancel_at_period_end': False,
            'current_period_end': int(time.time()) + 30 * 86400, 'metadata': {'company_id': s['company']},
            'items': {'data': [{'id': 'si_' + sid[4:], 'quantity': s['qty']}]}}
class H(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'   # keep-alive, as the real API
    def log_message(self, *a): pass
    def send(self, o, code=200):
        b = json.dumps(o).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = urllib.parse.urlparse(self.path); parts = p.path.strip('/').split('/')
        S['log'].append(['GET', p.path, p.query])
        if p.path == '/__log': return self.send(S['log'])
        if p.path == '/__state': return self.send({'subs': S['subs']})
        q = dict(urllib.parse.parse_qsl(p.query))
        if parts == ['v1', 'checkout', 'sessions']: return self.send({'object': 'list', 'data': []})   # sessions complete at once here
        if parts == ['v1', 'subscriptions']: return self.send({'object': 'list', 'data': [sub_obj(k) for k, v in S['subs'].items() if v['customer'] == q.get('customer')]})
        if parts[:3] == ['v1', 'checkout', 'sessions']:
            s = S['sessions'].get(parts[3]);
            if not s: return self.send({'error': {'message': 'No such session'}}, 404)
            return self.send({'id': parts[3], 'client_reference_id': s['company'], 'customer': s['customer'], 'mode': 'subscription', 'subscription': sub_obj(s['sub']) if 'expand' in p.query else s['sub']})
        if parts[:2] == ['v1', 'subscriptions']: return self.send(sub_obj(parts[2]))
        self.send({'error': {'message': 'not mocked'}}, 404)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n).decode()
        f = dict(urllib.parse.parse_qsl(body)); p = self.path; parts = p.strip('/').split('/')
        S['log'].append(['POST', p, f])
        if p == '/__set':   # test hook: change a subscription as if in the Stripe dashboard
            S['subs'][f['sub']]['status'] = f['status']; return self.send({'ok': True})
        if self.headers.get('Authorization') != 'Bearer sk_test_local': return self.send({'error': {'message': 'bad key'}}, 401)
        if p == '/v1/customers':
            cus = f'cus_{len(S["customers"]) + 1}'; S['customers'][cus] = f; return self.send({'id': cus})
        if p == '/v1/checkout/sessions':
            k = len(S['sessions']) + 1; cs = f'cs_test_{k}'; sub = f'sub_{k}'; cus = f.get('customer') or f'cus_{k}'
            S['sessions'][cs] = {'company': f['client_reference_id'], 'customer': cus, 'sub': sub}
            S['subs'][sub] = {'customer': cus, 'status': 'active', 'qty': int(f['line_items[0][quantity]']), 'company': f['client_reference_id']}
            return self.send({'id': cs, 'url': f['success_url'].replace('{CHECKOUT_SESSION_ID}', cs)})
        if parts[:2] == ['v1', 'subscription_items']:
            sid = 'sub_' + parts[2][3:]; S['subs'][sid]['qty'] = int(f['quantity']); return self.send({'id': parts[2], 'quantity': int(f['quantity'])})
        if p == '/v1/billing_portal/sessions': return self.send({'url': f['return_url']})
        self.send({'error': {'message': 'not mocked'}}, 404)
    def do_DELETE(self):
        p = self.path; parts = p.strip('/').split('/'); S['log'].append(['DELETE', p, {}])
        if self.headers.get('Authorization') != 'Bearer sk_test_local': return self.send({'error': {'message': 'bad key'}}, 401)
        if parts[:2] == ['v1', 'subscriptions'] and parts[2] in S['subs']: S['subs'][parts[2]]['status'] = 'canceled'; return self.send(sub_obj(parts[2]))
        self.send({'error': {'message': 'not mocked'}}, 404)
HTTPServer(('127.0.0.1', int(sys.argv[1]) if len(sys.argv) > 1 else 12111), H).serve_forever()
