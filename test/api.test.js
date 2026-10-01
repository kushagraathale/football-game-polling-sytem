import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../src/lib/api.js';
import { MemoryStore } from '../src/lib/store.js';
import { POSITIONS } from '../src/lib/positions.js';

const store = new MemoryStore();

async function call(method, path, body) {
  const url = new URL(path, 'http://localhost');
  const request = new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  const res = await handleApi(request, url.pathname.replace(/^\/api/, ''), store);
  return { status: res.status, body: await res.json() };
}

test('full game flow: onboard, poll, teams, play, rate', async () => {
  const bad = await call('POST', '/api/players', { firstName: 'A', lastName: 'B', age: 30, position: 'XX' });
  assert.equal(bad.status, 400);

  const players = [];
  for (let i = 0; i < 18; i++) {
    const { status, body } = await call('POST', '/api/players', {
      firstName: `First${i}`, lastName: `Last${i}`, age: 20 + i, position: POSITIONS[i % 8].code,
    });
    assert.equal(status, 201);
    assert.equal(body.rating, 60);
    players.push(body);
  }

  const created = await call('POST', '/api/events', { title: 'Sunday', date: '2026-10-04', time: '10:00', location: 'Park', createdBy: players[0].id });
  assert.equal(created.status, 201);
  const id = created.body.id;

  for (const p of players.slice(0, 16)) await call('POST', `/api/events/${id}/poll`, { playerId: p.id, status: 'in' });
  const plus = await call('POST', `/api/events/${id}/poll`, { playerId: players[16].id, status: 'plus1', guestName: 'Guest', guestPosition: 'ST' });
  assert.equal(plus.body.roster.confirmed.length, 18);
  const late = await call('POST', `/api/events/${id}/poll`, { playerId: players[17].id, status: 'in' });
  assert.equal(late.body.roster.waitlist.length, 1);

  const early = await call('POST', `/api/events/${id}/complete`, { playerId: players[0].id });
  assert.equal(early.status, 409);

  const teams = await call('POST', `/api/events/${id}/teams`, { playerId: players[0].id });
  assert.equal(teams.status, 200);
  assert.equal(teams.body.teams.a.length, 9);
  assert.equal(teams.body.teams.b.length, 9);
  assert.equal(teams.body.teams.stale, false);

  const done = await call('POST', `/api/events/${id}/complete`, { playerId: players[0].id });
  assert.equal(done.body.status, 'completed');

  const closed = await call('POST', `/api/events/${id}/poll`, { playerId: players[17].id, status: 'out' });
  assert.equal(closed.status, 409);

  const outsider = await call('POST', `/api/events/${id}/ratings`, { raterId: players[17].id, ratings: { [players[0].id]: 9 } });
  assert.equal(outsider.status, 403);
  const self = await call('POST', `/api/events/${id}/ratings`, { raterId: players[0].id, ratings: { [players[0].id]: 10 } });
  assert.equal(self.status, 400);
  const outOfRange = await call('POST', `/api/events/${id}/ratings`, { raterId: players[0].id, ratings: { [players[1].id]: 11 } });
  assert.equal(outOfRange.status, 400);

  const rated = await call('POST', `/api/events/${id}/ratings`, { raterId: players[0].id, ratings: { [players[1].id]: 10, [players[2].id]: 2 } });
  assert.equal(rated.status, 200);
  assert.deepEqual(rated.body.ratedBy, [players[0].id]);

  const list = (await call('GET', '/api/players')).body;
  const find = (pid) => list.find((p) => p.id === pid);
  assert.ok(find(players[1].id).rating > 60);
  assert.ok(find(players[2].id).rating < 60);
  assert.equal(find(players[17].id).games, 0);
});

test('unknown routes and bad JSON are rejected cleanly', async () => {
  assert.equal((await call('GET', '/api/nope')).status, 404);
  const res = await handleApi(new Request('http://localhost/api/players', { method: 'POST', body: '{oops' }), '/players', store);
  assert.equal(res.status, 400);
});
