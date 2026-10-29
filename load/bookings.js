// Claim: a room slot is booked at most once.
//
// Asks for the same room and the same hour on every copy, each request sent
// straight to that copy with that copy's own u-1 token. (Through the proxy a
// token only works on the copy that minted it, so the booking would mostly
// bounce off as 401 instead of testing the slot.)
//
//   docker compose run --rm --no-deps k6 run /load/bookings.js \
//     -e TARGETS=http://f26-lab09-api-1:8080,http://f26-lab09-api-2:8080 \
//     -e TOKENS=<api-1 u-1 token>,<api-2 u-1 token>
//
// Fails when more than one request comes back 201 confirmed. The bookings it
// made are cancelled at the end, so the script can be run again.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const TARGETS = (__ENV.TARGETS || '').split(',').filter(Boolean);
const TOKENS = (__ENV.TOKENS || '').split(',').filter(Boolean);
const ROOM = __ENV.ROOM || 'r-1';

const confirmed = new Counter('confirmed_bookings');

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // count<=1 also passes with zero; the check below catches that case.
    confirmed_bookings: ['count<=1'],
    'checks{claim:slot-booked-at-most-once}': ['rate==1'],
  },
};

// Tomorrow at a random whole hour between 07:00 and 20:00 UTC, so reruns on a
// running stack do not trip over an earlier run's booking.
function slotStart() {
  const day = new Date();
  day.setUTCDate(day.getUTCDate() + 1);
  day.setUTCHours(7 + Math.floor(Math.random() * 14), 0, 0, 0);
  return day.toISOString().replace('.000Z', 'Z');
}

export default function () {
  if (TARGETS.length < 1 || TARGETS.length !== TOKENS.length) {
    throw new Error('Pass -e TARGETS=a,b and -e TOKENS=ta,tb, one token per target');
  }
  const start = slotStart();
  const body = { roomId: ROOM, start, minutes: '60' };

  const made = [];
  let confirmedCount = 0;
  TARGETS.forEach((target, i) => {
    const res = http.post(`${target}/bookings`, body, {
      headers: { Authorization: `Bearer ${TOKENS[i]}` },
    });
    const outcome = res.status === 201 || res.status === 202 ? res.json('outcome') : res.body;
    console.log(`${target}  ${ROOM} ${start}  ${res.status} ${outcome}`);
    if (res.status === 201) {
      confirmedCount++;
      confirmed.add(1);
      made.push({ target, token: TOKENS[i], id: res.json('booking.id') });
    }
  });

  check(confirmedCount, {
    'exactly one copy confirmed the slot': (n) => n === 1,
  }, { claim: 'slot-booked-at-most-once' });
  console.log(`confirmed: ${confirmedCount} of ${TARGETS.length} requests for the same slot`);

  for (const b of made) {
    http.del(`${b.target}/bookings/${b.id}`, null, {
      headers: { Authorization: `Bearer ${b.token}` },
    });
  }
}
