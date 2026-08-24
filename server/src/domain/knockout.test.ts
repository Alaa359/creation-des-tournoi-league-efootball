import { describe, expect, it } from 'vitest';
import {
  bracketSizeFor,
  generateKnockoutBracket,
  getRoundLabel,
  knockoutWinner,
  recordKnockoutResult,
  tieWinner,
} from './knockout';
import type { Match } from './types';

function mulberry32(seed: number): () => number {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function playMatch(all: Match[], m: Match, homeScore: number, awayScore: number, hp?: number, ap?: number): void {
  recordKnockoutResult(all, m.id, {
    homeScore,
    awayScore,
    ...(hp !== undefined ? { homePens: hp } : {}),
    ...(ap !== undefined ? { awayPens: ap } : {}),
  });
}

describe('generateKnockoutBracket', () => {
  it('12 joueurs → bracket de 16, 15 matchs, 4 BYE répartis sans doublon', () => {
    const ms = generateKnockoutBracket(ids(12), mulberry32(42));
    expect(bracketSizeFor(12)).toBe(16);
    expect(ms).toHaveLength(15);

    const firstRound = ms.filter((m) => m.round === 1);
    expect(firstRound).toHaveLength(8);
    const byes = firstRound.filter((m) => !m.homeId || !m.awayId);
    expect(byes).toHaveLength(4);

    // aucun affrontement BYE vs BYE : chaque match du tour 1 a au moins un joueur
    for (const m of firstRound) {
      expect(m.homeId ?? m.awayId).toBeTruthy();
      if (!m.homeId || !m.awayId) expect(m.autoAdvance).toBe(true);
    }
    // les vainqueurs de BYE sont bien inscrits au tour 2
    for (const bye of byes) {
      const next = ms.find((x) => x.id === bye.nextMatchId);
      const fed = bye.nextSlot === 'home' ? next?.homeId : next?.awayId;
      expect(fed).toBe(bye.homeId ?? bye.awayId);
    }
    // les tours suivants peuvent légitimement attendre des vainqueurs (côtés vides)
    expect(ms.filter((m) => m.round >= 2).every((m) => m.round >= 2)).toBe(true);
  });

  it('2 joueurs → finale unique sans BYE', () => {
    const ms = generateKnockoutBracket(ids(2));
    expect(ms).toHaveLength(1);
    const [final] = ms;
    expect(final.round).toBe(1);
    expect(new Set([final.homeId, final.awayId])).toEqual(new Set(['p1', 'p2']));
    expect(final.nextMatchId).toBeUndefined();
  });

  it('chaque joueur apparaît exactement une fois au premier tour', () => {
    const ms = generateKnockoutBracket(ids(8), mulberry32(7));
    const firstRound = ms.filter((m) => m.round === 1);
    const seen = firstRound.flatMap((m) => [m.homeId, m.awayId]).filter(Boolean).sort();
    expect(seen).toEqual(ids(8));
  });
});

describe('recordKnockoutResult', () => {
  it('propage le vainqueur jusqu\'à la finale et désigne le champion', () => {
    const ms = generateKnockoutBracket(ids(8), mulberry32(99));
    // p1 gagne tous ses matchs ; les autres se départagent à domicile 1-0
    let guard = 50;
    while (guard-- > 0) {
      const pending = ms.find(
        (m) =>
          !m.autoAdvance &&
          m.homeId &&
          m.awayId &&
          m.homeScore == null,
      );
      if (!pending) break;
      const p1Home = pending.homeId === 'p1';
      const p1Away = pending.awayId === 'p1';
      if (p1Home) playMatch(ms, pending, 2, 0);
      else if (p1Away) playMatch(ms, pending, 0, 2);
      else playMatch(ms, pending, 1, 0);
    }
    expect(guard).toBeGreaterThan(0);
    const final = ms.find((m) => !m.nextMatchId)!;
    expect(knockoutWinner(final)).toBe('p1');
  });

  it('exige les tirs au but en cas d\'égalité puis les accepte', () => {
    const ms = generateKnockoutBracket(ids(4), mulberry32(3));
    const m = ms.find((x) => x.homeId && x.awayId)!;
    expect(() => recordKnockoutResult(ms, m.id, { homeScore: 1, awayScore: 1 })).toThrowError(
      /tirs au but/,
    );
    expect(() =>
      recordKnockoutResult(ms, m.id, { homeScore: 1, awayScore: 1, homePens: 3, awayPens: 3 }),
    ).toThrowError(/vainqueur/);
    playMatch(ms, m, 1, 1, 4, 2);
    expect(knockoutWinner(m)).toBe(m.homeId);
    const next = ms.find((x) => x.id === m.nextMatchId)!;
    const fedId = m.nextSlot === 'home' ? next.homeId : next.awayId;
    expect(fedId).toBe(m.homeId);
  });

  it('refuse la correction qui invalide un tour suivant déjà joué', () => {
    const ms = generateKnockoutBracket(ids(4), mulberry32(5));
    const q1 = ms.find((x) => x.round === 1)!;
    const p1Home = q1.homeId === 'p1';
    // p1 remporte son match quel que soit son côté
    playMatch(ms, q1, p1Home ? 2 : 0, p1Home ? 0 : 2);
    const q2 = ms.find((x) => x.round === 1 && x.id !== q1.id)!;
    playMatch(ms, q2, 2, 1);
    const semi = ms.find((x) => x.id === q1.nextMatchId)!;
    playMatch(ms, semi, 3, 1); // le tour suivant est joué
    // corriger q1 en donnant la victoire à l'adversaire de p1 → conflit
    expect(() => playMatch(ms, q1, p1Home ? 0 : 5, p1Home ? 5 : 0)).toThrowError(/tour suivant/);
  });
});

describe('getRoundLabel', () => {
  it('libellés professionnels français (bracket de 16)', () => {
    expect(getRoundLabel(4, 4)).toBe('Finale');
    expect(getRoundLabel(3, 4)).toBe('Demi-finales');
    expect(getRoundLabel(2, 4)).toBe('Quarts de finale');
    expect(getRoundLabel(1, 4)).toBe('Huitièmes de finale');
    expect(getRoundLabel(1, 5)).toBe('Seizièmes de finale');
    expect(getRoundLabel(1, 6)).toBe('Trente-deuxièmes de finale');
  });
});

describe('generateKnockoutBracket (aller-retour)', () => {
  it('4 joueurs → 3 confrontations × 2 manches = 6 matchs avec tieKey/leg', () => {
    const ms = generateKnockoutBracket(ids(4), mulberry32(11), true);
    expect(ms).toHaveLength(6);
    const ties = new Set(ms.map((m) => m.tieKey));
    expect(ties.size).toBe(3);
    for (const key of ties) {
      const legs = ms.filter((m) => m.tieKey === key);
      expect(legs).toHaveLength(2);
      expect(legs.map((l) => l.leg).sort()).toEqual([1, 2]);
      // les deux manches opposent les mêmes joueurs
      const pair = (l: Match): Set<string | null> => new Set([l.homeId, l.awayId]);
      expect(pair(legs[0])).toEqual(pair(legs[1]));
    }
  });

  it('3 joueurs → BYE en une seule manche, pas de retour inutile', () => {
    const ms = generateKnockoutBracket(ids(3), mulberry32(13), true);
    const byes = ms.filter((m) => m.autoAdvance);
    expect(byes).toHaveLength(1);
    expect(ms.filter((m) => m.tieKey === byes[0].tieKey)).toHaveLength(1);
    // le qualifié d'office est inscrit sur les deux manches du tour suivant
    const nextLegs = ms.filter((m) => m.tieKey === ms.find((x) => x.id === byes[0].nextMatchId)!.tieKey);
    expect(nextLegs).toHaveLength(2);
    const fed = byes[0].nextSlot === 'home' ? nextLegs[0].homeId : nextLegs[0].awayId;
    expect(fed).toBe(byes[0].homeId ?? byes[0].awayId);
  });

  it('qualification sur l\'agrégat : aller perdu peut être rattrapé au retour', () => {
    const ms = generateKnockoutBracket(ids(2), mulberry32(17), true);
    const [leg1, leg2] = ms;
    recordKnockoutResult(ms, leg1.id, { homeScore: 0, awayScore: 2 });
    // après l'aller seul : pas encore de vainqueur propagé
    expect(tieWinner(ms, leg1)).toBeNull();
    expect(leg2.homeId).not.toBeNull(); // déjà remplis à la génération (finale directe)
    recordKnockoutResult(ms, leg2.id, { homeScore: 3, awayScore: 0 });
    // agrégat 3-2 → le domicile passe
    expect(tieWinner(ms, leg2)).toBe(leg1.homeId);
  });

  it('agrégat à égalité → tirs au but obligatoires sur la saisie qui achève la confrontation', () => {
    const ms = generateKnockoutBracket(ids(2), mulberry32(23), true);
    const [leg1, leg2] = ms;
    recordKnockoutResult(ms, leg1.id, { homeScore: 2, awayScore: 1 });
    // retour 0-1 sans TAB → refus (agrégat 2-2)
    expect(() => recordKnockoutResult(ms, leg2.id, { homeScore: 0, awayScore: 1 })).toThrowError(
      /tirs au but/,
    );
    // retour 0-1 + tab 4-2 → qualification du domicile
    recordKnockoutResult(ms, leg2.id, { homeScore: 0, awayScore: 1, homePens: 4, awayPens: 2 });
    expect(tieWinner(ms, leg2)).toBe(leg1.homeId);
  });

  it('match nul à l\'aller sans conséquence : pas de TAB exigé avant le retour', () => {
    const ms = generateKnockoutBracket(ids(2), mulberry32(29), true);
    const [leg1] = ms;
    expect(() => recordKnockoutResult(ms, leg1.id, { homeScore: 1, awayScore: 1 })).not.toThrow();
    expect(tieWinner(ms, leg1)).toBeNull();
  });

  it('le champion d\'un bracket aller-retour est bien détecté via tieWinner', () => {
    const ms = generateKnockoutBracket(ids(4), mulberry32(31), true);
    let guard = 50;
    while (guard-- > 0) {
      const pending = ms.find(
        (m) => !m.autoAdvance && m.homeId && m.awayId && m.homeScore == null,
      );
      if (!pending) break;
      const p1Home = pending.homeId === 'p1';
      const p1Away = pending.awayId === 'p1';
      if (p1Home) recordKnockoutResult(ms, pending.id, { homeScore: 3, awayScore: 0 });
      else if (p1Away) recordKnockoutResult(ms, pending.id, { homeScore: 0, awayScore: 3 });
      else recordKnockoutResult(ms, pending.id, { homeScore: 1, awayScore: 0 });
    }
    expect(guard).toBeGreaterThan(0);
    const finalTie = ms.reduce((a, b) => (b.round > a.round ? b : a));
    expect(tieWinner(ms, finalTie)).toBe('p1');
    expect(knockoutWinner(finalTie)).toBeDefined();
  });
});
