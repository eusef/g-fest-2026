# PRD: G-FEST Pocket Schedule (offline PWA)

**Status:** Ready for implementation
**Author:** Raj (PM) for Phil Johnston
**Date:** 2026-07-09
**Deadline:** Usable by Friday 2026-07-10 morning (event runs Jul 10-12, 2026)
**License intent:** Open source (MIT recommended)

---

## 1. Problem

The official G-FEST 2026 schedule is a 15-page PDF (a room-by-time grid plus description pages). On a phone it requires constant pinch-zoom, has no notion of "now," and is unusable with the limited cell service typical at the convention hotel. An attendee standing in a hallway cannot quickly answer "what's happening right now and what's next, and is it worth walking to?"

## 2. Target user

- **Primary:** Phil, attending G-FEST 2026, on a phone, often offline.
- **Secondary:** Any G-FEST attendee who finds the open-source repo and self-hosts or uses the deployed page. No account, no setup.

## 3. Goals

1. Answer "what's on now / next" in one glance, in the event's local time.
2. Work fully offline after the first load (installable to home screen).
3. Let the user browse the full 3-day schedule and star events into a personal list.
4. Be dead simple to run, fork, and re-use for a future con (swap one JSON file).

## 4. Non-goals (v1)

- No backend, accounts, or login.
- No live/real-time sync of schedule changes (static snapshot; see §11).
- No push notifications or reminders.
- No maps/venue floor plans.
- No ticketing, payments, or social features.

## 5. Success criteria (measurable)

| # | Criterion | How to verify |
|---|-----------|---------------|
| S1 | After one online load, the app fully functions with the network disabled. | Load once, enable DevTools "Offline" (or airplane mode), reload: all screens and data render. |
| S2 | Installable as a PWA on iOS Safari and Android Chrome. | Lighthouse PWA audit passes "installable"; "Add to Home Screen" works and launches standalone. |
| S3 | The "Now" screen correctly shows events whose window contains the current event-local time, and the next upcoming ones. | Mock the clock to Fri 1:45 PM, Sat 9:00 AM, Sun 4:00 PM, and 3:00 AM; verify Now/Next lists. |
| S4 | Starred events persist across reloads and offline. | Star 3 events, hard-reload offline; My Schedule still shows them. |
| S5 | 100% of PDF events are present and correct (time, room, title). | Spot-check `data/schedule.json` against the source PDF grid; counts match §2 of the data report. |
| S6 | Cold load over a slow/2G connection completes in < 3s and total payload < 500 KB. | Lighthouse throttled load; check transfer size. |

## 6. Data contract

The app is driven entirely by `data/schedule.json`. It is produced from the official PDF (`docs/gfest-2026-schedule-source.pdf`) and is the single source of truth. Shape:

```json
{
  "meta": {
    "event": "G-FEST 2026",
    "timezone": "America/Chicago",
    "utcOffset": "-05:00",
    "updated": "2026-07-09",
    "source": "Official G-FEST 2026 schedule PDF",
    "days": [
      { "date": "2026-07-10", "label": "Friday" },
      { "date": "2026-07-11", "label": "Saturday" },
      { "date": "2026-07-12", "label": "Sunday" }
    ],
    "rooms": ["Panels 1", "Panels 2", "..."]
  },
  "events": [
    {
      "id": "fri-panels1-1000",
      "day": "2026-07-10",
      "start": "2026-07-10T10:00:00-05:00",
      "end": "2026-07-10T11:00:00-05:00",
      "room": "Panels 1",
      "track": "Panels",
      "type": "panel",
      "title": "50 Years of The Last Dinosaur",
      "presenters": ["Alex Rushdy"],
      "description": "Explore the in-depth production history of..."
    }
  ]
}
```

**Field semantics:** `type` is `panel` (scheduled talk), `standing` (all-day open room/exhibit), or `special` (marquee timed event). `track` is a coarse filter bucket: `Panels`, `Model`, `Gaming`, `Cosplay`, `Screening`, `Exhibit`, `Event`, `Registration`. `presenters` may be `[]`. `description` may be `""`. All times are event-local wall-clock with the `-05:00` offset.

**Timezone rule (critical):** Compare "now" against events using the event's timezone (`America/Chicago`), NOT the device timezone. On the floor the device is already Central so either works, but a user checking from another timezone (or a device set wrong) must still see correct Central times. Parse the ISO strings with their offset and format for display in `meta.timezone`.

## 7. Screens & features

### 7.1 Now (home / default tab)
- Large live header: current event-local day + time (updates each minute; recompute "now" state on a timer).
- **Happening Now:** cards for every event where `start <= now < end`. Each card: title, room, time range, track color, star toggle. Tapping opens Detail.
- **Up Next:** the next N (default 8) events starting after `now` today, soonest first, grouped by start time.
- **Open now** strip: `type: "standing"` rooms currently within their open hours, shown compactly (chips, not full cards).
- Empty states: before the con ("G-FEST starts Friday at 9 AM. See you there."), between days ("Nothing scheduled right now. Next up: ..."), after close ("That's a wrap on G-FEST 2026.").

### 7.2 Browse (full schedule)
- Day selector: Friday / Saturday / Sunday tabs (default to today if within the event, else Friday).
- Chronological list for the selected day, grouped by start time, each event a tappable card.
- A "now" divider line rendered inline at the current time when viewing today.
- Filter control: by track and/or room (multi-select, collapsible). Filter state need not persist.

### 7.3 Detail (event view)
- Title, full time range, room, track, presenters, full description.
- Star/unstar toggle.
- "Back" returns to the originating screen with scroll position preserved (nice-to-have).

### 7.4 My Schedule
- Shows only starred events, grouped by day then time, across all three days.
- A "Now/Next within my picks" hint at top when the con is live (nice-to-have).
- Empty state with a prompt to star events from Browse.

### 7.5 App chrome
- Bottom tab bar: **Now · Browse · My Schedule**.
- Header shows "Data as of {meta.updated}" and a manual **Refresh** action that re-fetches `data/schedule.json` when online and swaps it in (see §11). Silent no-op/toast when offline.

## 8. Acceptance criteria (Given / When / Then)

**AC1 - Offline core**
- Given the app has been loaded once online, When the device goes offline and the user relaunches from the home screen, Then Now, Browse, Detail, and My Schedule all render fully from cache with no network errors.

**AC2 - Now logic**
- Given the current event-local time is 1:45 PM Friday, When the user opens Now, Then every event with `start <= 13:45 < end` on 2026-07-10 appears under Happening Now, and the chronologically next starting events appear under Up Next.
- Given the current time is before the first event of the con, When Now is opened, Then Happening Now is empty and the pre-event empty state plus the first upcoming events are shown.
- Given the current time is after the last event, When Now is opened, Then the post-event empty state is shown.

**AC3 - Standing rooms**
- Given a `standing` room with open hours 9:00 AM-5:00 PM Saturday, When the current time is 10:00 AM Saturday, Then it appears in the "Open now" strip; When it is 6:00 PM Saturday, Then it does not.

**AC4 - Favorites persistence**
- Given the user stars an event, When they reload the app (including offline), Then the event remains starred and appears in My Schedule. Storage is `localStorage`, keyed by event `id`.

**AC5 - Timezone correctness**
- Given a device set to a non-Central timezone, When any screen renders event times, Then times display in Central (`meta.timezone`) and "now" comparisons use Central, so no event is mis-bucketed.

**AC6 - Browse filter**
- Given the user selects track = "Panels", When viewing Saturday, Then only Saturday events with `track: "Panels"` are listed; clearing the filter restores the full day.

**AC7 - Data-driven**
- Given `data/schedule.json` is replaced with a different valid file (same schema), When the app loads, Then it renders the new event/day/room set with no code changes.

**AC8 - Installable**
- Given a supported mobile browser, When the user chooses Add to Home Screen, Then the app installs with name/icon from the manifest and launches standalone (no browser chrome).

## 9. Technical constraints & stack

- **No build step, no framework required.** Plain HTML + CSS + vanilla JS is the recommended default (fastest to ship, trivial to open source, nothing to maintain). A tiny lib is acceptable only if it does not introduce a build toolchain; do not add React/bundlers.
- **PWA:** `manifest.webmanifest` (name, short_name, icons 192/512, `display: standalone`, theme/background color) + a service worker.
- **Service worker caching:** cache the app shell (HTML/CSS/JS/icons) and `data/schedule.json` on install. Strategy: cache-first for the shell; for `schedule.json` use stale-while-revalidate so an online Refresh can pull a newer copy while offline still works. Bump a `CACHE_VERSION` constant to invalidate.
- **Storage:** `localStorage` for starred ids and any UI prefs. No IndexedDB needed at this size.
- **Time handling:** use the browser `Intl.DateTimeFormat` with `timeZone: meta.timezone` for display; compute "now" via a Central-time comparison. Do not rely on the device's local offset.
- **Performance:** single JSON payload (~100-150 events) is small; render lists with plain DOM. Target < 500 KB total, < 3s cold load on 2G (S6).
- **Accessibility:** semantic HTML, tappable targets >= 44px, sufficient color contrast, respects `prefers-reduced-motion`.

## 10. Suggested file structure

```
gfest-app/
  index.html
  css/styles.css
  js/app.js            # data load, routing, render
  js/now.js            # now/next computation (pure, unit-testable)
  data/schedule.json   # the data contract (§6) - produced separately
  icons/icon-192.png
  icons/icon-512.png
  manifest.webmanifest
  service-worker.js
  docs/gfest-2026-schedule-source.pdf
  PRD.md
  README.md            # what it is, how to run/deploy (GitHub Pages), how to fork for another con
  LICENSE              # MIT
```

Deployment: static hosting (GitHub Pages recommended, free, HTTPS by default which the service worker requires).

## 11. Known limitations & mitigations

| Limitation | Mitigation |
|------------|------------|
| Static snapshot goes stale if the con reshuffles rooms/times on-site. | Show "Data as of {meta.updated}"; provide manual Refresh that pulls a fresh `schedule.json` when online (stale-while-revalidate). Accept residual staleness for v1. |
| Times hardcoded to Central. | Correct on the floor; §6/§8 AC5 keep it correct for remote viewers. Store offset in data so a future con can change it. |
| No reminders/notifications. | Out of scope v1; My Schedule + "Up Next" cover the core need. |
| iOS PWA storage can be evicted after long inactivity. | Acceptable for a 3-day event; data re-fetches on next online load. |

## 12. Verification plan (do before calling it done)

1. **Data check:** open `data/schedule.json`, confirm it parses, and spot-check ~10 events (times, rooms, titles, presenters) against the source PDF grid + description pages. Confirm per-day counts.
2. **Offline:** load once online, switch to DevTools Offline, reload, exercise all four screens.
3. **Now logic:** temporarily override the clock (inject a `NOW` for testing) to Fri 1:45 PM, Sat 9:00 AM, Sun 4:00 PM, 3:00 AM; confirm Now/Next/Open-now buckets.
4. **Favorites:** star/unstar, reload offline, confirm persistence and My Schedule.
5. **Install:** run Lighthouse (PWA + Performance); confirm installable and payload/perf targets; test Add to Home Screen on a real phone if possible.
6. **Fork test:** confirm swapping `schedule.json` re-renders with no code edits (AC7).

## 13. Open questions

1. **Venue timezone confirm.** Assumed Central (America/Chicago, `-05:00` CDT) from G-FEST's usual Rosemont, IL venue. Confirm before shipping.
2. **Icon/branding.** Need a 192px and 512px app icon. A simple kaiju-silhouette or "G" glyph is fine for v1; can be a placeholder.
3. **Deploy target.** GitHub Pages assumed. Confirm the repo/host so the service worker scope and manifest `start_url` are set correctly.

## 14. Build order (smallest shippable increments)

1. Static shell: load `schedule.json`, render Browse (day tabs + chronological list) with no offline. **Working schedule viewer.**
2. Detail view + Now screen (now/next/open-now logic). **Core value delivered.**
3. Favorites (localStorage) + My Schedule tab.
4. PWA: manifest + service worker + icons (offline + installable).
5. Polish: filters, empty states, Refresh, accessibility, README + LICENSE.

Ship after step 4 if time is tight; step 5 is incremental.
