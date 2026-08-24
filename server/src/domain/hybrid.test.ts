import { describe, expect, it } from 'vitest';
import { computeStandings } from './league';
import {
  buildGroupSeeds,
  generateGroups,
  isKnockoutMatch,
  maybeGenerateKnockoutPhase,
  roundRobinMatches,
} from './hybrid';
import type { Match, Tournament } from './types';

/** PRNG déterministe (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeTournament(partial: Partial<Tournament>): Tournament {
  const names = ['Ali', 'Salah', 'Ameur', 'Karim', 'Mehdi', 'Yassine'];
  const count = partial.players?.length ?? 6;
  return {
    id: 'test',
    name: 'Test',
    type: 'groups-knockout',
    doubleRound: false,
    createdAt: new Date().toISOString(),
    players: names.slice(0, count).map((name, i) => ({ id: `p${i + 1}`, name })),
    matches: [],
    ...partial,
  };
}

/** Joue tous les matchs round-robin : p{i} est plus fort que p{j} pour i > j. */
function playRoundRobin(t: Tournament): void {
  const index = new Map(t.players.map((p, i) => [p.id, i]));
  for (const m of roundRobinMatches(t)) {
    if (!m.homeId || !m.awayId) continue;
    const diff = index.get(m.homeId)! - index.get(m.awayId)!;
    m.homeScore = diff > 0 ? 2 : diff < 0 ? 0 : 1;
    m.awayScore = diff < 0 ? 2 : diff > 0 ? 0 : 1;
  }
}

describe('generateGroups', () => {
  it('répartit tous les joueurs avec des effectifs équilibrés', () => {
    const ids = Array.from({ length: 7 }, (_, i) => `p${i}`);
    const groups = generateGroups(ids, 3, makeRng(42));
    expect(groups).toHaveLength(3);
    expect(groups.flat().sort()).toEqual([...ids].sort());
    expect(groups.map((g) => g.length).sort()).toEqual([2, 2, 3]);
  });

  it('produit des groupes disjoints quel que soit le tirage', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `p${i}`);
    for (let seed = 0; seed < 20; seed++) {
      const groups = generateGroups(ids, 2, makeRng(seed));
      expect(new Set(groups.flat()).size).toBe(8);
    }
  });
});

describe('buildGroupSeeds', () => {
  it('croise vainqueurs et dauphins inversés', () => {
    expect(buildGroupSeeds(['A1', 'B1'], ['A2', 'B2'])).toEqual(['A1', 'B2', 'B1', 'A2']);
  });

  it('ne garde que les vainqueurs si aucun dauphin', () => {
    expect(buildGroupSeeds(['A1', 'B1'], [])).toEqual(['A1', 'B1']);
  });
});

describe('isKnockoutMatch / roundRobinMatches', () => {
  it('déduit la phase du type du tournoi pour les tournois sans champ phase', () => {
    const koT = makeTournament({
      type: 'knockout',
      players: [
        { id: 'p1', name: 'A' },
        { id: 'p2', name: 'B' },
      ],
    });
    koT.matches = [{ id: 'm1', round: 1, homeId: 'p1', awayId: 'p2' }];
    expect(isKnockoutMatch(koT, koT.matches[0])).toBe(true);

    const lgT = makeTournament({ type: 'league' });
    lgT.matches = [{ id: 'm1', round: 1, homeId: 'p1', awayId: 'p2' }];
    expect(isKnockoutMatch(lgT, lgT.matches[0])).toBe(false);
  });
});

describe('maybeGenerateKnockoutPhase — league-knockout', () => {
  it('ne génère rien tant que le championnat n’est pas terminé', () => {
    const t = makeTournament({ type: 'league-knockout', qualifiers: 4 });
    t.matches = [
      { id: 'm1', round: 1, homeId: 'p1', awayId: 'p2', homeScore: 1, awayScore: 0 },
      { id: 'm2', round: 1, homeId: 'p3', awayId: 'p4' },
    ];
    expect(maybeGenerateKnockoutPhase(t)).toBe(false);
    expect(t.matches).toHaveLength(2);
  });

  it('génère un bracket avec les N premiers une fois tout joué', () => {
    const t = makeTournament({ type: 'league-knockout', qualifiers: 4 });
    for (let i = 0; i < t.players.length; i++) {
      for (let j = i + 1; j < t.players.length; j++) {
        t.matches.push({
          id: `rr-${i}-${j}`,
          round: 1,
          homeId: t.players[i].id,
          awayId: t.players[j].id,
        });
      }
    }
    playRoundRobin(t);

    const expectedTop4 = computeStandings(t.players, t.matches)
      .slice(0, 4)
      .map((r) => r.playerId)
      .sort();

    expect(maybeGenerateKnockoutPhase(t)).toBe(true);
    const ko = t.matches.filter((m) => m.phase === 'knockout');
    expect(ko.length).toBeGreaterThan(0);
    const firstRound = ko.filter((m) => m.round === 1);
    const participants = firstRound
      .flatMap((m) => [m.homeId, m.awayId])
      .filter((x): x is string => x != null)
      .sort();
    expect(participants).toEqual(expectedTop4);
    expect(firstRound.every((m) => m.homeId && m.awayId)).toBe(true);
  });

  it('est idempotent : un appel supplémentaire ne duplique pas les éliminations', () => {
    const t = makeTournament({ type: 'league-knockout', qualifiers: 2 });
    t.matches = [
      { id: 'm1', round: 1, homeId: 'p1', awayId: 'p2', homeScore: 2, awayScore: 0 },
      { id: 'm2', round: 1, homeId: 'p1', awayId: 'p3', homeScore: 1, awayScore: 0 },
      { id: 'm3', round: 1, homeId: 'p2', awayId: 'p3', homeScore: 1, awayScore: 1 },
      { id: 'm4', round: 2, homeId: 'p1', awayId: 'p4', homeScore: 3, awayScore: 0 },
      { id: 'm5', round: 2, homeId: 'p5', awayId: 'p6', homeScore: 0, awayScore: 0 },
      { id: 'm6', round: 3, homeId: 'p2', awayId: 'p5', homeScore: 2, awayScore: 1 },
      { id: 'm7', round: 3, homeId: 'p3', awayId: 'p6', homeScore: 1, awayScore: 2 },
      { id: 'm8', round: 4, homeId: 'p4', awayId: 'p6', homeScore: 0, awayScore: 1 },
      { id: 'm9', round: 5, homeId: 'p5', awayId: 'p3', homeScore: 4, awayScore: 4 },
    ];
    // 6 joueurs → 15 matchs ; on complète avec les manquants
    const seen = new Set(
      t.matches.flatMap((m) => [`${m.homeId}|${m.awayId}`, `${m.awayId}|${m.homeId}`]),
    );
    for (let i = 0; i < t.players.length; i++) {
      for (let j = i + 1; j < t.players.length; j++) {
        const a = t.players[i].id;
        const b = t.players[j].id;
        if (!seen.has(`${a}|${b}`)) {
          t.matches.push({ id: `rr-x-${a}-${b}`, round: 6, homeId: a, awayId: b, homeScore: 0, awayScore: 0 });
        }
      }
    }
    expect(maybeGenerateKnockoutPhase(t)).toBe(true);
    const countKo = t.matches.filter((m) => m.phase === 'knockout').length;
    expect(countKo).toBeGreaterThan(0);
    expect(maybeGenerateKnockoutPhase(t)).toBe(false);
    expect(t.matches.filter((m) => m.phase === 'knockout')).toHaveLength(countKo);
  });
});

describe('maybeGenerateKnockoutPhase — groups-knockout', () => {
  it('qualifie les 2 premiers de chaque groupe sans les croiser au 1er tour', () => {
    const t = makeTournament({ type: 'groups-knockout', groupsCount: 2, qualifiedPerGroup: 2 });
    t.groups = [
      ['p1', 'p2', 'p3'],
      ['p4', 'p5', 'p6'],
    ];
    t.matches = [];
    for (const group of t.groups) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          t.matches.push({
            id: `g-${group[i]}-${group[j]}`,
            round: 1,
            phase: 'group',
            homeId: group[i],
            awayId: group[j],
          });
        }
      }
    }
    playRoundRobin(t);

    expect(maybeGenerateKnockoutPhase(t)).toBe(true);
    const ko = t.matches.filter((m) => m.phase === 'knockout');
    const firstRound = ko.filter((m) => m.round === 1);
    expect(firstRound).toHaveLength(2);

    for (const m of firstRound as Match[]) {
      expect(m.homeId).toBeTruthy();
      expect(m.awayId).toBeTruthy();
      const sameGroup = t.groups!.some((g) => g.includes(m.homeId!) && g.includes(m.awayId!));
      expect(sameGroup).toBe(false);
    }

    // Les qualifiés sont exactement les 2 premiers de chaque groupe
    const rr = t.matches.filter((m) => m.phase !== 'knockout');
    const expected = t
      .groups!.flatMap((g) =>
        computeStandings(
          t.players.filter((p) => g.includes(p.id)),
          rr,
        )
          .slice(0, 2)
          .map((r) => r.playerId),
      )
      .sort();
    const participants = firstRound.flatMap((m) => [m.homeId, m.awayId]).sort();
    expect(participants).toEqual(expected);
  });

  it('ne génère rien si un match de groupe manque', () => {
    const t = makeTournament({ type: 'groups-knockout', groupsCount: 2, qualifiedPerGroup: 1 });
    t.groups = [
      ['p1', 'p2'],
      ['p3', 'p4'],
    ];
    t.matches = [
      { id: 'm1', round: 1, phase: 'group', homeId: 'p1', awayId: 'p2', homeScore: 1, awayScore: 0 },
      { id: 'm2', round: 1, phase: 'group', homeId: 'p3', awayId: 'p4' },
    ];
    expect(maybeGenerateKnockoutPhase(t)).toBe(false);
    expect(t.matches.filter((m) => m.phase === 'knockout')).toHaveLength(0);
  });

  it('les formats simples ne génèrent jamais de phase knockout', () => {
    const t = makeTournament({ type: 'league' });
    t.matches = [{ id: 'm1', round: 1, homeId: 'p1', awayId: 'p2', homeScore: 1, awayScore: 0 }];
    expect(maybeGenerateKnockoutPhase(t)).toBe(false);
  });
});
