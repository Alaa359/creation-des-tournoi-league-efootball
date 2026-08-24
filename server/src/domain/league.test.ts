import { describe, expect, it } from 'vitest';
import type { Match, Player } from './types';
import { computeStandings, generateLeagueSchedule } from './league';

const ids12 = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);

describe('generateLeagueSchedule', () => {
  it('12 joueurs aller simple : 66 matchs, 11 journées, chaque paire exactement une fois', () => {
    const ms = generateLeagueSchedule(ids12, false);
    expect(ms).toHaveLength(66);
    expect(new Set(ms.map((m) => m.round)).size).toBe(11);
    const pairs = ms.map((m) => [m.homeId, m.awayId].sort().join('|'));
    expect(new Set(pairs).size).toBe(66);
    for (const id of ids12) {
      expect(ms.filter((m) => m.homeId === id || m.awayId === id)).toHaveLength(11);
    }
  });

  it('effectif impair (7 joueurs) : 21 matchs, personne ne rencontre le BYE', () => {
    const ms = generateLeagueSchedule(ids12.slice(0, 7), false);
    expect(ms).toHaveLength(21);
    for (const m of ms) {
      expect(m.homeId).not.toBe('__BYE__');
      expect(m.awayId).not.toBe('__BYE__');
    }
  });

  it('aller-retour (4 joueurs) : 12 matchs sur 6 journées avec jambes miroir', () => {
    const ms = generateLeagueSchedule(ids12.slice(0, 4), true);
    expect(ms).toHaveLength(12);
    expect(Math.max(...ms.map((m) => m.round))).toBe(6);
    for (const first of ms.filter((m) => m.round <= 3)) {
      expect(
        ms.some(
          (m) =>
            m.round > 3 &&
            ((m.homeId === first.homeId && m.awayId === first.awayId) ||
              (m.homeId === first.awayId && m.awayId === first.homeId)),
        ),
      ).toBe(true);
    }
  });
});

describe('computeStandings', () => {
  it('trie par points → différence → buts marqués → nom', () => {
    const players: Player[] = [
      { id: 'a', name: 'Alice' },
      { id: 'b', name: 'Bob' },
      { id: 'c', name: 'Chloé' },
    ];
    const matches: Match[] = [
      { id: '1', round: 1, homeId: 'a', awayId: 'b', homeScore: 2, awayScore: 0 },
      { id: '2', round: 1, homeId: 'b', awayId: 'c', homeScore: 1, awayScore: 1 },
      { id: '3', round: 1, homeId: 'c', awayId: 'a', homeScore: 0, awayScore: 3 },
    ];
    const rows = computeStandings(players, matches);
    expect(rows.map((r) => r.playerId)).toEqual(['a', 'b', 'c']);
    expect(rows[0]).toMatchObject({ points: 6, played: 2, won: 2, goalsFor: 5, goalDiff: 5 });
    expect(rows[1].points).toBe(1);
    expect(rows[1].goalDiff).toBe(-2);
    expect(rows[2].goalDiff).toBe(-3);
  });

  it('ignore les matchs non joués', () => {
    const players: Player[] = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
    const rows = computeStandings(players, [
      { id: 'x', round: 1, homeId: 'a', awayId: 'b' },
    ]);
    expect(rows.every((r) => r.played === 0 && r.points === 0)).toBe(true);
  });
});
