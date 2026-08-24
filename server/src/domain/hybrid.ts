import { computeStandings, generateLeagueSchedule } from './league';
import { placePlayersInBracket, shuffle } from './knockout';
import type { Match, Tournament } from './types';

/** Un match est-il une confrontation à élimination directe ? */
export function isKnockoutMatch(t: Tournament, m: Match): boolean {
  if (m.phase) return m.phase === 'knockout';
  return t.type === 'knockout';
}

/** Matchs de phase round-robin (championnat ou groupes). */
export function roundRobinMatches(t: Tournament): Match[] {
  return t.matches.filter((m) => !isKnockoutMatch(t, m));
}

/**
 * Répartition équilibrée des joueurs en `count` groupes (tirage aléatoire).
 * Les effectifs diffèrent d'au plus 1 joueur.
 */
export function generateGroups(playerIds: string[], count: number, rng: () => number = Math.random): string[][] {
  const groups: string[][] = Array.from({ length: count }, () => []);
  shuffle(playerIds, rng).forEach((id, i) => groups[i % count].push(id));
  return groups;
}

/**
 * Ordre des créneaux du bracket pour les qualifiés de groupes :
 * le vainqueur du groupe i affronte le dauphin du groupe miroir
 * (jamais un joueur du même groupe au 1er tour).
 */
export function buildGroupSeeds(winners: string[], runnersUp: string[]): string[] {
  const n = winners.length;
  const seeds: string[] = [];
  for (let i = 0; i < n; i++) {
    seeds.push(winners[i]);
    if (runnersUp[n - 1 - i] != null) seeds.push(runnersUp[n - 1 - i]);
  }
  return seeds;
}

function rrComplete(rr: Match[]): boolean {
  return rr.length > 0 && rr.every((m) => m.homeScore != null && m.awayScore != null);
}

/**
 * Génère la phase à élimination directe d'un format hybride dès que tous les
 * matchs round-robin sont joués. No-op si la phase knockout existe déjà.
 * Retourne true quand les éliminations viennent d'être créées.
 */
export function maybeGenerateKnockoutPhase(t: Tournament, rng: () => number = Math.random): boolean {
  if (t.type !== 'league-knockout' && t.type !== 'groups-knockout') return false;
  if (t.matches.some((m) => isKnockoutMatch(t, m))) return false;

  const rr = roundRobinMatches(t);
  if (!rrComplete(rr)) return false;

  let seeds: string[];
  if (t.type === 'league-knockout') {
    const standings = computeStandings(t.players, rr);
    const n = t.qualifiers ?? standings.length;
    if (n >= standings.length) return false; // configuration invalide : pas d'éliminations
    seeds = standings.slice(0, n).map((r) => r.playerId);
  } else {
    const groups = t.groups ?? [];
    const winners: string[] = [];
    const runnersUp: string[] = [];
    for (const groupIds of groups) {
      const players = t.players.filter((p) => groupIds.includes(p.id));
      const rows = computeStandings(players, rr);
      winners.push(rows[0].playerId);
      if ((t.qualifiedPerGroup ?? 1) >= 2) runnersUp.push(rows[1]?.playerId ?? '');
    }
    seeds = buildGroupSeeds(winners, runnersUp).filter(Boolean);
  }

  // Phase knockout en aller simple (qualification sur un match, TAB si égalité).
  t.matches.push(...placePlayersInBracket(seeds, { doubleRound: false, phase: 'knockout' }));
  return true;
}
