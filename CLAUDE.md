# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repo contains a **spec and data, not a built app yet**. There is no `index.html`, no service worker, no `js/`, no build config. The deliverable is described in [`PRD.md`](./PRD.md); the app is the next thing to build. When you start implementing, follow the incremental build order in PRD §14 (working schedule viewer → Now screen → favorites → PWA → polish) and create the file layout in PRD §10.

Not a git repository yet. `LICENSE` is referenced by the README but does not exist (MIT intended).

## What it is

An offline-first, installable PWA showing the G-FEST 2026 kaiju convention schedule: what's happening now, what's next, the full 3-day schedule, and a starred personal list. Designed to work with no cell service on the convention floor (event runs Jul 10-12, 2026).

## Commands

There is **no build step and no test runner set up** (deliberate — see constraints). Once the static files exist, develop by serving the directory over HTTP (a service worker requires HTTP/HTTPS, not `file://`):

```
python3 -m http.server 8000    # then open http://localhost:8000
```

Verify data parses:

```
python3 -c "import json; d=json.load(open('data/schedule.json')); print(len(d['events']),'events')"
```

Deployment target is `https://gfest.phils.pics`, a Cloudflare subdomain (not created yet — set up once the app exists). It serves at **root scope**, so the service worker scope and manifest `start_url` should be `/` (not a subpath). HTTPS is provided by Cloudflare, which the service worker requires. Verification is manual — DevTools "Offline", mocked clock, Lighthouse PWA/Performance audit. See PRD §12.

## Architecture

**The app is driven entirely by `data/schedule.json`** (the data contract, PRD §6). It is the single source of truth: `meta` (event name, timezone, days, room list) plus a flat `events` array (currently 149). There is no backend, no accounts, no server. Rendering all screens is a pure function of this one file plus the current time. Swapping in a different valid `schedule.json` must re-render a different con with zero code changes (AC7) — never hardcode event/day/room specifics in code.

**Event model:** each event has `type` (`panel` = scheduled talk, `standing` = all-day open room, `special` = marquee timed event) and `track` (coarse filter bucket: Panels, Model, Gaming, Cosplay, Screening, Exhibit, Event, Registration). `presenters` and `description` may be empty. `standing` rooms drive the "Open now" strip via their open hours.

**Critical timezone rule:** compute "now" and bucket events using the *event's* timezone (`meta.timezone`, America/Chicago), NOT the device timezone. Times in the JSON are event-local wall-clock ISO strings with an explicit `-05:00` offset. Parse with the offset; format for display with `Intl.DateTimeFormat({ timeZone: meta.timezone })`. Never rely on the device's local offset — a remote or misconfigured device must still see correct Central times (AC5).

**Now/next computation should be pure and unit-testable** (PRD suggests `js/now.js` separate from `js/app.js`). "Happening now" = events where `start <= now < end`; "Up Next" = next N starting after now today. Testing overrides the clock by injecting a `NOW` value rather than reading the real time — keep the time source injectable.

**Offline/caching (when the service worker is built):** cache the app shell (HTML/CSS/JS/icons) cache-first; cache `data/schedule.json` stale-while-revalidate so a manual Refresh can pull a newer copy online while offline still works. Invalidate by bumping a `CACHE_VERSION` constant. Favorites are starred event `id`s in `localStorage`.

## Data caveat

`meta.confidence` in `schedule.json` flags that panel/model sessions are high-confidence transcriptions, but grid-only items (tournaments, ceremonies, Dojo sessions, karaoke) and standing-room open hours are best-effort reads of the source PDF grid. Verify these against [`docs/gfest-2026-schedule-source.pdf`](./docs/gfest-2026-schedule-source.pdf) before treating exact minutes as authoritative.

## Constraints (do not violate)

- **Plain HTML + CSS + vanilla JS. No build toolchain.** Do not add React, bundlers, or a framework. A tiny library is acceptable only if it introduces no build step.
- Target < 500 KB total payload, < 3s cold load on 2G. Render lists with plain DOM.
- Accessibility: semantic HTML, tap targets >= 44px, sufficient contrast, respect `prefers-reduced-motion`.
