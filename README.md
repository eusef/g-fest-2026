# G-FEST Pocket Schedule

A quick, offline, installable schedule for the G-FEST kaiju convention. Shows what's happening **now**, what's **next**, the full 3-day schedule, and a personal starred list. Built to work with no cell service on the convention floor.

> Status: **built.** Plain HTML/CSS/vanilla JS PWA — no build step, no dependencies. Driven entirely by [`data/schedule.json`](./data/schedule.json).

## What's here

| Path | What it is |
|------|-----------|
| [`index.html`](./index.html) | App shell (header, view container, tab bar). |
| [`css/styles.css`](./css/styles.css) | Design system; light + dark via `prefers-color-scheme`. |
| [`js/now.js`](./js/now.js) | Pure now/next/time computation (timezone-safe, unit-tested). |
| [`js/app.js`](./js/app.js) | Data load, hash routing, rendering, favorites, refresh, SW registration. |
| [`service-worker.js`](./service-worker.js) · [`manifest.webmanifest`](./manifest.webmanifest) | Offline caching + installability. |
| [`test/now.test.js`](./test/now.test.js) | Plain-Node tests for `now.js` (no deps). |
| [`data/schedule.json`](./data/schedule.json) | The single source of truth. All events for G-FEST 2026 (times in Central), produced from the official PDF. The app is entirely driven by this file. |
| [`PRD.md`](./PRD.md) | The full product spec: features, acceptance criteria, tech constraints, build order. |
| [`docs/gfest-2026-schedule-source.pdf`](./docs/gfest-2026-schedule-source.pdf) | The original official schedule, for reference/verification. |

## Running locally

A service worker requires HTTP(S), not `file://`. Serve the directory over HTTP:

```
python3 -m http.server 8000    # then open http://localhost:8000
```

Verify the data parses:

```
python3 -c "import json; d=json.load(open('data/schedule.json')); print(len(d['events']),'events')"
```

Run the now/next unit tests (no dependencies):

```
node test/now.test.js
```

## Deploying

Deploy target is Cloudflare at **`https://gfest.phils.pics`**, served at **root scope** (`/`). HTTPS is provided by Cloudflare, which the service worker requires. The manifest `start_url`/`scope` and the service worker scope are all `/`, so the app must be hosted at the domain root, not a subpath. Any static host that serves at root over HTTPS works the same way.

When redeploying updated app files, bump `CACHE_VERSION` in `service-worker.js` so returning users get the new assets (the app shell is cached cache-first).

## Reusing it for another convention

The app reads only `data/schedule.json`. To adapt it for a different event, replace that file with a valid same-schema file (see PRD §6) and swap the icons/name in the manifest. No code changes required (AC7).

## License

MIT (see `LICENSE`). Fork freely.
