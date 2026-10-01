import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { positionByCode } from '../public/positions.js';
import { buildRoster, computeScores, fullName, participants, MIN_SCORE, MAX_SCORE } from './game.js';
import { buildTeams, teamStats } from './teams.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const fail = (status, message) => {
  throw new HttpError(status, message);
};

export function createApp(store) {
  const routes = [
    ['GET', /^\/api\/players$/, listPlayers],
    ['POST', /^\/api\/players$/, createPlayer],
    ['PUT', /^\/api\/players\/([\w-]+)$/, updatePlayer],
    ['GET', /^\/api\/events$/, listEvents],
    ['POST', /^\/api\/events$/, createEvent],
    ['GET', /^\/api\/events\/([\w-]+)$/, getEvent],
    ['DELETE', /^\/api\/events\/([\w-]+)$/, deleteEvent],
    ['POST', /^\/api\/events\/([\w-]+)\/poll$/, poll],
    ['POST', /^\/api\/events\/([\w-]+)\/teams$/, generateTeams],
    ['POST', /^\/api\/events\/([\w-]+)\/complete$/, completeEvent],
    ['POST', /^\/api\/events\/([\w-]+)\/ratings$/, submitRatings],
  ];

  // ---- helpers -------------------------------------------------------------

  const { data } = store;

  function scoredPlayers() {
    const scores = computeScores(data.players, data.events);
    return data.players.map((p) => ({ ...p, name: fullName(p), ...scores.get(p.id) }));
  }

  function playersById() {
    return new Map(scoredPlayers().map((p) => [p.id, p]));
  }

  function findEvent(id) {
    return data.events.find((e) => e.id === id) ?? fail(404, 'Game not found');
  }

  function requirePlayer(id) {
    return data.players.find((p) => p.id === id) ?? fail(400, 'Unknown player — please sign in again');
  }

  function presentEvent(event, me) {
    const players = playersById();
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

  // ---- players -------------------------------------------------------------

  function listPlayers() {
    return scoredPlayers().sort((p, q) => q.rating - p.rating || p.name.localeCompare(q.name));
  }

  async function createPlayer({ body }) {
    const player = { id: randomUUID(), ...validatePlayer(body), createdAt: new Date().toISOString() };
    data.players.push(player);
    await store.save();
    return [201, playersById().get(player.id)];
  }

  async function updatePlayer({ params: [id], body }) {
    const player = data.players.find((p) => p.id === id) ?? fail(404, 'Player not found');
    Object.assign(player, validatePlayer({ ...player, ...body }));
    await store.save();
    return playersById().get(id);
  }

  // ---- events --------------------------------------------------------------

  function listEvents({ query }) {
    const me = query.get('me');
    return data.events
      .map((e) => presentEvent(e, me))
      .sort((e, f) => `${e.date} ${e.time}`.localeCompare(`${f.date} ${f.time}`));
  }

  async function createEvent({ body }) {
    requirePlayer(body.createdBy);
    const event = {
      id: randomUUID(),
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
    await store.save();
    return [201, presentEvent(event, body.createdBy)];
  }

  function getEvent({ params: [id], query }) {
    return presentEvent(findEvent(id), query.get('me'));
  }

  async function deleteEvent({ params: [id], query }) {
    const event = findEvent(id);
    if (event.createdBy !== query.get('me')) fail(403, 'Only the organiser can delete this game');
    data.events.splice(data.events.indexOf(event), 1);
    await store.save();
    return { ok: true };
  }

  async function poll({ params: [id], body }) {
    const event = findEvent(id);
    if (event.status === 'completed') fail(409, 'This game has already been played');
    requirePlayer(body.playerId);
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
    await store.save();
    return presentEvent(event, body.playerId);
  }

  async function generateTeams({ params: [id], body }) {
    const event = findEvent(id);
    if (event.status === 'completed') fail(409, 'This game has already been played');
    requirePlayer(body.playerId);
    const { confirmed } = buildRoster(event, playersById());
    if (confirmed.length < 2) fail(409, 'Need at least 2 players to make teams');
    const strip = ({ id: pid, name, position, rating, guest, slot }) => ({ id: pid, name, position, rating, guest, slot });
    const { a, b } = buildTeams(confirmed);
    event.teams = { a: a.map(strip), b: b.map(strip), generatedAt: new Date().toISOString() };
    await store.save();
    return presentEvent(event, body.playerId);
  }

  async function completeEvent({ params: [id], body }) {
    const event = findEvent(id);
    requirePlayer(body.playerId);
    if (event.status === 'completed') fail(409, 'Already marked as played');
    if (!event.teams) fail(409, 'Make the teams before marking the game as played');
    event.status = 'completed';
    event.completedAt = new Date().toISOString();
    await store.save();
    return presentEvent(event, body.playerId);
  }

  async function submitRatings({ params: [id], body }) {
    const event = findEvent(id);
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
    await store.save();
    return presentEvent(event, body.raterId);
  }

  // ---- http plumbing -------------------------------------------------------

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        for (const [method, pattern, handler] of routes) {
          const m = url.pathname.match(pattern);
          if (!m || method !== req.method) continue;
          const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
          const result = await handler({ params: m.slice(1), query: url.searchParams, body });
          const [status, payload] = Array.isArray(result) && typeof result[0] === 'number' ? result : [200, result];
          return send(res, status, payload);
        }
        fail(404, 'Not found');
      }
      return await serveStatic(url.pathname, res);
    } catch (err) {
      if (!(err instanceof HttpError)) console.error(err);
      send(res, err.status ?? 500, { error: err instanceof HttpError ? err.message : 'Something went wrong' });
    }
  };
}

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

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) fail(413, 'Request too large');
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fail(400, 'Expected a JSON object');
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(400, 'Invalid JSON');
  }
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = normalize(join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR) || file.includes(`${sep}..`)) fail(404, 'Not found');
  let content;
  try {
    content = await readFile(file);
  } catch {
    fail(404, 'Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(content);
}
