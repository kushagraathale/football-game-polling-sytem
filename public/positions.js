// Shared between the browser and the server.
// 9-a-side: 8 players on the pitch (1-3-3-1) plus 1 substitute per team.

export const POSITIONS = [
  { code: 'GK', name: 'Goalkeeper', group: 'GK', x: 50, y: 89 },
  { code: 'LB', name: 'Left Back', group: 'DEF', x: 20, y: 70 },
  { code: 'CB', name: 'Centre Back', group: 'DEF', x: 50, y: 73 },
  { code: 'RB', name: 'Right Back', group: 'DEF', x: 80, y: 70 },
  { code: 'LM', name: 'Left Mid', group: 'MID', x: 20, y: 45 },
  { code: 'CM', name: 'Centre Mid', group: 'MID', x: 50, y: 49 },
  { code: 'RM', name: 'Right Mid', group: 'MID', x: 80, y: 45 },
  { code: 'ST', name: 'Striker', group: 'FWD', x: 50, y: 21 },
];

export const GROUPS = {
  GK: 'Goalkeeper',
  DEF: 'Defence',
  MID: 'Midfield',
  FWD: 'Attack',
};

export const ON_FIELD = POSITIONS.length; // 8
export const SUBS_PER_TEAM = 1;
export const TEAM_SIZE = ON_FIELD + SUBS_PER_TEAM; // 9
export const MAX_PLAYERS = TEAM_SIZE * 2; // 18
export const DEFAULT_RATING = 60;
export const GUEST_RATING = 55;
export const SUB = 'SUB';

export const positionByCode = Object.fromEntries(POSITIONS.map((p) => [p.code, p]));

export function groupOf(code) {
  return positionByCode[code]?.group ?? 'MID';
}
