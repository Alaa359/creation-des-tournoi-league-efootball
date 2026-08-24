export type TournamentType = 'league' | 'knockout' | 'league-knockout' | 'groups-knockout';

export interface Player {
  id: string;
  name: string;
}

export interface Match {
  id: string;
  /** league : journée — knockout : tour (1 = premier tour) */
  round: number;
  homeId: string | null;
  awayId: string | null;
  homeScore?: number;
  awayScore?: number;
  homePens?: number;
  awayPens?: number;
  nextMatchId?: string;
  nextSlot?: 'home' | 'away';
  autoAdvance?: boolean;
  /** knockout aller-retour : clé partagée par les deux manches d'une confrontation */
  tieKey?: string;
  /** knockout aller-retour : 1 = aller, 2 = retour */
  leg?: 1 | 2;
  /** phase du match (formats hybrides ; absent = déduit du type du tournoi) */
  phase?: 'league' | 'group' | 'knockout';
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

export interface TournamentSummary {
  id: string;
  name: string;
  type: TournamentType;
  createdAt: string;
  playerCount: number;
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
  /** groups-knockout : répartition des ids par groupe */
  groups?: string[][];
  standings?: StandingRow[];
  groupStandings?: StandingRow[][];
  championId?: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Erreur HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; details?: string[] };
      if (body.error) message = body.error;
      if (body.details?.length) message += ` — ${body.details.join(', ')}`;
    } catch {
      // corps non JSON : message générique
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  };
}

export const api = {
  me: (): Promise<{ admin: boolean }> => fetch('/api/auth/me').then((r) => r.json()),

  login: (password: string): Promise<{ ok: true }> =>
    fetch('/api/auth/login', json('POST', { password })).then((r) => handle<{ ok: true }>(r)),

  logout: (): Promise<{ ok: true }> =>
    fetch('/api/auth/logout', json('POST', {})).then((r) => handle<{ ok: true }>(r)),

  listTournaments: (): Promise<TournamentSummary[]> =>
    fetch('/api/tournaments').then((r) => handle<TournamentSummary[]>(r)),

  getTournament: (id: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${id}`).then((r) => handle<Tournament>(r)),

  createTournament: (input: {
    name: string;
    type: TournamentType;
    doubleRound: boolean;
    players: string[];
    qualifiers?: number;
    groupsCount?: number;
    qualifiedPerGroup?: number;
  }): Promise<Tournament> =>
    fetch('/api/tournaments', json('POST', input)).then((r) => handle<Tournament>(r)),

  saveResult: (
    tournamentId: string,
    matchId: string,
    payload: { homeScore: number; awayScore: number; homePens?: number; awayPens?: number },
  ): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, json('PATCH', payload)).then(
      (r) => handle<Tournament>(r),
    ),

  addPlayer: (tournamentId: string, name: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/players`, json('POST', { name })).then((r) =>
      handle<Tournament>(r),
    ),

  removePlayer: (tournamentId: string, playerId: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/players/${playerId}`, { method: 'DELETE' }).then((r) =>
      handle<Tournament>(r),
    ),

  deleteTournament: (tournamentId: string): Promise<{ ok: true }> =>
    fetch(`/api/tournaments/${tournamentId}`, { method: 'DELETE', credentials: 'same-origin' }).then(
      (r) => handle<{ ok: true }>(r),
    ),
};
