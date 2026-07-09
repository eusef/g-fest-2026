# G-FEST Pocket Schedule

A quick, offline, installable schedule for the G-FEST kaiju convention. Shows what's happening **now**, what's **next**, the full 3-day schedule, and a personal starred list. Built to work with no cell service on the convention floor.

> Status: **spec + data ready, not yet built.** This repo currently contains the product spec and the schedule data. The app itself is the next step.

## What's here

| Path | What it is |
|------|-----------|
| [`PRD.md`](./PRD.md) | The full product spec: features, acceptance criteria, tech constraints, build order. Start here. |
| [`data/schedule.json`](./data/schedule.json) | The single source of truth. All events for G-FEST 2026 (times in Central), produced from the official PDF. The app is entirely driven by this file. |
| [`docs/gfest-2026-schedule-source.pdf`](./docs/gfest-2026-schedule-source.pdf) | The original official schedule, for reference/verification. |

## Building it

Read [`PRD.md`](./PRD.md). Summary: plain HTML/CSS/vanilla JS, no build step, PWA (manifest + service worker) for offline + install, `localStorage` for favorites. Deploy as static files (GitHub Pages recommended). Follow the incremental build order in PRD §14.

## Reusing it for another convention

The app reads only `data/schedule.json`. To adapt it for a different event, replace that file (same schema, see PRD §6) and swap the icons/name in the manifest. No code changes required.

## License

MIT (see `LICENSE`). Fork freely.
