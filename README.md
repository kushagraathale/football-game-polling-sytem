# ⚽ Matchday: 9-a-side organiser

A minimal, light, pastel web app for running a weekly 9-a-side game: **8 players on the pitch + 1 substitute per team**, so up to 18 players per game.

## Features

- **Onboarding**: first and last name, age, and a playing position picked by tapping it on a real football pitch (1-3-3-1 formation: GK, LB, CB, RB, LM, CM, RM, ST).
- **Polling**: every game has an **In / Out / In +1** poll. "In +1" adds a named guest (with a position). Spots are first come, first served up to 18; anyone after that goes on a waitlist.
- **Balanced teams**: one click splits the squad into Team Sky and Team Peach. Teams are balanced on player ratings and on position lines (GK / defence / midfield / attack). Each player is then placed on the pitch in their preferred position where possible, and the extra player becomes the sub. The teams are shown on two pitches.
- **Peer ratings**: once a game is marked as played, everyone who played rates the other players from 1 to 10.
- **Player scores out of 100**: everyone starts at 60. After each game, a player's score moves 35% of the way towards their match score (average peer rating × 10). Good form counts, but one game can't swing a score wildly. Future teams are balanced using these scores.
- **Player cards**: name, age, position and rating, colour-coded by position line. The "Me" page shows your card, your rating history, and lets you edit your profile.

## Running it

Needs Node.js 18+ and has **no dependencies**.

```bash
npm start          # http://localhost:3000
npm test           # unit + API tests
```

Environment variables:

| Variable    | Default         | Purpose                     |
|-------------|-----------------|-----------------------------|
| `PORT`      | `3000`          | HTTP port                   |
| `DATA_FILE` | `data/db.json`  | Where the JSON database is saved |

## How it's built

```
server.js          HTTP server entry point
lib/app.js         REST API + static file serving
lib/teams.js       team balancing and pitch-slot assignment
lib/game.js        poll roster (cap + waitlist) and rating maths
lib/store.js       atomic JSON-file persistence
public/            single-page frontend (vanilla JS, hash routing)
public/positions.js  formation/positions shared by client and server
test/              node:test suites
```

### API

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
