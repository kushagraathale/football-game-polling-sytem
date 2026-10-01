import { positionByCode } from './positions.js';
import { buildRoster, computeScores, fullName, participants, MIN_SCORE, MAX_SCORE } from './game.js';
import { buildTeams, teamStats } from './teams.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

// [method, path pattern, handler, writes?]
const routes = [
  ['GET', /^\/players$/, listPlayers],
  ['POST', /^\/players$/, createPlayer, true],
  ['PUT', /^\/players\/([\w-]+)$/, updatePlayer, true],
  ['GET', /^\/events$/, listEvents],
  ['POST', /^\/events$/, createEvent, true],
  ['GET', /^\/events\/([\w-]+)$/, getEvent],
  ['DELETE', /^\/events\/([\w-]+)$/, deleteEvent, true],
  ['POST', /^\/events\/([\w-]+)\/poll$/, poll, true],
  ['POST', /^\/events\/([\w-]+)\/teams$/, generateTeams, true],
  ['POST', /^\/events\/([\w-]+)\/complete$/, completeEvent, true],
  ['POST', /^\/events\/([\w-]+)\/ratings$/, submitRatings, true],
];

/**
 * Handle one API request. `path` is the part after `/api` (e.g. `/players`).
 * `store` provides `read()` and `transaction(fn)`; see store.js.
 */
export async function handleApi(request, path, store) {
  const url = new URL(request.url);
  try {
    for (const [method, pattern, handler, writes] of routes) {
      const m = path.match(pattern);
      if (!m || method !== request.method) continue;
      const body = ['POST', 'PUT'].includes(request.method) ? await readJson(request) : {};
      const ctx = { params: m.slice(1), query: url.searchParams, body };
      const result = writes
        ? await store.transaction((data) => handler({ ...ctx, data }))
        : await handler({ ...ctx, data: await store.read() });
      const [status, payload] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result];
      return json(status, payload);
    }
    fail(404, 'Not found');
  } catch (err) {
    if (!(err instanceof HttpError)) console.error(err);
    return json(err.status ?? 500, { error: err instanceof HttpError ? err.message : 'Something went wrong' });
  }
}

// ---- helpers -----------------------------------------------------------------

function scoredPlayers(data) {
  const scores = computeScores(data.players, data.events);
  return data.players.map((p) => ({ ...p, name: fullName(p), ...scores.get(p.id) }));
}

function playersById(data) {
  return new Map(scoredPlayers(data).map((p) => [p.id, p]));
}

function findEvent(data, id) {
  return data.events.find((e) => e.id === id) ?? fail(404, 'Game not found');
}

function requirePlayer(data, id) {
  return data.players.find((p) => p.id === id) ?? fail(400, 'Unknown player — please sign in again');
}

function presentEvent(data, event, me) {
  const players = playersById(data);
  const roster = buildRoster(event, players);
  let teams = null;
  if (event.teams) {
    const confirmedIds = roster.confirmed.map((p) => p.id).sort().join();
    const teamIds = [...event.teams.a, ...event.teams.b].map((p) => p.id).sort().join();
    teams = {
      ...event.teams,
      statsA: teamStats(event.teams.a),
      statsB: teamStats(event.teams.b),
      stale: event.status !== 'completed' && confirmedIds !== teamIds,
    };
  }
  const { ratings = {}, responses, ...rest } = event;
  return {
    ...rest,
    responses,
    roster,
    teams,
    ratedBy: Object.keys(ratings),
    myRatings: me ? ratings[me] ?? null : null,
    createdByName: players.get(event.createdBy)?.name ?? 'Someone',
  };
}

// ---- players -------------------------------------------------------------------

function listPlayers({ data }) {
  return scoredPlayers(data).sort((p, q) => q.rating - p.rating || p.name.localeCompare(q.name));
}

function createPlayer({ data, body }) {
  const player = { id: crypto.randomUUID(), ...validatePlayer(body), createdAt: new Date().toISOString() };
  data.players.push(player);
  return [201, playersById(data).get(player.id)];
}

function updatePlayer({ data, params: [id], body }) {
  const player = data.players.find((p) => p.id === id) ?? fail(404, 'Player not found');
  Object.assign(player, validatePlayer({ ...player, ...body }));
  return playersById(data).get(id);
}

// ---- events --------------------------------------------------------------------

function listEvents({ data, query }) {
  const me = query.get('me');
  return data.events
    .map((e) => presentEvent(data, e, me))
    .sort((e, f) => `${e.date} ${e.time}`.localeCompare(`${f.date} ${f.time}`));
}

function createEvent({ data, body }) {
  requirePlayer(data, body.createdBy);
  const event = {
    id: crypto.randomUUID(),
    title: text(body.title, 'Title', 60) || '9-a-side',
    date: matches(body.date, /^\d{4}-\d{2}-\d{2}$/, 'Date'),
    time: matches(body.time, /^\d{2}:\d{2}$/, 'Kick-off time'),
    location: text(body.location, 'Location', 80),
    createdBy: body.createdBy,
    createdAt: new Date().toISOString(),
    status: 'open',
    responses: [],
    teams: null,
    ratings: {},
  };
  data.events.push(event);
  return [201, presentEvent(data, event, body.createdBy)];
}

function getEvent({ data, params: [id], query }) {
  return presentEvent(data, findEvent(data, id), query.get('me'));
}

function deleteEvent({ data, params: [id], query }) {
  const event = findEvent(data, id);
  if (event.createdBy !== query.get('me')) fail(403, 'Only the organiser can delete this game');
  data.events.splice(data.events.indexOf(event), 1);
  return { ok: true };
}

function poll({ data, params: [id], body }) {
  const event = findEvent(data, id);
  if (event.status === 'completed') fail(409, 'This game has already been played');
  requirePlayer(data, body.playerId);
  if (!['in', 'out', 'plus1'].includes(body.status)) fail(400, 'Answer must be In, Out or In +1');

  const going = (s) => s === 'in' || s === 'plus1';
  const existing = event.responses.find((r) => r.playerId === body.playerId);
  const response = existing ?? { playerId: body.playerId };
  // Switching between "In" and "In +1" keeps your place in the queue.
  if (!existing || !going(existing.status) || !going(body.status)) response.at = new Date().toISOString();
  response.status = body.status;
  if (body.status === 'plus1') {
    response.guestName = text(body.guestName, "Guest's name", 40) || null;
    response.guestPosition = positionByCode[body.guestPosition] ? body.guestPosition : null;
  } else {
    delete response.guestName;
    delete response.guestPosition;
  }
  if (!existing) event.responses.push(response);
  return presentEvent(data, event, body.playerId);
}

function generateTeams({ data, params: [id], body }) {
  const event = findEvent(data, id);
  if (event.status === 'completed') fail(409, 'This game has already been played');
  requirePlayer(data, body.playerId);
  const { confirmed } = buildRoster(event, playersById(data));
  if (confirmed.length < 2) fail(409, 'Need at least 2 players to make teams');
  const strip = ({ id: pid, name, position, rating, guest, slot }) => ({ id: pid, name, position, rating, guest, slot });
  const { a, b } = buildTeams(confirmed);
  event.teams = { a: a.map(strip), b: b.map(strip), generatedAt: new Date().toISOString() };
  return presentEvent(data, event, body.playerId);
}

function completeEvent({ data, params: [id], body }) {
  const event = findEvent(data, id);
  requirePlayer(data, body.playerId);
  if (event.status === 'completed') fail(409, 'Already marked as played');
  if (!event.teams) fail(409, 'Make the teams before marking the game as played');
  event.status = 'completed';
  event.completedAt = new Date().toISOString();
  return presentEvent(data, event, body.playerId);
}

function submitRatings({ data, params: [id], body }) {
  const event = findEvent(data, id);
  if (event.status !== 'completed') fail(409, 'Ratings open once the game has been played');
  const played = new Set(participants(event));
  if (!played.has(body.raterId)) fail(403, 'Only players from this game can rate it');
  if (!body.ratings || typeof body.ratings !== 'object') fail(400, 'No ratings given');

  const clean = {};
  for (const [targetId, raw] of Object.entries(body.ratings)) {
    if (targetId === body.raterId) fail(400, "You can't rate yourself");
    if (!played.has(targetId)) fail(400, 'You can only rate players from this game');
    const score = Number(raw);
    if (!Number.isInteger(score) || score < MIN_SCORE || score > MAX_SCORE) {
      fail(400, `Ratings must be whole numbers from ${MIN_SCORE} to ${MAX_SCORE}`);
    }
    clean[targetId] = score;
  }
  event.ratings ??= {};
  event.ratings[body.raterId] = clean;
  return presentEvent(data, event, body.raterId);
}

// ---- validation & http ------------------------------------------------------------

function validatePlayer(body) {
  const age = Number(body.age);
  if (!Number.isInteger(age) || age < 8 || age > 90) fail(400, 'Age must be a whole number between 8 and 90');
  if (!positionByCode[body.position]) fail(400, 'Pick your position on the pitch');
  return {
    firstName: text(body.firstName, 'First name', 30) || fail(400, 'First name is required'),
    lastName: text(body.lastName, 'Last name', 30) || fail(400, 'Last name is required'),
    age,
    position: body.position,
  };
}

function text(value, label, max) {
  if (value == null) return '';
  if (typeof value !== 'string') fail(400, `${label} must be text`);
  const v = value.trim().replace(/\s+/g, ' ');
  if (v.length > max) fail(400, `${label} must be at most ${max} characters`);
  return v;
}

function matches(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(400, `${label} is required`);
  return value;
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 100_000) fail(413, 'Request too large');
  if (!raw) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(400, 'Invalid JSON');
  }
  return parsed && typeof parsed === 'object' ? parsed : fail(400, 'Expected a JSON object');
}

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
