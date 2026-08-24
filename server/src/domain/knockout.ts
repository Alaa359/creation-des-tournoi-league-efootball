import { randomUUID } from 'node:crypto';
import { HttpError } from '../core/errors';
import type { Match, MatchPhase } from './types';

/** Fisher-Yates — rng injectable pour tests déterministes. */
export function shuffle<T>(items: T[], rng: () => number = Math.random): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function bracketSizeFor(count: number): number {
  let size = 2;
  while (size < count) size *= 2;
  return size;
}

/** Ordre de têtes de série standard : garantit que deux BYE ne se rencontrent jamais. */
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/**
 * Construit un bracket à partir d'une liste ORDONNÉE d'ids de joueurs
 * (ordre des créneaux du 1er tour). Les ids manquants pour atteindre la
 * puissance de 2 deviennent des BYE, répartis uniformément.
 */
export function placePlayersInBracket(
  orderedIds: string[],
  opts: { doubleRound?: boolean; phase?: MatchPhase } = {},
): Match[] {
  const { doubleRound = false, phase } = opts;
  const size = bracketSizeFor(orderedIds.length);
  const order = seedOrder(size);

  const slots: (string | null)[] = new Array(size).fill(null);
  orderedIds.forEach((id, idx) => {
    slots[order[idx] - 1] = id;
  });

  // Nœuds du bracket : tiesByRound[r][i] = manches de la confrontation i du tour r+1.
  const tiesByRound: Match[][][] = [];
  let count = size / 2;
  for (let round = 1; count >= 1; round++, count /= 2) {
    const roundTies: Match[][] = [];
    for (let i = 0; i < count; i++) {
      if (doubleRound) {
        const tieKey = randomUUID();
        roundTies.push([
          { id: randomUUID(), round, homeId: null, awayId: null, tieKey, leg: 1 },
          { id: randomUUID(), round, homeId: null, awayId: null, tieKey, leg: 2 },
        ]);
      } else {
        roundTies.push([{ id: randomUUID(), round, homeId: null, awayId: null }]);
      }
    }
    tiesByRound.push(roundTies);
  }

  // Liaisons : chaque manche pointe vers la confrontation suivante (via sa 1ʳᵉ manche).
  tiesByRound.forEach((roundTies, r) => {
    roundTies.forEach((legs, i) => {
      const nextLegs = tiesByRound[r + 1]?.[Math.floor(i / 2)];
      if (!nextLegs) return;
      for (const m of legs) {
        m.nextMatchId = nextLegs[0].id;
        m.nextSlot = i % 2 === 0 ? 'home' : 'away';
      }
    });
  });

  // Remplissage : les deux manches d'un même tie reçoivent les mêmes joueurs.
  slots.forEach((pid, i) => {
    const legs = tiesByRound[0][Math.floor(i / 2)];
    for (const m of legs) {
      if (i % 2 === 0) m.homeId = pid;
      else m.awayId = pid;
    }
  });

  // BYE : uniquement au premier tour — une seule manche « qualifié d'office ».
  if (doubleRound) {
    for (const legs of tiesByRound[0]) {
      if (!soloPlayerOf(legs[0])) continue;
      legs.length = 1;
    }
  }

  const all = tiesByRound.flat(2);
  if (phase) for (const m of all) m.phase = phase;
  resolveInitialByes(all);
  return all;
}

/**
 * Bracket à élimination directe : taille = prochaine puissance de 2,
 * BYE répartis uniformément, vainqueurs propagés via nextMatchId/nextSlot.
 * En aller-retour (doubleRound), chaque confrontation possède 2 manches
 * partageant le même tieKey ; le vainqueur n'est propagé qu'une fois les
 * deux manches jouées (agrégat des buts, puis tirs au but en cas d'égalité).
 */
export function generateKnockoutBracket(
  playerIds: string[],
  rng: () => number = Math.random,
  doubleRound = false,
): Match[] {
  return placePlayersInBracket(shuffle(playerIds, rng), { doubleRound });
}

function soloPlayerOf(m: Match): string | null {
  return m.homeId && !m.awayId ? m.homeId : !m.homeId && m.awayId ? m.awayId : null;
}

function resolveInitialByes(all: Match[]): void {
  // Seuls les matchs du tour 1 peuvent contenir des BYE réels ;
  // au-delà, un créneau vide signifie « en attente du vainqueur ».
  const firstRound = all.filter((m) => m.round === 1);
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of firstRound) {
      if (m.autoAdvance) continue;
      const solo = soloPlayerOf(m);
      if (!solo) continue;
      propagateWinner(all, m, solo);
      m.autoAdvance = true;
      changed = true;
    }
  }
}

export function propagateWinner(all: Match[], source: Match, winnerId: string): void {
  if (!source.nextMatchId || !source.nextSlot) return;
  const head = all.find((m) => m.id === source.nextMatchId);
  if (!head) return;
  // Aller-retour : remplir les deux manches de la confrontation cible.
  const targets = head.tieKey ? all.filter((m) => m.tieKey === head.tieKey) : [head];
  for (const t of targets) {
    if (source.nextSlot === 'home') t.homeId = winnerId;
    else t.awayId = winnerId;
  }
}

export function knockoutWinner(m: Match): string | null {
  if (m.autoAdvance) return m.homeId ?? m.awayId ?? null;
  if (m.homeScore == null || m.awayScore == null || !m.homeId || !m.awayId) return null;
  if (m.homeScore !== m.awayScore) return m.homeScore > m.awayScore ? m.homeId : m.awayId;
  if (m.homePens == null || m.awayPens == null || m.homePens === m.awayPens) return null;
  return m.homePens > m.awayPens ? m.homeId : m.awayId;
}

/**
 * Vainqueur d'une confrontation knockout :
 * match unique → knockoutWinner ; aller-retour → agrégat puis TAB de la manche retour.
 */
export function tieWinner(matches: Match[], m: Match): string | null {
  if (!m.tieKey) return knockoutWinner(m);
  const legs = matches
    .filter((x) => x.tieKey === m.tieKey)
    .sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
  if (legs.length <= 1) return knockoutWinner(legs[0] ?? m);
  if (legs.some((l) => l.homeScore == null)) return null;
  const first = legs[0];
  if (!first.homeId || !first.awayId) return null;
  const agg = new Map<string, number>();
  for (const l of legs) {
    if (l.homeId) agg.set(l.homeId, (agg.get(l.homeId) ?? 0) + (l.homeScore ?? 0));
    if (l.awayId) agg.set(l.awayId, (agg.get(l.awayId) ?? 0) + (l.awayScore ?? 0));
  }
  const hAgg = agg.get(first.homeId) ?? 0;
  const aAgg = agg.get(first.awayId) ?? 0;
  if (hAgg !== aAgg) return hAgg > aAgg ? first.homeId : first.awayId;
  const decider = [...legs].reverse().find((l) => l.homePens != null && l.awayPens != null);
  if (!decider || decider.homePens === decider.awayPens) return null;
  return decider.homePens! > decider.awayPens! ? decider.homeId! : decider.awayId!;
}

export type ResultInput = {
  homeScore: number;
  awayScore: number;
  homePens?: number;
  awayPens?: number;
};

function guardNextPlayed(matches: Match[], m: Match, previousWinner: string | null, winner: string): void {
  if (!m.nextMatchId) return;
  const next = matches.find((x) => x.id === m.nextMatchId);
  const nextTargets = next?.tieKey ? matches.filter((x) => x.tieKey === next.tieKey) : next ? [next] : [];
  const nextStarted = nextTargets.some((x) => x.homeScore != null || x.autoAdvance === true);
  if (nextStarted && previousWinner != null && previousWinner !== winner) {
    throw new HttpError(409, "Le tour suivant a déjà été joué avec l'ancien vainqueur");
  }
}

/** Enregistre un résultat knockout avec garde-fous métier (aller simple ou aller-retour). */
export function recordKnockoutResult(matches: Match[], matchId: string, r: ResultInput): void {
  const m = matches.find((x) => x.id === matchId);
  if (!m) throw new HttpError(404, 'Match introuvable');
  if (m.autoAdvance) {
    throw new HttpError(400, 'Ce match est une exemption (BYE), aucun résultat à saisir');
  }
  if (!m.homeId || !m.awayId) {
    throw new HttpError(409, 'Les deux participants ne sont pas encore connus');
  }

  if (!m.tieKey) {
    // ---- Aller simple : un match = une qualification ----
    const tie = r.homeScore === r.awayScore;
    if (tie && (r.homePens == null || r.awayPens == null)) {
      throw new HttpError(400, 'Égalité en élimination directe : tirs au but obligatoires');
    }
    if (tie && r.homePens === r.awayPens) {
      throw new HttpError(400, 'Les tirs au but doivent désigner un vainqueur');
    }

    const previousWinner = knockoutWinner(m);
    m.homeScore = r.homeScore;
    m.awayScore = r.awayScore;
    if (tie) {
      m.homePens = r.homePens;
      m.awayPens = r.awayPens;
    } else {
      delete m.homePens;
      delete m.awayPens;
    }
    const winner = knockoutWinner(m);
    if (!winner) throw new HttpError(500, 'Vainqueur indéterminé');

    guardNextPlayed(matches, m, previousWinner, winner);
    propagateWinner(matches, m, winner);
    return;
  }

  // ---- Aller-retour : qualification sur l'agrégat des deux manches ----
  const legs = matches
    .filter((x) => x.tieKey === m.tieKey)
    .sort((a, b) => (a.leg ?? 1) - (b.leg ?? 1));
  const other = legs.find((x) => x.id !== m.id);
  const completesTie = Boolean(other && other.homeScore != null);

  // Agrégat prospectif incluant la saisie courante.
  if (completesTie) {
    const agg = new Map<string, number>();
    for (const leg of legs) {
      const hs = leg.id === m.id ? r.homeScore : leg.homeScore;
      const as = leg.id === m.id ? r.awayScore : leg.awayScore;
      if (hs == null || as == null) continue;
      if (leg.homeId) agg.set(leg.homeId, (agg.get(leg.homeId) ?? 0) + hs);
      if (leg.awayId) agg.set(leg.awayId, (agg.get(leg.awayId) ?? 0) + as);
    }
    const hAgg = agg.get(m.homeId!) ?? 0;
    const aAgg = agg.get(m.awayId!) ?? 0;
    if (hAgg === aAgg) {
      if (r.homePens == null || r.awayPens == null) {
        throw new HttpError(
          400,
          "Égalité sur l'ensemble des deux manches : tirs au but obligatoires",
        );
      }
      if (r.homePens === r.awayPens) {
        throw new HttpError(400, 'Les tirs au but doivent désigner un vainqueur');
      }
    }
  } else if (r.homeScore === r.awayScore && (r.homePens != null) !== (r.awayPens != null)) {
    throw new HttpError(400, 'Renseignez les deux séries de tirs au but, ou aucune');
  }

  const previousWinner = tieWinner(matches, m);

  m.homeScore = r.homeScore;
  m.awayScore = r.awayScore;
  if (r.homePens != null && r.awayPens != null) {
    m.homePens = r.homePens;
    m.awayPens = r.awayPens;
  } else {
    delete m.homePens;
    delete m.awayPens;
  }

  const winner = tieWinner(matches, m);
  if (!winner) return; // en attente de la seconde manche

  guardNextPlayed(matches, m, previousWinner, winner);
  propagateWinner(matches, m, winner);
}

/** Libellé professionnel du tour. totalRounds = nombre total de tours du bracket. */
export function getRoundLabel(round: number, totalRounds: number): string {
  switch (totalRounds - round) {
    case 0:
      return 'Finale';
    case 1:
      return 'Demi-finales';
    case 2:
      return 'Quarts de finale';
    case 3:
      return 'Huitièmes de finale';
    case 4:
      return 'Seizièmes de finale';
    case 5:
      return 'Trente-deuxièmes de finale';
    default:
      return `Tour ${round}`;
  }
}
