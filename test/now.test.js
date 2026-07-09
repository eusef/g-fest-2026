/*
 * test/now.test.js — plain Node, no framework, no deps.
 * Run from the repo root:  node test/now.test.js
 * Exits 0 on all-pass, 1 on any failure.
 */
'use strict';

var fs = require('fs');
var N = require('../js/now.js');
var tz = 'America/Chicago';

var events = JSON.parse(fs.readFileSync('data/schedule.json', 'utf8')).events;

var pass = 0;
var fail = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.error('  FAIL: ' + msg);
  }
}

function D(iso) {
  return new Date(iso);
}

// --- Case 1: Fri 1:45 PM ---
(function () {
  var now = D('2026-07-10T13:45:00-05:00');
  var t = now.getTime();
  var hn = N.happeningNow(events, now);
  hn.forEach(function (e) {
    assert(e.type !== 'standing', 'C1 happeningNow excludes standing (' + e.id + ')');
    assert(N.parseInstant(e.start).getTime() <= t && t < N.parseInstant(e.end).getTime(),
      'C1 happeningNow window contains now (' + e.id + ')');
  });
  var un = N.upNext(events, now, tz);
  un.forEach(function (e) {
    assert(N.parseInstant(e.start).getTime() > t, 'C1 upNext starts after now (' + e.id + ')');
    assert(e.day === '2026-07-10', 'C1 upNext is Friday (' + e.id + ')');
    assert(e.type !== 'standing', 'C1 upNext excludes standing (' + e.id + ')');
  });
  assert(un.length <= 8, 'C1 upNext respects default limit 8');
  var st = N.conState(events, now);
  assert(st !== 'pre' && st !== 'post', 'C1 conState is not pre/post (got ' + st + ')');
})();

// --- Case 2: Sat 9:00 AM ---
(function () {
  var now = D('2026-07-11T09:00:00-05:00');
  assert(N.dayKey(now, tz) === '2026-07-11', 'C2 dayKey is Saturday');
  N.upNext(events, now, tz).forEach(function (e) {
    assert(e.day === '2026-07-11', 'C2 upNext all Saturday (' + e.id + ')');
  });
})();

// --- Case 3: Sun 4:00 PM ---
(function () {
  var now = D('2026-07-12T16:00:00-05:00');
  assert(N.dayKey(now, tz) === '2026-07-12', 'C3 dayKey is Sunday');
  N.upNext(events, now, tz).forEach(function (e) {
    assert(e.day === '2026-07-12', 'C3 no upNext event from another day (' + e.id + ')');
  });
})();

// --- Case 4: 3:00 AM Fri (a genuinely dead overnight window) ---
// Note: Sat/Sun small hours are NOT dead — the film festival runs all night
// (e.g. a 2:00-3:22 AM Sat screening), so the quiet overnight is Thu->Fri.
(function () {
  var now = D('2026-07-10T03:00:00-05:00');
  assert(N.happeningNow(events, now).length === 0, 'C4 happeningNow empty at 3AM');
  assert(N.conState(events, now) === 'between', 'C4 conState is between');
  var nx = N.nextUpcomingAny(events, now);
  assert(nx && nx.day === '2026-07-10', "C4 nextUpcomingAny is Friday's first event");
})();

// --- Case 5: Pre-con ---
(function () {
  var now = D('2026-07-09T12:00:00-05:00');
  assert(N.conState(events, now) === 'pre', 'C5 conState is pre');
})();

// --- Case 6: Post-con ---
(function () {
  var now = D('2026-07-13T00:00:00-05:00');
  assert(N.conState(events, now) === 'post', 'C6 conState is post');
})();

// --- Case 7: Timezone safety (same instant, different textual offset) ---
(function () {
  var central = D('2026-07-10T13:45:00-05:00');
  var utc = D('2026-07-10T18:45:00+00:00'); // identical absolute instant
  assert(central.getTime() === utc.getTime(), 'C7 the two spellings are the same instant');
  assert(N.happeningNow(events, central).length === N.happeningNow(events, utc).length,
    'C7 happeningNow bucketing identical regardless of offset spelling');
  assert(N.dayKey(central, tz) === N.dayKey(utc, tz), 'C7 dayKey identical for same instant');
})();

// --- Case 8: openNow at Sat noon ---
(function () {
  var now = D('2026-07-11T12:00:00-05:00');
  var t = now.getTime();
  var on = N.openNow(events, now);
  on.forEach(function (e) {
    assert(e.type === 'standing', 'C8 openNow only standing (' + e.id + ')');
    assert(N.parseInstant(e.start).getTime() <= t && t < N.parseInstant(e.end).getTime(),
      'C8 openNow window contains now (' + e.id + ')');
  });
})();

// --- Bonus: pure formatting sanity (deterministic, tz-locked) ---
(function () {
  assert(N.formatTime(D('2026-07-10T13:45:00-05:00'), tz) === '1:45 PM', 'FMT formatTime 1:45 PM');
  assert(N.formatTimeRange('2026-07-10T10:00:00-05:00', '2026-07-10T11:00:00-05:00', tz) === '10:00 – 11:00 AM',
    'FMT formatTimeRange collapses shared meridiem');
  assert(N.formatTimeRange('2026-07-10T11:30:00-05:00', '2026-07-10T13:00:00-05:00', tz) === '11:30 AM – 1:00 PM',
    'FMT formatTimeRange keeps both meridiems');
  assert(N.formatDayTime(D('2026-07-10T13:45:00-05:00'), tz) === 'Friday 1:45 PM', 'FMT formatDayTime');
})();

console.log('now.test.js: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
