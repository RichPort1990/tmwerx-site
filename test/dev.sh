#!/bin/sh
# Local test server: the Worker with a mock Stripe, without the tmwerx.co.uk route (wrangler dev would otherwise
# present every request as coming to tmwerx.co.uk). Then run: FRESH=1 python3 test/e2e.py and python3 test/tm.py
cd "$(dirname "$0")/.."
grep -v '^routes' wrangler.toml | sed 's/REPLACE-WITH-THE-ID-FROM-wrangler-d1-create/00000000-0000-0000-0000-000000000000/' > .wrangler-test.toml
test -f .dev.vars || printf 'STRIPE_SECRET_KEY=sk_test_local\nSTRIPE_WEBHOOK_SECRET=whsec_test_local\n' > .dev.vars
python3 test/mock_stripe.py 12111 &
exec npx wrangler dev -c .wrangler-test.toml --local --test-scheduled --port 8787 --inspector-port 9230 --var DEV_MODE:1 \
  --var STRIPE_API_BASE:http://127.0.0.1:12111 --var STRIPE_PRICE_ID:price_test --var ADMIN_EMAILS:ops@test.co.uk --var SIGNUP_ALLOW:@test.co.uk,@ghost.test $EXTRA_VARS
