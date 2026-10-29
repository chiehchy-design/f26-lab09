// Claim: a token works on any request, whichever copy answers it.
//
// Sends one copy's member token through the proxy many times and checks that
// every request is authenticated. Run it with the u-1 token from ONE copy:
//
//   docker compose run --rm --no-deps k6 run /load/tokens.js -e TOKEN=<token>
//
// Fails when any request comes back 401. Also fails if fewer than
// MIN_UPSTREAMS copies answered (default 2), so a run that only ever hit one
// copy cannot pass by accident.
import http from 'k6/http';
import { check } from 'k6';
import { Gauge } from 'k6/metrics';

const PROXY = __ENV.PROXY || 'http://proxy';
const TOKEN = __ENV.TOKEN;
const REQUESTS = Number(__ENV.REQUESTS || 40);
const MIN_UPSTREAMS = Number(__ENV.MIN_UPSTREAMS || 2);

const upstreams = new Gauge('distinct_upstreams');

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    'checks{claim:token-works-on-any-copy}': ['rate==1'],
    distinct_upstreams: [`value>=${MIN_UPSTREAMS}`],
  },
};

export default function () {
  if (!TOKEN) throw new Error('Pass -e TOKEN=<u-1 token from one copy>');

  const byUpstream = {};
  for (let i = 0; i < REQUESTS; i++) {
    const res = http.get(`${PROXY}/bookings`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const upstream = res.headers['X-Upstream'] || 'none';
    byUpstream[upstream] = byUpstream[upstream] || { ok: 0, rejected: 0 };
    byUpstream[upstream][res.status === 200 ? 'ok' : 'rejected']++;

    check(res, { 'token accepted (200)': (r) => r.status === 200 },
      { claim: 'token-works-on-any-copy' });
  }

  upstreams.add(Object.keys(byUpstream).length);
  console.log(`distinct X-Upstream values: ${Object.keys(byUpstream).length}`);
  for (const [upstream, counts] of Object.entries(byUpstream)) {
    console.log(`  ${upstream}  200: ${counts.ok}  other: ${counts.rejected}`);
  }
}
