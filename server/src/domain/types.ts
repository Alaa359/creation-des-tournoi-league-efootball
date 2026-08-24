import { z } from 'zod';

export const tournamentTypes = ['league', 'knockout', 'league-knockout', 'groups-knockout'] as const;
export type TournamentType = (typeof tournamentTypes)[number];

export interface Player {
  id: string;
  name: string;
}

/** Phase d'un match : round-robin (championnat ou groupes) ou éliminations. */
export type MatchPhase = 'league' | 'group' | 'knockout';

export interface Match {
  id: string;
  /** league : n° de journée — knockout : n° du tour (1 = 1er tour) */
  round: number;
  homeId: string | null;
  awayId: string | null;
  homeScore?: number;
  awayScore?: number;
  /** knockout uniquement : tirs au but en cas d'égalité */
  homePens?: number;
  awayPens?: number;
  nextMatchId?: string;
  nextSlot?: 'home' | 'away';
  /** knockout : qualification d'office (BYE) */
  autoAdvance?: boolean;
  /** knockout aller-retour : clé partagée par les deux manches d'une même confrontation */
  tieKey?: string;
  /** knockout aller-retour : 1 = aller, 2 = retour */
  leg?: 1 | 2;
  /** phase du match (formats hybrides ; absent = déduit du type du tournoi) */
  phase?: MatchPhase;
}

export interface Tournament {
  id: string;
  name: string;
  type: TournamentType;
  doubleRound: boolean;
  createdAt: string;
  players: Player[];
  matches: Match[];
  /** league-knockout : nombre de qualifiés pour les éliminations */
  qualifiers?: number;
  /** groups-knockout : nombre de groupes */
  groupsCount?: number;
  /** groups-knockout : qualifiés par groupe (1 ou 2) */
  qualifiedPerGroup?: number;
  /** groups-knockout : répartition des ids de joueurs par groupe */
  groups?: string[][];
}

export interface StandingRow {
  playerId: string;
  name: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
}

const nameSchema = z.string().trim().min(1).max(30);

export const createTournamentSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    type: z.enum(tournamentTypes),
    doubleRound: z.boolean().default(false),
    players: z.array(nameSchema).min(2).max(32),
    qualifiers: z.number().int().min(2).max(16).optional(),
    groupsCount: z.number().int().min(2).max(8).optional(),
    qualifiedPerGroup: z.number().int().min(1).max(2).optional(),
  })
  .refine((d) => d.type !== 'league' || d.players.length >= 3, {
    message: 'Une league nécessite au moins 3 joueurs',
    path: ['players'],
  })
  .refine((d) => d.type !== 'league-knockout' || (d.qualifiers != null && d.qualifiers < d.players.length), {
    message: 'Le nombre de qualifiés doit être inférieur au nombre de joueurs',
    path: ['qualifiers'],
  })
  .refine((d) => d.type !== 'groups-knockout' || d.groupsCount != null, {
    message: 'Nombre de groupes requis',
    path: ['groupsCount'],
  })
  .refine(
    (d) =>
      d.type !== 'groups-knockout' ||
      (d.groupsCount != null && d.groupsCount * 2 <= d.players.length && d.qualifiedPerGroup != null),
    {
      message: 'Chaque groupe doit compter au moins 2 joueurs',
      path: ['groupsCount'],
    },
  )
  .refine(
    (d) =>
      d.type !== 'groups-knockout' ||
      (d.groupsCount != null &&
        d.qualifiedPerGroup != null &&
        d.groupsCount * d.qualifiedPerGroup < d.players.length),
    {
      message: 'Tous les joueurs seraient qualifiés pour les éliminations',
      path: ['qualifiedPerGroup'],
    },
  )
  .refine((d) => new Set(d.players.map((p) => p.toLowerCase())).size === d.players.length, {
    message: 'Les noms des joueurs doivent être uniques',
    path: ['players'],
  });

export type CreateTournamentInput = z.infer<typeof createTournamentSchema>;

export const resultSchema = z.object({
  homeScore: z.number().int().min(0).max(99),
  awayScore: z.number().int().min(0).max(99),
  homePens: z.number().int().min(0).max(99).optional(),
  awayPens: z.number().int().min(0).max(99).optional(),
});

export const addPlayerSchema = z.object({ name: nameSchema });
