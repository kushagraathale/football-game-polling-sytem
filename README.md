# ⚽ Matchday: 9-a-side organiser

A minimal, light, pastel web app for running a weekly 9-a-side game: **8 players on the pitch + 1 substitute per team**, so up to 18 players per game.

## Features

- **Onboarding**: first and last name, age, and a playing position picked by tapping it on a real football pitch (1-3-3-1 formation: GK, LB, CB, RB, LM, CM, RM, ST).
- **Polling**: every game has an **In / Out / In +1** poll. "In +1" adds a named guest (with a position). Spots are first come, first served up to 18; anyone after that goes on a waitlist.
- **Balanced teams**: one click splits the squad into Team Sky and Team Peach. Teams are balanced on player ratings and on position lines (GK / defence / midfield / attack). Each player is then placed on the pitch in their preferred position where possible, and the extra player becomes the sub. The teams are shown on two pitches.
- **Peer ratings**: once a game is marked as played, everyone who played rates the other players from 1 to 10.
- **Player scores out of 100**: everyone starts at 60. After each game, a player's score moves 35% of the way towards their match score (average peer rating × 10). Good form counts, but one game can't swing a score wildly. Future teams are balanced using these scores.
- **Player cards**: name, age, position and rating, colour-coded by position line. The "Me" page shows your card, your rating history, and lets you edit your profile.

## Running it locally

Needs Node.js 22.12+.

```bash
npm install
npm run dev        # http://localhost:4321/CLOUD_MOUNT_PATH  (sets up a local database first)
npm test           # unit, API and storage tests
```

`CLOUD_MOUNT_PATH` in `astro.config.mjs` is a placeholder that Webflow Cloud replaces with the app's real mount path (e.g. `/matchday`) at deploy time.

## Hosting on Webflow Cloud

This is an [Astro](https://astro.build) app set up for [Webflow Cloud](https://webflow.com/cloud), which runs it on Cloudflare Workers with a D1 (SQLite) database:

- `webflow.json` tells Webflow it's an Astro app.
- `wrangler.json` declares the `DB` database, and Webflow creates it on the first deploy.
- `migrations/` sets up the table, and Webflow runs it automatically.

Once the app is connected to this GitHub repo and branch in the Webflow dashboard, every push deploys automatically.

## How it's built

```
src/pages/index.astro        the page shell
src/pages/api/[...path].js   API endpoint (connects the API to the D1 database)
src/client/                  single-page frontend (vanilla JS, hash routing) + pastel styles
src/lib/api.js               REST API (standard Request/Response)
src/lib/teams.js             team balancing and pitch-slot assignment
src/lib/game.js              poll roster (cap + waitlist) and rating maths
src/lib/store.js             D1 storage with safe concurrent writes (+ in-memory store for tests)
src/lib/positions.js         formation/positions shared by client and server
migrations/                  D1 schema
test/                        node:test suites
```

All state is a single JSON document in one D1 row with a version number. If two people save at the same moment, the second save is retried on fresh data instead of overwriting the first.

### API

All routes live under `<mount>/api`.

| Method | Path | Body |
|---|---|---|
| GET  | `/api/players` | |
| POST | `/api/players` | `firstName, lastName, age, position` |
| PUT  | `/api/players/:id` | same as above |
| GET  | `/api/events?me=<playerId>` | |
| POST | `/api/events` | `title, date, time, location, createdBy` |
| GET  | `/api/events/:id?me=<playerId>` | |
| DELETE | `/api/events/:id?me=<playerId>` | (organiser only) |
| POST | `/api/events/:id/poll` | `playerId, status (in/out/plus1), guestName?, guestPosition?` |
| POST | `/api/events/:id/teams` | `playerId` |
| POST | `/api/events/:id/complete` | `playerId` |
| POST | `/api/events/:id/ratings` | `raterId, ratings: { playerId: 1-10 }` |

### Notes and limitations

- Identity is lightweight: your player ID is remembered in the browser and there are no passwords. This suits a trusted group of friends, but add real authentication before putting it on the open internet.
- Guests (+1s) play at a fixed rating of 55. They aren't rated because they have no profile.
