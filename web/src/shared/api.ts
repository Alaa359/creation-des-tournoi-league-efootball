export type TournamentType = 'league' | 'knockout' | 'league-knockout' | 'groups-knockout' | 'playoff';

export interface Player {
  id: string;
  name: string;
}

export interface Match {
  id: string;
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
  tieKey?: string;
  leg?: 1 | 2;
  phase?: 'league' | 'group' | 'knockout' | 'playoff';
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

export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  approved: boolean;
  createdAt: string;
}

export interface TournamentSummary {
  id: string;
  name: string;
  type: TournamentType;
  createdAt: string;
  playerCount: number;
  status?: 'pending' | 'active';
  expiresAt?: string;
  creatorName?: string;
}

export interface Tournament {
  id: string;
  name: string;
  type: TournamentType;
  doubleRound: boolean;
  createdAt: string;
  players: Player[];
  matches: Match[];
  createdBy?: string;
  status?: 'pending' | 'active';
  rejectReason?: string;
  qualifiers?: number;
  groupsCount?: number;
  qualifiedPerGroup?: number;
  groups?: string[][];
  standings?: StandingRow[];
  groupStandings?: StandingRow[][];
  playoffStandings?: (StandingRow & { bonus?: number; bonusLabel?: string })[];
  championId?: string | null;
  playoffBonusPoints?: Record<string, number>;
  playoffBonusRank?: Record<string, number>;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Erreur HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string; details?: string[] };
      if (body.error) message = body.error;
      if (body.details?.length) message += ` — ${body.details.join(', ')}`;
    } catch {
      // corps non JSON
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
  // ── Auth ──
  me: (): Promise<{ user: UserPublic | null }> =>
    fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json()),

  register: (data: { name: string; email: string; password: string }): Promise<{ ok: true; user?: UserPublic; pending?: boolean }> =>
    fetch('/api/auth/register', json('POST', data)).then((r) => handle(r)),

  login: (data: { email: string; password: string }): Promise<{ ok: true; user: UserPublic }> =>
    fetch('/api/auth/login', json('POST', data)).then((r) => handle(r)),

  logout: (): Promise<{ ok: true }> =>
    fetch('/api/auth/logout', json('POST', {})).then((r) => handle(r)),

  // ── Mes tournois ──
  myTournaments: (): Promise<TournamentSummary[]> =>
    fetch('/api/my/tournaments', { credentials: 'same-origin' }).then((r) => handle(r)),

  // ── Tournois publics ──
  listTournaments: (): Promise<TournamentSummary[]> =>
    fetch('/api/tournaments').then((r) => handle(r)),

  getTournament: (id: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${id}`).then((r) => handle(r)),

  createTournament: (input: {
    name: string;
    type: TournamentType;
    doubleRound: boolean;
    players: string[];
    qualifiers?: number;
    groupsCount?: number;
    qualifiedPerGroup?: number;
  }): Promise<Tournament> =>
    fetch('/api/tournaments', json('POST', input)).then((r) => handle(r)),

  saveResult: (
    tournamentId: string,
    matchId: string,
    payload: { homeScore: number; awayScore: number; homePens?: number; awayPens?: number },
  ): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, json('PATCH', payload)).then(
      (r) => handle(r),
    ),

  addPlayer: (tournamentId: string, name: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/players`, json('POST', { name })).then((r) =>
      handle(r),
    ),

  removePlayer: (tournamentId: string, playerId: string): Promise<Tournament> =>
    fetch(`/api/tournaments/${tournamentId}/players/${playerId}`, { method: 'DELETE', credentials: 'same-origin' }).then((r) =>
      handle(r),
    ),

  deleteTournament: (tournamentId: string): Promise<{ ok: true }> =>
    fetch(`/api/tournaments/${tournamentId}`, { method: 'DELETE', credentials: 'same-origin' }).then(
      (r) => handle(r),
    ),

  // ── Admin ──
  adminListUsers: (): Promise<UserPublic[]> =>
    fetch('/api/admin/users', { credentials: 'same-origin' }).then((r) => handle(r)),

  adminApproveUser: (userId: string): Promise<{ ok: true; user: UserPublic }> =>
    fetch(`/api/admin/users/${userId}/approve`, json('PATCH', {})).then((r) => handle(r)),

  adminRejectUser: (userId: string): Promise<{ ok: true; user: UserPublic }> =>
    fetch(`/api/admin/users/${userId}/reject`, json('PATCH', {})).then((r) => handle(r)),

  adminResetPassword: (userId: string, password: string): Promise<{ ok: true }> =>
    fetch(`/api/admin/users/${userId}/password`, json('PATCH', { password })).then((r) => handle(r)),

  adminDeleteUser: (userId: string): Promise<{ ok: true }> =>
    fetch(`/api/admin/users/${userId}`, { method: 'DELETE', credentials: 'same-origin' }).then((r) => handle(r)),

  adminListTournaments: (): Promise<(TournamentSummary & { createdBy?: UserPublic; rejectReason?: string })[]> =>
    fetch('/api/admin/tournaments', { credentials: 'same-origin' }).then((r) => handle(r)),

  adminApproveTournament: (id: string): Promise<{ ok: true }> =>
    fetch(`/api/admin/tournaments/${id}/approve`, json('PATCH', {})).then((r) => handle(r)),

  adminRejectTournament: (id: string, reason?: string): Promise<{ ok: true }> =>
    fetch(`/api/admin/tournaments/${id}/reject`, json('PATCH', { reason })).then((r) => handle(r)),
};
