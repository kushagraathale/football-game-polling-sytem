import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster, computeScores } from '../src/lib/game.js';
import { DEFAULT_RATING, MAX_PLAYERS } from '../src/lib/positions.js';

const player = (id) => ({ id, firstName: id, lastName: 'X', position: 'CM', rating: 60 });

test('roster is first come first served, guests take a spot, overflow goes to the waitlist', () => {
  const players = Array.from({ length: 20 }, (_, i) => player(`p${i}`));
  const byId = new Map(players.map((p) => [p.id, p]));
  const responses = players.map((p, i) => ({
    playerId: p.id,
    status: i === 0 ? 'plus1' : i === 5 ? 'out' : 'in',
    guestName: i === 0 ? 'Sam' : undefined,
    at: new Date(2026, 0, 1, 0, i).toISOString(),
  }));
  const { confirmed, waitlist, out } = buildRoster({ responses }, byId);
  assert.equal(confirmed.length, MAX_PLAYERS);
  assert.equal(confirmed[1].name, 'Sam');
  assert.equal(confirmed[1].guest, true);
  assert.deepEqual(waitlist.map((p) => p.id), ['p18', 'p19']);
  assert.deepEqual(out.map((p) => p.id), ['p5']);
});

test('peer ratings move the score towards the match rating', () => {
  const players = [player('a'), player('b'), player('c')];
  const event = {
    id: 'e1', date: '2026-01-01', time: '10:00', createdAt: '2026-01-01', status: 'completed',
    teams: { a: [{ id: 'a' }, { id: 'b' }], b: [{ id: 'c' }, { id: 'guest:c', guest: true }] },
    ratings: { b: { a: 10, c: 3 }, c: { a: 9, b: 6 } },
  };
  const scores = computeScores(players, [event]);
  assert.ok(scores.get('a').rating > DEFAULT_RATING);
  assert.ok(scores.get('c').rating < DEFAULT_RATING);
  assert.equal(scores.get('b').rating, DEFAULT_RATING); // rated exactly 6/10
  assert.equal(scores.get('a').games, 1);
  assert.equal(scores.get('a').history[0].matchScore, 95);
});

test('games that are not completed do not affect scores', () => {
  const players = [player('a'), player('b')];
  const event = { id: 'e', date: '2026-01-01', time: '10:00', createdAt: '', status: 'open', teams: { a: [{ id: 'a' }], b: [{ id: 'b' }] }, ratings: { b: { a: 10 } } };
  assert.equal(computeScores(players, [event]).get('a').rating, DEFAULT_RATING);
});

test('scores stay between 0 and 100 after many great games', () => {
  const players = [player('a'), player('b')];
  const events = Array.from({ length: 30 }, (_, i) => ({
    id: `e${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`, time: '10:00', createdAt: '', status: 'completed',
    teams: { a: [{ id: 'a' }], b: [{ id: 'b' }] }, ratings: { b: { a: 10 }, a: { b: 1 } },
  }));
  const scores = computeScores(players, events);
  assert.ok(scores.get('a').rating <= 100 && scores.get('a').rating >= 99);
  assert.ok(scores.get('b').rating >= 0 && scores.get('b').rating <= 11);
});
