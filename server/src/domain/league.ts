import { randomUUID } from 'node:crypto';
import type { Match, Player, StandingRow } from './types';

const BYE = '__BYE__';

/**
 * Calendrier round-robin par la « méthode du cercle ».
 * Effectif impair → BYE fantôme ; aller-retour = jambes miroir avec
 * numérotation continue des journées.
 */
export function generateLeagueSchedule(playerIds: string[], doubleRound: boolean): Match[] {
  const ids = [...playerIds];
  if (ids.length % 2 === 1) ids.push(BYE);
  const n = ids.length;
  const half = n / 2;
  let rotation = [...ids];
  const firstLegRounds = n - 1;
  const matches: Match[] = [];

  for (let r = 0; r < firstLegRounds; r++) {
    for (let i = 0; i < half; i++) {
      const a = rotation[i];
      const b = rotation[n - 1 - i];
      if (a === BYE || b === BYE) continue;
      const home = r % 2 === 0 ? a : b;
      const away = r % 2 === 0 ? b : a;
      matches.push({ id: randomUUID(), round: r + 1, homeId: home, awayId: away });
    }
    rotation = [rotation[0], rotation[n - 1], ...rotation.slice(1, n - 1)];
  }

  if (doubleRound) {
    const secondLeg: Match[] = [];
    for (const m of [...matches]) {
      secondLeg.push({
        id: randomUUID(),
        round: m.round + firstLegRounds,
        homeId: m.awayId,
        awayId: m.homeId,
      });
    }
    matches.push(...secondLeg);
  }
  return matches;
}

/** Classement : Pts (3/1/0) → différence de buts → buts marqués → ordre alphabétique. */
export function computeStandings(players: Player[], matches: Match[]): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  for (const p of players) {
    rows.set(p.id, {
      playerId: p.id,
      name: p.name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDiff: 0,
      points: 0,
    });
  }
  for (const m of matches) {
    if (!m.homeId || !m.awayId || m.homeScore === undefined || m.awayScore === undefined) continue;
    const h = rows.get(m.homeId);
    const a = rows.get(m.awayId);
    if (!h || !a) continue;
    h.played++;
    a.played++;
    h.goalsFor += m.homeScore;
    h.goalsAgainst += m.awayScore;
    a.goalsFor += m.awayScore;
    a.goalsAgainst += m.homeScore;
    if (m.homeScore > m.awayScore) {
      h.won++;
      h.points += 3;
      a.lost++;
    } else if (m.homeScore < m.awayScore) {
      a.won++;
      a.points += 3;
      h.lost++;
    } else {
      h.drawn++;
      a.drawn++;
      h.points += 1;
      a.points += 1;
    }
  }
  return [...rows.values()]
    .map((r) => ({ ...r, goalDiff: r.goalsFor - r.goalsAgainst }))
    .sort(
      (x, y) =>
        y.points - x.points ||
        y.goalDiff - x.goalDiff ||
        y.goalsFor - x.goalsFor ||
        x.name.localeCompare(y.name),
    );
}
