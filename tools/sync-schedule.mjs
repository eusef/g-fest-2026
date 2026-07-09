/*
 * sync-schedule.mjs — transform the G-FEST Wix/Boomtech "published_calendar" feed
 * into our data/schedule.json contract (PRD §6).
 *
 * Why a build-time sync (not a runtime live feed): the app is offline-first for a
 * no-signal convention floor, and the feed URL carries a Wix `instance` token that
 * expires and can't be refreshed client-side. So we pull the feed here, transform +
 * curate, and ship a stable schedule.json that the app already caches offline.
 *
 * Usage:
 *   node tools/sync-schedule.mjs [--in <feed.json>] [--enrich <current schedule.json>] [--out <path>]
 * Defaults: --in docs/published_calendar.json  --enrich data/schedule.json  --out data/schedule.json
 *
 * The feed can be refreshed by grabbing a current published_calendar URL from the
 * Wix site's Network tab and saving the JSON response to docs/published_calendar.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/* --------------------------------------------------------------- args */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const IN = arg('in', 'docs/published_calendar.json');
const ENRICH = arg('enrich', 'data/schedule.json');
const OUT = arg('out', 'data/schedule.json');
const TZ = 'America/Chicago';
const EVENT_NAME = 'G-FEST 2026';

/* --------------------------------------------------------------- mapping tables */

// Feed venue.address -> canonical room name (fix typos / trailing "Room").
const ROOM_ALIAS = {
  '"Gamer, Uh" Tournament Zone Room': '"Gamer, Uh" Tournament Zone',
  '“Gamer, Uh” Tournament Zone Room': '"Gamer, Uh" Tournament Zone',
  'Make and Take Room': 'Make and Take',
  'Make And Take Room': 'Make and Take',
  'Mecha G(ame) Room': 'Mecha (Game) Room',
  'Flilm Festival Room': 'Film Festival',
  'Film Festival': 'Film Festival',
  'Paris Room / Model Display Room': 'Model Display Room'
};

// Program category -> our track. "General Hours" is derived from the room instead.
const CATEGORY_TRACK = {
  'Film Festival': 'Screening',
  'Tabletop Gaming': 'Gaming',
  'Video Games': 'Gaming',
  'Model Thread': 'Model',
  'Dojo Studios': 'Model',
  'Panels': 'Panels',
  'Panels 1': 'Panels',
  'Panels 2': 'Panels',
  'Panels 3': 'Panels'
};

// Room -> track, used for standing "General Hours" rows and as a fallback.
// Seeded from how the hand-curated PDF dataset classified each room.
const ROOM_TRACK = {
  'Panels 1': 'Panels', 'Panels 2': 'Panels', 'Panels 3': 'Panels',
  'Dojo Studios': 'Model', 'Model Room': 'Model', 'Make and Take': 'Model',
  'Model Display Room': 'Exhibit',
  'Ultra Kaiju Experience!': 'Exhibit',
  '"Gamer, Uh" Tournament Zone': 'Gaming', 'Tabletop Gaming': 'Gaming', 'Mecha (Game) Room': 'Gaming',
  'Film Festival': 'Screening',
  "Dealer's Room": 'Exhibit', "Artist's Alley": 'Exhibit', 'Art Display': 'Exhibit',
  'G-FEST Display Room': 'Exhibit', "Minya's Place": 'Exhibit', 'Tattoo Room': 'Exhibit',
  'Quiet Rooms': 'Exhibit', 'Autograph Room': 'Exhibit',
  'Registration': 'Registration', 'Info Booth': 'Registration',
  'Massage Room': 'Exhibit', 'Hallway Corner': 'Exhibit', "Writer's Workshop": 'Panels'
};

// Curated short id slug per known room (from existing ids). New rooms get a
// mechanical slug via slugify().
const ROOM_SLUG = {
  'Panels 1': 'panels1', 'Panels 2': 'panels2', 'Panels 3': 'panels3',
  'Dojo Studios': 'dojo', 'Model Room': 'modelroom', 'Make and Take': 'makeandtake',
  'Ultra Kaiju Experience!': 'ultrakaiju', '"Gamer, Uh" Tournament Zone': 'gamerzone',
  "Dealer's Room": 'dealers', 'Art Display': 'artdisplay', "Artist's Alley": 'artistsalley',
  'Autograph Room': 'autograph', 'G-FEST Display Room': 'gfestdisplay', 'Info Booth': 'infobooth',
  'Model Display Room': 'modeldisplay', 'Registration': 'registration', 'Tabletop Gaming': 'tabletop',
  "Minya's Place": 'minya', 'Tattoo Room': 'tattoo', 'Mecha (Game) Room': 'mecha', 'Quiet Rooms': 'quiet',
  'Film Festival': 'filmfestival'
};

/* --------------------------------------------------------------- helpers */
function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'room';
}

// Longest-offset (e.g. "GMT-05:00") for a wall date in TZ, returned as "-05:00".
function tzOffset(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, timeZoneName: 'longOffset'
  }).formatToParts(d);
  const name = (parts.find(p => p.type === 'timeZoneName') || {}).value || 'GMT-05:00';
  const m = name.match(/GMT([+-]\d{2}:?\d{2})/);
  if (!m) return '-05:00';
  return m[1].includes(':') ? m[1] : m[1].slice(0, 3) + ':' + m[1].slice(3);
}

function weekdayLong(dateStr) {
  return new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' })
    .format(new Date(dateStr + 'T12:00:00-05:00'));
}

// Feed wall-clock "2026-07-10T10:00" -> "2026-07-10T10:00:00-05:00".
function toOffsetIso(wall, dateStr) {
  let s = wall.length === 16 ? wall + ':00' : wall; // add seconds if missing
  return s + tzOffset(dateStr);
}

function norm(t) { return (t || '').trim().toLowerCase().replace(/\s+/g, ' '); }

/* --------------------------------------------------------------- enrichment source */
let curatedPresenters = new Map(); // normTitle -> [presenters]
let specialTitles = new Set();     // normTitle of events our curation marked "special"
try {
  const cur = JSON.parse(readFileSync(ENRICH, 'utf8'));
  for (const e of cur.events || []) {
    if (e.presenters && e.presenters.length) curatedPresenters.set(norm(e.title), e.presenters);
    if (e.type === 'special') specialTitles.add(norm(e.title));
  }
} catch { /* first run / no existing file — fine */ }

/* --------------------------------------------------------------- transform */
const feed = JSON.parse(readFileSync(IN, 'utf8'));
const usedIds = new Set();
const warnings = [];
const events = [];
const roomsSeen = [];
const daysSeen = new Map(); // date -> label

for (const fe of feed.events || []) {
  const cats = (fe.categories || []).map(c => c.name);
  const isStanding = cats.includes('General Hours');

  // room
  const rawAddr = ((fe.venue || {}).address || '').trim();
  let room = ROOM_ALIAS[rawAddr] || rawAddr;
  if (!room) room = cats.find(c => c !== 'General Hours') || 'TBA';
  if (!roomsSeen.includes(room)) roomsSeen.push(room);

  // track: program category first, else room, else Event
  let track = null;
  for (const c of cats) if (CATEGORY_TRACK[c]) { track = CATEGORY_TRACK[c]; break; }
  if (!track) track = ROOM_TRACK[room] || 'Event';

  // type: standing from "General Hours"; else panel, upgraded to special if our
  // curation flagged this title as a marquee event.
  let type = 'standing';
  if (!isStanding) type = specialTitles.has(norm(fe.title)) ? 'special' : 'panel';

  // times / day
  const dateStr = (fe.start || '').slice(0, 10);
  const start = toOffsetIso(fe.start, dateStr);
  let end = toOffsetIso(fe.end, dateStr);
  if (end <= start) {
    // Feed data error (end at/before start). We can't know the intended end, so
    // default to a 1h window so the app stays usable, and warn loudly to fix at source.
    const off = tzOffset(dateStr);
    const h = String(Math.min(23, +start.slice(11, 13) + 1)).padStart(2, '0');
    end = `${dateStr}T${h}${start.slice(13, 19)}${off}`;
    warnings.push(`end<=start for "${fe.title}" (${fe.start} -> ${fe.end}); defaulted to +1h`);
  }
  if (!daysSeen.has(dateStr)) daysSeen.set(dateStr, weekdayLong(dateStr));

  // id — reuse curated slug + daykey + HHMM; dedupe collisions
  const daykey = weekdayLong(dateStr).slice(0, 3).toLowerCase();
  const hhmm = fe.start.slice(11, 16).replace(':', '');
  const slug = ROOM_SLUG[room] || slugify(room);
  let id = `${daykey}-${slug}-${hhmm}`;
  let n = 2;
  while (usedIds.has(id)) id = `${daykey}-${slug}-${hhmm}-${n++}`;
  usedIds.add(id);

  events.push({
    id, day: dateStr, start, end, room, track, type,
    title: (fe.title || '').trim(),
    presenters: curatedPresenters.get(norm(fe.title)) || [],
    description: (fe.desc || '').trim()
  });
}

// Stable sort: by start time, then room.
events.sort((a, b) => a.start < b.start ? -1 : a.start > b.start ? 1 : (a.room < b.room ? -1 : 1));

/* --------------------------------------------------------------- meta */
const days = [...daysSeen.entries()].sort().map(([date, label]) => ({ date, label }));
const rooms = roomsSeen.slice().sort((a, b) => a.localeCompare(b));

const out = {
  meta: {
    event: EVENT_NAME,
    timezone: TZ,
    utcOffset: tzOffset(days[0] ? days[0].date : '2026-07-10'),
    updated: new Date().toISOString().slice(0, 10),
    source: `Boomtech/Wix published_calendar feed (${feed.comp_id}); captured ${((feed.created_at || '') + '').slice(0, 10) || 'n/a'}`,
    confidence: 'Generated by tools/sync-schedule.mjs from the live event calendar feed. Track/type are derived from feed categories + room (see mapping tables in the script); presenters and "special" flags are carried over from the prior hand-curated dataset by title match. Verify grid-only items against the source before treating exact minutes as authoritative.',
    days,
    rooms
  },
  events
};

writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.error(`Wrote ${OUT}: ${events.length} events, ${days.length} days, ${rooms.length} rooms`);
console.error(`Presenters carried over: ${events.filter(e => e.presenters.length).length}`);
console.error(`Types — standing:${events.filter(e => e.type === 'standing').length} special:${events.filter(e => e.type === 'special').length} panel:${events.filter(e => e.type === 'panel').length}`);
if (warnings.length) {
  console.error(`\n${warnings.length} data warning(s) from the feed (fix at source):`);
  for (const w of warnings) console.error('  ! ' + w);
}
