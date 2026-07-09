/*
 * now.js — PURE now/next/time computation for the G-FEST Pocket Schedule.
 *
 * No DOM. No global clock: every function that needs "now" takes it as an
 * explicit Date argument. Output depends only on inputs, so this file is
 * unit-testable under plain Node (see test/now.test.js).
 *
 * Dual-mode: exposes `module.exports` for Node and `window.GFestNow` for the browser.
 */
(function () {
  'use strict';

  // Normalize the narrow/no-break spaces some ICU builds put before AM/PM
  // so display + tests are predictable ("1:45 PM" with a regular space).
  function normSpaces(s) {
    return s.replace(/[\u202f\u00a0]/g, ' ');
  }

  // new Date(iso) yields the correct absolute instant because the ISO strings
  // carry their -05:00 offset. Never strip the offset.
  function parseInstant(iso) {
    return new Date(iso);
  }

  // Calendar date of an instant *in the con timezone* → "YYYY-MM-DD".
  function dayKey(nowDate, tz) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(nowDate);
  }

  // "1:45 PM" in the con timezone.
  function formatTime(date, tz) {
    return normSpaces(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: '2-digit'
      }).format(date)
    );
  }

  // "1:45 – 2:45 PM" (en-dash). Collapse a shared meridiem: "10:00 – 11:00 AM".
  function formatTimeRange(startIso, endIso, tz) {
    var s = formatTime(parseInstant(startIso), tz); // e.g. "10:00 AM"
    var e = formatTime(parseInstant(endIso), tz);   // e.g. "11:00 AM"
    var sMer = s.slice(-2);
    var eMer = e.slice(-2);
    if (sMer === eMer) {
      return s.slice(0, -3) + ' – ' + e; // drop " AM"/" PM" from the start half
    }
    return s + ' – ' + e;
  }

  // "Friday 1:45 PM" in the con timezone.
  function formatDayTime(date, tz) {
    var wd = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long'
    }).format(date);
    return wd + ' ' + formatTime(date, tz);
  }

  // Non-mutating sort: by start ascending, tie-break by room A→Z.
  function sortEvents(events) {
    return events.slice().sort(function (a, b) {
      var ta = parseInstant(a.start).getTime();
      var tb = parseInstant(b.start).getTime();
      if (ta !== tb) return ta - tb;
      return a.room < b.room ? -1 : a.room > b.room ? 1 : 0;
    });
  }

  // Non-mutating sort: by room A→Z, tie-break by start ascending.
  function sortByRoom(events) {
    return events.slice().sort(function (a, b) {
      if (a.room !== b.room) return a.room < b.room ? -1 : 1;
      return parseInstant(a.start).getTime() - parseInstant(b.start).getTime();
    });
  }

  // Non-standing events whose window contains `now`. Sorted by start/room.
  function happeningNow(events, now) {
    var t = now.getTime();
    return sortEvents(
      events.filter(function (e) {
        return (
          e.type !== 'standing' &&
          parseInstant(e.start).getTime() <= t &&
          t < parseInstant(e.end).getTime()
        );
      })
    );
  }

  // Standing (all-day room-open) windows currently open. Sorted by room.
  function openNow(events, now) {
    var t = now.getTime();
    return sortByRoom(
      events.filter(function (e) {
        return (
          e.type === 'standing' &&
          parseInstant(e.start).getTime() <= t &&
          t < parseInstant(e.end).getTime()
        );
      })
    );
  }

  // Next non-standing events starting after `now`, today (con-tz), soonest first.
  function upNext(events, now, tz, limit) {
    if (limit == null) limit = 8;
    var t = now.getTime();
    var today = dayKey(now, tz);
    var upcoming = events.filter(function (e) {
      return (
        e.type !== 'standing' &&
        e.day === today &&
        parseInstant(e.start).getTime() > t
      );
    });
    return sortEvents(upcoming).slice(0, limit);
  }

  // The single soonest non-standing event starting after `now`, across ALL days.
  function nextUpcomingAny(events, now) {
    var t = now.getTime();
    var upcoming = sortEvents(
      events.filter(function (e) {
        return e.type !== 'standing' && parseInstant(e.start).getTime() > t;
      })
    );
    return upcoming.length ? upcoming[0] : null;
  }

  // Every event on the given calendar day (all types), sorted.
  function eventsForDay(events, dayKeyStr) {
    return sortEvents(
      events.filter(function (e) {
        return e.day === dayKeyStr;
      })
    );
  }

  // Group events that share a start time. Returns [{ key, label, events }],
  // key = start ISO, label = formatTime(start). Input is sorted first.
  function groupByStart(events, tz) {
    var sorted = sortEvents(events);
    var groups = [];
    var cur = null;
    for (var i = 0; i < sorted.length; i++) {
      var e = sorted[i];
      if (!cur || cur.key !== e.start) {
        cur = { key: e.start, label: formatTime(parseInstant(e.start), tz), events: [] };
        groups.push(cur);
      }
      cur.events.push(e);
    }
    return groups;
  }

  // Overall con lifecycle state relative to `now`.
  function conState(events, now) {
    if (!events.length) return 'between';
    var minStart = Infinity;
    var maxEnd = -Infinity;
    for (var i = 0; i < events.length; i++) {
      var s = parseInstant(events[i].start).getTime();
      var en = parseInstant(events[i].end).getTime();
      if (s < minStart) minStart = s;
      if (en > maxEnd) maxEnd = en;
    }
    var t = now.getTime();
    if (t < minStart) return 'pre';
    if (t >= maxEnd) return 'post';
    return happeningNow(events, now).length ? 'live' : 'between';
  }

  var api = {
    parseInstant: parseInstant,
    dayKey: dayKey,
    formatTime: formatTime,
    formatTimeRange: formatTimeRange,
    formatDayTime: formatDayTime,
    sortEvents: sortEvents,
    happeningNow: happeningNow,
    openNow: openNow,
    upNext: upNext,
    nextUpcomingAny: nextUpcomingAny,
    eventsForDay: eventsForDay,
    groupByStart: groupByStart,
    conState: conState
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.GFestNow = api;
})();
