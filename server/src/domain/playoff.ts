import { computeStandings, generateLeagueSchedule } from './league';
import type { Match, StandingRow, Tournament } from './types';

/** Un match est-il de la phase playoff (deuxième phase) ? */
export function isPlayoffMatch(m: Match): boolean {
  return m.phase === 'playoff';
}

/** Tous les matchs de groupes sont-ils terminés ? */
function groupPhaseComplete(t: Tournament): boolean {
  return t.matches
    .filter((m) => !isPlayoffMatch(m))
    .every((m) => m.homeScore != null && m.awayScore != null);
}

/**
 * Génère la phase playoff (round-robin) à partir des meilleurs de chaque groupe.
 * Les points de bonus de la phase de groupes sont attribués selon la position finale.
 *
 * Barème de bonus (Ligue 1 Tunisie) :
 *   - 1er du groupe : 3 pts
 *   - 2e du groupe : 2 pts
 *   - 3e du groupe : 1 pt
 */
export function maybeGeneratePlayoffPhase(t: Tournament): boolean {
  if (t.type !== 'playoff') return false;
  if (t.matches.some((m) => isPlayoffMatch(m))) return false;
  if (!groupPhaseComplete(t)) return false;

  const groups = t.groups ?? [];
  const qualifiedPerGroup = t.qualifiedPerGroup ?? 1;
  const rr = t.matches.filter((m) => !isPlayoffMatch(m));

  const qualifiedIds: string[] = [];
  const bonusPoints: Record<string, number> = {};
  const bonusRank: Record<string, number> = {};

  for (const groupIds of groups) {
    const players = t.players.filter((p) => groupIds.includes(p.id));
    const standings = computeStandings(players, rr);

    for (let i = 0; i < Math.min(qualifiedPerGroup, standings.length); i++) {
      const id = standings[i].playerId;
      qualifiedIds.push(id);
      // 1er = 3 pts, 2e = 2 pts, 3e = 1 pt
      const bonus = Math.max(0, 3 - i);
      bonusPoints[id] = bonus;
      bonusRank[id] = i + 1;
    }
  }

  if (qualifiedIds.length < 2) return false;

  // Offset des journées : playoff commence après la dernière journée de groupes
  const maxGroupRound = rr.reduce((max, m) => Math.max(max, m.round), 0);

  const playoffMatches = generateLeagueSchedule(qualifiedIds, false).map((m) => ({
    ...m,
    round: m.round + maxGroupRound,
    phase: 'playoff' as const,
  }));

  t.matches.push(...playoffMatches);

  // Attacher les bonus au tournoi
  t.playoffBonusPoints = bonusPoints;
  t.playoffBonusRank = bonusRank;

  return true;
}

/** Labels pour les positions de qualification (1er, 2e, 3e…). */
const RANK_LABELS = ['1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e'];

/**
 * Classement playoff combinant les points de bonus de la phase de groupes
 * avec les résultats du round-robin playoff.
 */
export function computePlayoffStandings(t: Tournament): (StandingRow & { bonus: number; bonusLabel: string })[] {
  const playoffPlayerIds = new Set(
    t.matches.filter((m) => isPlayoffMatch(m) && m.homeId && m.awayId).flatMap((m) => [m.homeId!, m.awayId!]),
  );
  const playoffPlayers = t.players.filter((p) => playoffPlayerIds.has(p.id));
  const playoffMatches = t.matches.filter((m) => isPlayoffMatch(m));

  const baseStandings = computeStandings(playoffPlayers, playoffMatches);
  const bonusPoints = t.playoffBonusPoints ?? {};
  const bonusRank = t.playoffBonusRank ?? {};

  return baseStandings.map((row) => {
    const bonus = bonusPoints[row.playerId] ?? 0;
    const rank = bonusRank[row.playerId];
    return {
      ...row,
      points: row.points + bonus,
      bonus,
      bonusLabel: rank ? `${RANK_LABELS[rank - 1]} groupe (+${bonus})` : '',
    };
  }).sort(
    (a, b) =>
      b.points - a.points ||
      b.goalDiff - a.goalDiff ||
      b.goalsFor - a.goalsFor ||
      a.name.localeCompare(b.name),
  );
}

/** Champion du tournoi playoff : premier du classement playoff. */
export function playoffChampion(t: Tournament): string | null {
  const hasPlayoff = t.matches.some((m) => isPlayoffMatch(m));
  if (!hasPlayoff) return null;
  const standings = computePlayoffStandings(t);
  return standings[0]?.playerId ?? null;
}
