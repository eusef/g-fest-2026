/*
 * app.js — data load, hash routing, rendering, favorites, refresh, SW registration.
 * Depends on js/now.js (window.GFestNow). Renders entirely from data/schedule.json
 * plus the injectable "now" — no event/day/room specifics are hardcoded (AC7).
 */
(function () {
  'use strict';

  var N = window.GFestNow;
  var DEFAULT_TZ = 'America/Chicago';
  var FAV_KEY = 'gfest:favorites';

  // Canonical track ordering for the filter UI; unknown tracks sort after, alpha.
  var TRACK_ORDER = ['Panels', 'Model', 'Gaming', 'Cosplay', 'Screening', 'Exhibit', 'Event', 'Registration'];
  // Muted-steel track palette (matches css/styles.css --track-* tokens). The pill
  // label carries the track name; color stays quiet against the dark surfaces.
  var TRACK_COLORS = {
    Panels: '#6E93B8', Model: '#9182B0', Gaming: '#6F9576', Cosplay: '#B67E92',
    Screening: '#BE9A61', Exhibit: '#5E9AA1', Event: '#CA6B49', Registration: '#7E8894'
  };
  var TRACK_DEFAULT = '#6D7885';

  // Session-only UI state (need not persist).
  var browseDay = null;
  var selTracks = new Set();
  var selRooms = new Set();

  // Signature of the last-rendered Now state, so the 30s tick only re-renders
  // the Now view when an event actually enters/leaves a bucket (not every tick).
  var lastNowSig = null;

  var App = {
    data: null,
    loadError: false,
    favorites: loadFavorites(),
    getNow: function () {
      return (typeof window !== 'undefined' && window.__NOW__) ? window.__NOW__ : new Date();
    },
    toggleFav: toggleFav,
    exportFavorites: exportFavorites,
    importText: importFavoritesFromText
  };
  window.App = App;

  /* ------------------------------------------------------------------ utils */

  function tz() { return App.data ? App.data.meta.timezone : DEFAULT_TZ; }
  function trackColor(t) { return TRACK_COLORS[t] || TRACK_DEFAULT; }

  function hexToRgba(hex, a) {
    var h = hex.replace('#', '');
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  }

  function weekday(date) {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz(), weekday: 'long' }).format(date);
  }
  function fullDate(date) {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz(), weekday: 'long', month: 'long', day: 'numeric'
    }).format(date);
  }

  // Tiny DOM builder. attrs values set via setAttribute (safe for aria-*, href, data-*);
  // `text` sets textContent (no HTML injection). kids may be nodes/strings/null.
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (attrs[k] == null) return;
        if (k === 'text') n.textContent = attrs[k];
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (kids != null) {
      (Array.isArray(kids) ? kids : [kids]).forEach(function (c) {
        if (c == null) return;
        n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return n;
  }

  function viewEl() { return document.getElementById('view'); }

  /* -------------------------------------------------------------- favorites */

  function loadFavorites() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (e) { return new Set(); }
  }
  function saveFavorites() {
    try { localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(App.favorites))); } catch (e) {}
  }
  function toggleFav(id) {
    if (App.favorites.has(id)) App.favorites.delete(id); else App.favorites.add(id);
    saveFavorites();
    var route = parseRoute();
    if (route.name === 'my' || route.name === 'event') {
      render(); // list membership / detail label must change
    } else {
      updateStarButtons(id); // keep scroll position on Now/Browse
    }
  }
  function updateStarButtons(id) {
    var on = App.favorites.has(id);
    var nodes = document.querySelectorAll('.star[data-fav-id="' + id + '"]');
    for (var i = 0; i < nodes.length; i++) {
      var title = nodes[i].getAttribute('data-title') || '';
      nodes[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      nodes[i].setAttribute('aria-label', (on ? 'Unstar ' : 'Star ') + title);
      nodes[i].textContent = on ? '★' : '☆';
    }
  }

  /* --------------------------------------------- favorites: backup / share */

  function plural(n) { return n === 1 ? '' : 's'; }

  // Pull a clean id list out of an imported payload. Accepts either the wrapped
  // export object ({ favorites: [...] }) or a bare array of ids, so a hand-edited
  // or older file still imports. Returns null when the shape is unrecognizable
  // (caller warns), [] when it is simply empty. Drops non-string/blank/dupes.
  function extractFavIds(parsed) {
    var arr = Array.isArray(parsed) ? parsed
      : (parsed && Array.isArray(parsed.favorites)) ? parsed.favorites
      : null;
    if (!arr) return null;
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (typeof v === 'string' && v && !seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }

  function exportFavorites() {
    var ids = Array.from(App.favorites);
    if (!ids.length) { toast('Nothing starred yet to export.'); return; }
    var payload = {
      app: 'gfest-pocket-schedule',
      kind: 'favorites',
      version: 1,
      event: App.data ? App.data.meta.event : 'G-FEST',
      exported: new Date().toISOString(),
      favorites: ids
    };
    var json = JSON.stringify(payload, null, 2);
    var filename = 'gfest-2026-my-schedule.json';

    // Prefer the native share sheet on mobile (the natural way to hand this to
    // someone); fall back to a plain file download everywhere else.
    try {
      if (navigator.canShare && typeof File === 'function') {
        var file = new File([json], filename, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: 'My G-FEST Schedule' })
            .then(function () { toast('Schedule shared.'); })
            .catch(function (err) {
              if (err && err.name === 'AbortError') return; // user dismissed the sheet
              downloadJson(json, filename, ids.length);
            });
          return;
        }
      }
    } catch (e) { /* fall through to download */ }
    downloadJson(json, filename, ids.length);
  }

  function downloadJson(json, filename, count) {
    var url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + count + ' starred event' + plural(count) + '.');
  }

  function importFavoritesFromText(text) {
    var parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { toast("Couldn't read that file — it isn't valid JSON."); return; }

    var ids = extractFavIds(parsed);
    if (ids === null) { toast("That file doesn't look like a G-FEST export."); return; }
    if (!ids.length) { toast('That file has no starred events.'); return; }

    var added = 0;
    ids.forEach(function (id) {
      if (!App.favorites.has(id)) { App.favorites.add(id); added++; }
    });
    saveFavorites();
    render(); // re-render My Schedule with the merged list

    if (!added) toast('Already up to date — nothing new added.');
    else toast('Added ' + added + ' event' + plural(added) + ' to My Schedule.');
  }

  function backupSection() {
    var exportBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Export' });
    exportBtn.addEventListener('click', exportFavorites);

    // Hidden picker the Import button triggers; reset after each read so the same
    // file can be chosen twice in a row.
    var fileInput = el('input', {
      type: 'file', accept: '.json,application/json', hidden: 'hidden', 'aria-hidden': 'true'
    });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { importFavoritesFromText(String(reader.result)); };
      reader.onerror = function () { toast("Couldn't read that file."); };
      reader.readAsText(f);
      fileInput.value = '';
    });

    var importBtn = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Import' });
    importBtn.addEventListener('click', function () { fileInput.click(); });

    var box = el('div', { class: 'backup' }, [
      el('p', {
        class: 'backup__help',
        text: 'Save your starred picks to a file to back them up or share, or import a list someone sent you.'
      }),
      el('div', { class: 'backup__actions' }, [exportBtn, importBtn, fileInput])
    ]);
    return section('Back up & share', box);
  }

  /* ----------------------------------------------------------- components */

  function trackPill(track) {
    var c = trackColor(track);
    return el('span', {
      class: 'pill',
      style: 'color:' + c + ';background:' + hexToRgba(c, 0.16),
      text: track
    });
  }

  function starButton(e) {
    var on = App.favorites.has(e.id);
    var btn = el('button', {
      class: 'star',
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      'aria-label': (on ? 'Unstar ' : 'Star ') + e.title,
      'data-fav-id': e.id,
      'data-title': e.title,
      text: on ? '★' : '☆'
    });
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      App.toggleFav(e.id);
    });
    return btn;
  }

  function eventCard(e, opts) {
    opts = opts || {};
    var mod = opts.live ? ' card--live' : (opts.first ? ' card--first' : '');
    var card = el('article', {
      class: 'card' + mod,
      // The inset track rail (.card::before) reads its color from --rail.
      style: '--rail:' + trackColor(e.track)
    });
    var body = el('a', { class: 'card__body', href: '#/event/' + encodeURIComponent(e.id) });
    body.appendChild(el('div', { class: 'card__time', text: N.formatTimeRange(e.start, e.end, tz()) }));
    body.appendChild(el('div', { class: 'card__title', text: e.title }));
    var meta = el('div', { class: 'card__meta' }, [
      el('span', { class: 'card__room', text: e.room }),
      trackPill(e.track)
    ]);
    body.appendChild(meta);
    card.appendChild(body);
    card.appendChild(starButton(e));
    return card;
  }

  function section(title, node) {
    var s = el('section', { class: 'section' });
    if (title) s.appendChild(el('h2', { class: 'section__title', text: title }));
    if (node) s.appendChild(node);
    return s;
  }

  function renderGroupsInto(container, groups) {
    groups.forEach(function (g) {
      var tg = el('div', { class: 'timegroup' });
      tg.appendChild(el('div', { class: 'timegroup__label', text: g.label }));
      g.events.forEach(function (e) { tg.appendChild(eventCard(e)); });
      container.appendChild(tg);
    });
  }

  function openNowStrip(events, now) {
    var open = N.openNow(events, now);
    if (!open.length) return null;
    var chips = el('div', { class: 'chips' });
    open.forEach(function (e) {
      chips.appendChild(el('span', { class: 'chip chip--open' }, [
        el('span', { class: 'chip__dot', style: 'background:' + trackColor(e.track) }),
        e.room
      ]));
    });
    return section('Open now', chips);
  }

  // Cinematic hero strip shown above Happening Now — the single treated-photo
  // moment; list surfaces below stay clean. Decorative, so aria-hidden.
  function nowBanner() {
    return el('div', { class: 'now-banner', 'aria-hidden': 'true' }, [
      el('div', { class: 'now-banner__img' }),
      el('div', { class: 'now-banner__scrim' }),
      el('div', { class: 'now-banner__label' }, [
        el('span', { class: 'live-dot' }),
        'Now playing at G-FEST'
      ])
    ]);
  }

  function emptyCard(lead, sub, action) {
    var box = el('div', { class: 'empty' }, [el('p', { class: 'empty__lead', text: lead })]);
    if (sub) box.appendChild(el('p', { class: 'empty__sub', text: sub }));
    if (action) box.appendChild(action);
    return box;
  }

  /* --------------------------------------------------------------- Now view */

  // Lightweight fingerprint of the Now state: the ids in each bucket. Changes
  // only when an event enters/leaves happening/up-next/open-now — the signal
  // for when the 30s tick must actually re-render the Now view.
  function nowSignature() {
    var events = App.data.events;
    var now = App.getNow();
    return JSON.stringify([
      N.happeningNow(events, now).map(function (e) { return e.id; }),
      N.upNext(events, now, tz()).map(function (e) { return e.id; }),
      N.openNow(events, now).map(function (e) { return e.id; })
    ]);
  }

  function renderNow(view) {
    var events = App.data.events;
    var now = App.getNow();
    var state = N.conState(events, now);

    if (state === 'pre') {
      var first = N.nextUpcomingAny(events, now);
      var lead = App.data.meta.event + ' starts ' +
        (first ? weekday(N.parseInstant(first.start)) + ' at ' + N.formatTime(N.parseInstant(first.start), tz()) : 'soon') +
        '. See you there.';
      view.appendChild(emptyCard(lead, 'Your schedule is ready to explore.'));
      if (first) {
        var s = section('First up');
        s.appendChild(eventCard(first, { first: true }));
        view.appendChild(s);
      }
    } else if (state === 'post') {
      view.appendChild(emptyCard("That's a wrap on " + App.data.meta.event + '.',
        'Thanks for using the pocket schedule.'));
    } else if (state === 'between') {
      var nx = N.nextUpcomingAny(events, now);
      var sub = nx ? 'Next up: ' + nx.title + ' at ' + N.formatDayTime(N.parseInstant(nx.start), tz()) : null;
      view.appendChild(emptyCard('Nothing scheduled right now.', sub));
      var un = N.upNext(events, now, tz());
      if (un.length) {
        var us = section('Up Next');
        renderGroupsInto(us, N.groupByStart(un, tz()));
        view.appendChild(us);
      }
    } else { // live
      var hn = N.happeningNow(events, now);
      if (hn.length) {
        view.appendChild(nowBanner()); // the one hero moment — treated photo + grain
        var hs = section('Happening Now');
        hs.classList.add('section--live');
        hn.forEach(function (e) { hs.appendChild(eventCard(e, { live: true })); });
        view.appendChild(hs);
      }
      var next = N.upNext(events, now, tz());
      if (next.length) {
        var ns = section('Up Next');
        renderGroupsInto(ns, N.groupByStart(next, tz()));
        view.appendChild(ns);
      }
    }

    var strip = openNowStrip(events, now);
    if (strip) view.appendChild(strip);
  }

  /* ------------------------------------------------------------ Browse view */

  function conDays() { return App.data.meta.days; }

  function currentBrowseDay() {
    var dates = conDays().map(function (d) { return d.date; });
    if (browseDay && dates.indexOf(browseDay) >= 0) return browseDay;
    var today = N.dayKey(App.getNow(), tz());
    return dates.indexOf(today) >= 0 ? today : dates[0];
  }

  function distinctTracks(events) {
    var seen = {};
    events.forEach(function (e) { seen[e.track] = true; });
    return Object.keys(seen).sort(function (a, b) {
      var ia = TRACK_ORDER.indexOf(a); if (ia < 0) ia = 999;
      var ib = TRACK_ORDER.indexOf(b); if (ib < 0) ib = 999;
      if (ia !== ib) return ia - ib;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  function passesFilter(e) {
    if (selTracks.size && !selTracks.has(e.track)) return false;
    if (selRooms.size && !selRooms.has(e.room)) return false;
    return true;
  }

  function renderBrowse(view) {
    var day = currentBrowseDay();

    // Day tabs
    var tabs = el('div', { class: 'daytabs', role: 'tablist', 'aria-label': 'Choose day' });
    conDays().forEach(function (d) {
      var t = el('button', {
        class: 'daytab',
        type: 'button',
        role: 'tab',
        'aria-current': d.date === day ? 'true' : null,
        'aria-selected': d.date === day ? 'true' : 'false',
        text: d.label
      });
      t.addEventListener('click', function () {
        browseDay = d.date;
        render();
      });
      tabs.appendChild(t);
    });
    view.appendChild(tabs);

    // Filters
    view.appendChild(buildFilters(view));

    // List container (rebuilt in place on filter change)
    var list = el('div', { id: 'browse-list' });
    view.appendChild(list);
    updateBrowseList();
  }

  function buildFilters() {
    var events = App.data.events;
    var details = el('details', { class: 'filters' });
    var countNode = el('span', { id: 'filter-count', class: 'filters__count' });
    var summary = el('summary', { class: 'filters__summary' }, ['Filter', countNode]);
    details.appendChild(summary);

    var body = el('div', { class: 'filters__body' });

    var tGroup = el('div', { class: 'filters__group' }, [
      el('div', { class: 'filters__legend', text: 'Track' })
    ]);
    var tChips = el('div', { class: 'chips' });
    distinctTracks(events).forEach(function (track) {
      tChips.appendChild(filterChip(track, selTracks, track, trackColor(track)));
    });
    tGroup.appendChild(tChips);

    var rGroup = el('div', { class: 'filters__group' }, [
      el('div', { class: 'filters__legend', text: 'Room' })
    ]);
    var rChips = el('div', { class: 'chips' });
    App.data.meta.rooms.forEach(function (room) {
      rChips.appendChild(filterChip(room, selRooms, room, null));
    });
    rGroup.appendChild(rChips);

    var clear = el('button', { class: 'btn btn--ghost', type: 'button', text: 'Clear filters' });
    clear.addEventListener('click', function () {
      selTracks.clear();
      selRooms.clear();
      var pressed = details.querySelectorAll('.chip[aria-pressed="true"]');
      for (var i = 0; i < pressed.length; i++) pressed[i].setAttribute('aria-pressed', 'false');
      updateBrowseList();
      updateFilterCount();
    });

    body.appendChild(tGroup);
    body.appendChild(rGroup);
    body.appendChild(el('div', { class: 'filters__actions' }, [clear]));
    details.appendChild(body);
    var n0 = selTracks.size + selRooms.size;
    countNode.textContent = n0 ? ' · ' + n0 + ' active' : '';
    return details;
  }

  function filterChip(label, set, value, color) {
    var on = set.has(value);
    var kids = [];
    if (color) kids.push(el('span', { class: 'chip__dot', style: 'background:' + color }));
    kids.push(label);
    var chip = el('button', {
      class: 'chip',
      type: 'button',
      'aria-pressed': on ? 'true' : 'false'
    }, kids);
    chip.addEventListener('click', function () {
      if (set.has(value)) { set.delete(value); chip.setAttribute('aria-pressed', 'false'); }
      else { set.add(value); chip.setAttribute('aria-pressed', 'true'); }
      updateBrowseList();
      updateFilterCount();
    });
    return chip;
  }

  function updateFilterCount() {
    var node = document.getElementById('filter-count');
    if (!node) return;
    var n = selTracks.size + selRooms.size;
    node.textContent = n ? ' · ' + n + ' active' : '';
  }

  function updateBrowseList() {
    var list = document.getElementById('browse-list');
    if (!list) return;
    list.innerHTML = '';

    var day = currentBrowseDay();
    var events = N.eventsForDay(App.data.events, day).filter(passesFilter);

    if (!events.length) {
      list.appendChild(emptyCard('No events match.', 'Try clearing a filter.'));
      return;
    }

    var groups = N.groupByStart(events, tz());
    var now = App.getNow();
    var isToday = day === N.dayKey(now, tz());
    var nowMs = now.getTime();
    var dividerPlaced = false;

    groups.forEach(function (g) {
      if (isToday && !dividerPlaced && N.parseInstant(g.key).getTime() > nowMs) {
        list.appendChild(nowDivider(now));
        dividerPlaced = true;
      }
      var tg = el('div', { class: 'timegroup' }, [
        el('div', { class: 'timegroup__label', text: g.label })
      ]);
      g.events.forEach(function (e) { tg.appendChild(eventCard(e)); });
      list.appendChild(tg);
    });

    // Today, but every group is already in the past → show the marker at the end.
    if (isToday && !dividerPlaced) list.appendChild(nowDivider(now));
  }

  function nowDivider(now) {
    return el('div', { class: 'now-divider' }, [
      el('span', { class: 'now-divider__label', text: 'NOW · ' + N.formatTime(now, tz()) })
    ]);
  }

  /* ------------------------------------------------------------ Detail view */

  function renderDetail(view, id) {
    var e = null;
    var list = App.data.events;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { e = list[i]; break; } }

    var back = el('button', { class: 'btn-back', type: 'button' }, ['‹ Back']);
    back.addEventListener('click', function () {
      if (window.history.length > 1) window.history.back();
      else location.hash = '#/browse';
    });
    view.appendChild(back);

    if (!e) {
      view.appendChild(emptyCard('Event not found.', 'It may have been removed or the link is wrong.',
        el('a', { class: 'btn', href: '#/browse', text: 'Go to Browse' })));
      return;
    }

    var art = el('article');
    art.appendChild(el('h1', { class: 'detail__title', text: e.title }));

    var d = N.parseInstant(e.start);
    art.appendChild(detailRow('When', fullDate(d) + ' · ' + N.formatTimeRange(e.start, e.end, tz())));
    art.appendChild(detailRow('Room', e.room));

    var trackRow = el('div', { class: 'detail__row' }, [
      el('span', { class: 'detail__label', text: 'Track' }),
      el('span', { class: 'detail__value' }, [trackPill(e.track)])
    ]);
    art.appendChild(trackRow);

    if (e.presenters && e.presenters.length) {
      art.appendChild(detailRow('Presenters', e.presenters.join(', ')));
    }

    // Star toggle (labeled)
    var on = App.favorites.has(e.id);
    var star = el('button', {
      class: 'detail__star',
      type: 'button',
      'aria-pressed': on ? 'true' : 'false',
      'data-fav-id': e.id,
      'data-title': e.title
    }, [on ? '★ Starred' : '☆ Add to My Schedule']);
    star.addEventListener('click', function () { App.toggleFav(e.id); });
    art.appendChild(el('div', { class: 'detail__star-wrap' }, [star]));

    if (e.description) {
      art.appendChild(el('p', { class: 'detail__desc', text: e.description }));
    }

    view.appendChild(art);
  }

  function detailRow(label, value) {
    return el('div', { class: 'detail__row' }, [
      el('span', { class: 'detail__label', text: label }),
      el('span', { class: 'detail__value', text: value })
    ]);
  }

  /* -------------------------------------------------------- My Schedule view */

  function renderMy(view) {
    var favs = App.data.events.filter(function (e) { return App.favorites.has(e.id); });

    if (!favs.length) {
      view.appendChild(emptyCard(
        'No starred events yet.',
        'Tap ☆ on any event to build your personal schedule — or import a list someone shared below.',
        el('a', { class: 'btn', href: '#/browse', text: 'Browse the schedule' })
      ));
    } else {
      conDays().forEach(function (day) {
        var dayEvents = N.eventsForDay(favs, day.date);
        if (!dayEvents.length) return;
        var s = section(day.label);
        renderGroupsInto(s, N.groupByStart(dayEvents, tz()));
        view.appendChild(s);
      });
    }

    view.appendChild(backupSection());
  }

  /* ---------------------------------------------------------------- routing */

  function parseRoute() {
    var h = location.hash || '';
    if (!h || h === '#' || h === '#/') return { name: 'now' };
    var m = h.match(/^#\/event\/(.+)$/);
    if (m) return { name: 'event', id: decodeURIComponent(m[1]) };
    if (h === '#/browse') return { name: 'browse' };
    if (h === '#/my') return { name: 'my' };
    return { name: 'now' };
  }

  function updateChrome() {
    var now = App.getNow();
    var clock = document.getElementById('clock');
    if (clock) clock.textContent = N.formatDayTime(now, tz());
    var asof = document.getElementById('data-as-of');
    if (asof && App.data) asof.textContent = 'Data as of ' + App.data.meta.updated;
  }

  function updateTabbar(routeName) {
    var map = { now: '#/now', browse: '#/browse', my: '#/my' };
    var tabs = document.querySelectorAll('.tabbar__tab');
    for (var i = 0; i < tabs.length; i++) {
      var active = map[routeName] && tabs[i].getAttribute('data-route') === map[routeName];
      if (active) tabs[i].setAttribute('aria-current', 'page');
      else tabs[i].removeAttribute('aria-current');
    }
  }

  function render() {
    var route = parseRoute();
    updateChrome();
    updateTabbar(route.name);

    var view = viewEl();
    if (!view) return;
    view.innerHTML = '';

    if (!App.data) {
      view.appendChild(App.loadError
        ? emptyCard("Couldn't load the schedule.", 'Check your connection, then tap Refresh (↻) above.')
        : emptyCard('Loading…', null));
      return;
    }

    switch (route.name) {
      case 'browse': renderBrowse(view); break;
      case 'my': renderMy(view); break;
      case 'event': renderDetail(view, route.id); break;
      default:
        renderNow(view);
        lastNowSig = nowSignature(); // sync so the next tick is a no-op until state changes
    }
  }

  /* ----------------------------------------------------------------- toast */

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2500);
  }

  /* --------------------------------------------------------------- refresh */

  function wireRefresh() {
    var btn = document.getElementById('refresh-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!navigator.onLine) {
        toast("You're offline — showing saved schedule.");
        return;
      }
      btn.classList.add('is-spinning');
      // Cache-bust so the service worker fetches the network copy for an explicit refresh.
      fetch('data/schedule.json?ts=' + Date.now(), { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
        .then(function (d) {
          App.data = d;
          App.loadError = false;
          render();
          toast('Schedule updated');
        })
        .catch(function () { toast("Couldn't refresh — showing saved schedule."); })
        .then(function () { btn.classList.remove('is-spinning'); });
    });
  }

  /* --------------------------------------------------------------- install */

  // "Add to Home" affordance. Chromium desktop/Android fire beforeinstallprompt
  // when the app is installable and not yet installed; we stash it and reveal an
  // Install button that drives the native dialog. Safari never fires this event,
  // so the button simply stays hidden there (install is manual via the browser).
  var deferredInstall = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true; // iOS Safari
  }

  function wireInstall() {
    var btn = document.getElementById('install-btn');
    if (!btn) return;
    if (isStandalone()) return; // already installed — never prompt

    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();       // suppress Chrome's mini-infobar; we drive it
      deferredInstall = e;
      btn.hidden = false;
    });

    btn.addEventListener('click', function () {
      if (!deferredInstall) return;
      var prompt = deferredInstall;
      deferredInstall = null;   // a prompt event can only be used once
      btn.hidden = true;        // a fresh beforeinstallprompt re-reveals it later
      prompt.prompt();
      prompt.userChoice.then(function (choice) {
        if (choice && choice.outcome === 'accepted') toast('Installing G-FEST…');
      });
    });

    window.addEventListener('appinstalled', function () {
      deferredInstall = null;
      btn.hidden = true;
      toast('G-FEST installed — open it any time, even offline.');
    });
  }

  /* --------------------------------------------------------------- lifecycle */

  function tick() {
    updateChrome(); // updates the live header clock text node in place — no view re-render

    if (!App.data || parseRoute().name !== 'now') return;

    // Only re-render Now when an event actually entered/left a bucket.
    var sig = nowSignature();
    if (sig === lastNowSig) return;
    lastNowSig = sig;

    var view = viewEl();
    if (!view) return;

    // Preserve scroll + keyboard focus across the in-place re-render.
    var y = window.scrollY;
    var activeId = document.activeElement ? document.activeElement.id : '';
    view.innerHTML = '';
    renderNow(view);
    window.scrollTo(0, y);
    if (activeId) {
      var focusTarget = document.getElementById(activeId);
      if (focusTarget) focusTarget.focus();
    }
  }

  function loadData() {
    fetch('data/schedule.json')
      .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
      .then(function (d) { App.data = d; App.loadError = false; render(); })
      .catch(function () { App.loadError = true; render(); });
  }

  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('service-worker.js', { scope: '/' }).catch(function () {});
      });
    }
  }

  function init() {
    wireRefresh();
    wireInstall();
    window.addEventListener('hashchange', render);
    render();       // paints chrome + loading state immediately
    loadData();
    setInterval(tick, 30000);
    registerSW();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
