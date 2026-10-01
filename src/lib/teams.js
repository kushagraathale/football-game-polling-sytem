import { POSITIONS, GROUPS, SUB, groupOf } from './positions.js';

const GROUP_ORDER = Object.keys(GROUPS); // GK, DEF, MID, FWD
const POSITION_PENALTY = 6; // rating points one extra player in a position group is "worth"

/**
 * Split players into two teams with similar strength and position coverage,
 * then give each player a slot on the pitch (or the substitute's bench).
 *
 * @param {Array<{id: string, name: string, position: string, rating: number}>} players
 * @returns {{a: Array, b: Array}} each entry is the input player plus `slot`
 */
export function buildTeams(players) {
  const maxSize = Math.ceil(players.length / 2);
  const a = [];
  const b = [];

  // Greedy pass: strongest players first, group by group, each to the team that needs them more.
  const sorted = [...players].sort(
    (p, q) =>
      GROUP_ORDER.indexOf(groupOf(p.position)) - GROUP_ORDER.indexOf(groupOf(q.position)) ||
      q.rating - p.rating ||
      p.name.localeCompare(q.name),
  );
  for (const player of sorted) {
    const group = groupOf(player.position);
    let target;
    if (a.length >= maxSize) target = b;
    else if (b.length >= maxSize) target = a;
    else {
      const ca = countGroup(a, group);
      const cb = countGroup(b, group);
      if (ca !== cb) target = ca < cb ? a : b;
      else target = sum(a) <= sum(b) ? a : b;
    }
    target.push(player);
  }

  // Improvement pass: keep making the single swap that lowers the cost most.
  for (let i = 0; i < 200; i++) {
    let best = null;
    let bestCost = cost(a, b);
    for (let x = 0; x < a.length; x++) {
      for (let y = 0; y < b.length; y++) {
        [a[x], b[y]] = [b[y], a[x]];
        const c = cost(a, b);
        if (c < bestCost - 1e-9) {
          bestCost = c;
          best = [x, y];
        }
        [a[x], b[y]] = [b[y], a[x]];
      }
    }
    if (!best) break;
    const [x, y] = best;
    [a[x], b[y]] = [b[y], a[x]];
  }

  return { a: assignSlots(a), b: assignSlots(b) };
}

/** Place players into pitch slots, preferring their chosen position. Extra players become subs. */
export function assignSlots(team) {
  const byRating = [...team].sort((p, q) => q.rating - p.rating || p.name.localeCompare(q.name));
  const free = new Set(POSITIONS.map((p) => p.code));
  const slotOf = new Map();

  const place = (fits) => {
    for (const player of byRating) {
      if (slotOf.has(player)) continue;
      const slot = POSITIONS.find((pos) => free.has(pos.code) && fits(player, pos));
      if (slot) {
        free.delete(slot.code);
        slotOf.set(player, slot.code);
      }
    }
  };

  place((p, pos) => pos.code === p.position); // exact position
  place((p, pos) => pos.group === groupOf(p.position)); // same line
  place((p, pos) => pos.group !== 'GK'); // any outfield gap
  place(() => true); // someone has to go in goal

  // Keep a valid lineup but bench the player who fits least: the lowest-rated one left over.
  return byRating
    .map((p) => ({ ...p, slot: slotOf.get(p) ?? SUB }))
    .sort((p, q) => slotIndex(p.slot) - slotIndex(q.slot));
}

export function teamStats(team) {
  const total = sum(team);
  return { total, average: team.length ? Math.round((total / team.length) * 10) / 10 : 0 };
}

function cost(a, b) {
  const avgA = a.length ? sum(a) / a.length : 0;
  const avgB = b.length ? sum(b) / b.length : 0;
  let positional = 0;
  for (const group of GROUP_ORDER) {
    positional += Math.max(0, Math.abs(countGroup(a, group) - countGroup(b, group)) - 1);
  }
  // Both sides need a keeper if there are enough keepers to go round.
  const keepers = countGroup(a, 'GK') + countGroup(b, 'GK');
  if (keepers >= 2 && (countGroup(a, 'GK') === 0 || countGroup(b, 'GK') === 0)) positional += 2;
  return Math.abs(avgA - avgB) * Math.max(a.length, b.length) + positional * POSITION_PENALTY;
}

function countGroup(team, group) {
  return team.filter((p) => groupOf(p.position) === group).length;
}

function sum(team) {
  return team.reduce((s, p) => s + p.rating, 0);
}

function slotIndex(slot) {
  const i = POSITIONS.findIndex((p) => p.code === slot);
  return i === -1 ? POSITIONS.length : i;
}
