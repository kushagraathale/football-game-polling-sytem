import { DEFAULT_RATING, GUEST_RATING, MAX_PLAYERS } from '../public/positions.js';

export const RATING_WEIGHT = 0.35; // how far one game moves a player's score towards their match rating
export const MIN_SCORE = 1;
export const MAX_SCORE = 10;

/**
 * Turn poll responses into the ordered list of people who are playing.
 * "In +1" adds the player and their guest. First come, first served up to MAX_PLAYERS;
 * everyone after that is on the waitlist.
 */
export function buildRoster(event, playersById) {
  const going = event.responses
    .filter((r) => r.status === 'in' || r.status === 'plus1')
    .sort((r, s) => r.at.localeCompare(s.at));

  const entries = [];
  for (const response of going) {
    const player = playersById.get(response.playerId);
    if (!player) continue;
    entries.push({
      id: player.id,
      name: fullName(player),
      position: player.position,
      rating: player.rating ?? DEFAULT_RATING,
      guest: false,
    });
    if (response.status === 'plus1') {
      entries.push({
        id: `guest:${player.id}`,
        name: response.guestName || `${player.firstName}'s guest`,
        position: response.guestPosition || player.position,
        rating: GUEST_RATING,
        guest: true,
        invitedBy: player.id,
      });
    }
  }

  const out = event.responses
    .filter((r) => r.status === 'out')
    .map((r) => playersById.get(r.playerId))
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: fullName(p) }));

  return { confirmed: entries.slice(0, MAX_PLAYERS), waitlist: entries.slice(MAX_PLAYERS), out };
}

/** Everyone who played in a completed game (guests can't rate or be rated: they have no profile). */
export function participants(event) {
  if (!event.teams) return [];
  return [...event.teams.a, ...event.teams.b].filter((p) => !p.guest).map((p) => p.id);
}

/**
 * Work out every player's score out of 100 by replaying peer ratings game by game.
 * Each game's average peer rating (1-10) becomes a match score (x10) and the player's
 * score moves part of the way towards it, so recent form counts but one game can't swing it wildly.
 */
export function computeScores(players, events) {
  const scores = new Map(players.map((p) => [p.id, { rating: p.baseRating ?? DEFAULT_RATING, games: 0, rated: 0, history: [] }]));

  const completed = events
    .filter((e) => e.status === 'completed')
    .sort((e, f) => `${e.date} ${e.time}`.localeCompare(`${f.date} ${f.time}`) || e.createdAt.localeCompare(f.createdAt));

  for (const event of completed) {
    const played = participants(event);
    const received = new Map();
    for (const [raterId, given] of Object.entries(event.ratings ?? {})) {
      for (const [targetId, score] of Object.entries(given)) {
        if (targetId === raterId) continue;
        if (!received.has(targetId)) received.set(targetId, []);
        received.get(targetId).push(score);
      }
    }
    for (const id of played) {
      const s = scores.get(id);
      if (!s) continue;
      s.games += 1;
      const got = received.get(id);
      if (!got?.length) continue;
      const matchScore = (got.reduce((t, v) => t + v, 0) / got.length) * 10;
      s.rating += RATING_WEIGHT * (matchScore - s.rating);
      s.rated += 1;
      s.history.push({ eventId: event.id, date: event.date, matchScore: round1(matchScore), rating: Math.round(s.rating) });
    }
  }

  for (const s of scores.values()) s.rating = Math.max(0, Math.min(100, Math.round(s.rating)));
  return scores;
}

export function fullName(player) {
  return `${player.firstName} ${player.lastName}`.trim();
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
