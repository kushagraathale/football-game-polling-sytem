import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTeams, assignSlots, teamStats } from '../src/lib/teams.js';
import { POSITIONS, SUB } from '../src/lib/positions.js';

const squad = (specs) => specs.map(([position, rating], i) => ({ id: `p${i}`, name: `Player ${i}`, position, rating }));

const FULL = squad([
  ['GK', 70], ['GK', 50],
  ['CB', 90], ['CB', 60], ['LB', 55], ['RB', 75], ['LB', 65], ['RB', 45],
  ['CM', 85], ['CM', 50], ['LM', 70], ['RM', 60], ['LM', 40], ['RM', 80],
  ['ST', 95], ['ST', 55], ['ST', 65], ['CM', 62],
]);

test('18 players split into two teams of 9 with 8 on the pitch and 1 sub', () => {
  const { a, b } = buildTeams(FULL);
  assert.equal(a.length, 9);
  assert.equal(b.length, 9);
  for (const team of [a, b]) {
    assert.equal(team.filter((p) => p.slot === SUB).length, 1);
    const slots = team.filter((p) => p.slot !== SUB).map((p) => p.slot).sort();
    assert.deepEqual(slots, POSITIONS.map((p) => p.code).sort());
  }
  const ids = new Set([...a, ...b].map((p) => p.id));
  assert.equal(ids.size, 18);
});

test('teams are balanced on rating', () => {
  const { a, b } = buildTeams(FULL);
  const diff = Math.abs(teamStats(a).average - teamStats(b).average);
  assert.ok(diff <= 2, `average rating difference too big: ${diff}`);
});

test('each team gets one of the two goalkeepers in goal', () => {
  const { a, b } = buildTeams(FULL);
  for (const team of [a, b]) {
    const keeper = team.find((p) => p.slot === 'GK');
    assert.equal(keeper.position, 'GK');
  }
});

test('players are placed in their chosen position when it is free', () => {
  const team = assignSlots(squad([['GK', 60], ['CB', 60], ['ST', 60], ['LM', 60]]));
  for (const p of team) assert.equal(p.slot, p.position);
});

test('when two players want the same spot the stronger one gets it and the other moves along the same line', () => {
  const team = assignSlots(squad([['CB', 80], ['CB', 60]]));
  assert.equal(team.find((p) => p.rating === 80).slot, 'CB');
  assert.ok(['LB', 'RB'].includes(team.find((p) => p.rating === 60).slot));
});

test('the goal is filled even without a natural keeper', () => {
  const team = assignSlots(squad([['ST', 70], ['ST', 60], ['ST', 50], ['CM', 50], ['CM', 50], ['CB', 50], ['CB', 50], ['LB', 50], ['RB', 40]]));
  assert.ok(team.some((p) => p.slot === 'GK'));
  assert.equal(team.filter((p) => p.slot === SUB).length, 1);
});

test('odd numbers give teams that differ by one player', () => {
  const { a, b } = buildTeams(FULL.slice(0, 11));
  assert.deepEqual([a.length, b.length].sort(), [5, 6]);
});
