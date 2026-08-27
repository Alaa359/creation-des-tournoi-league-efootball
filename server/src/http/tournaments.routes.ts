import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  findTournament,
  findUserById,
  listPendingTournaments,
  listTournaments,
  persist,
  tournamentSummary,
  upsertTournament,
  deleteTournament,
} from '../core/db';
import { HttpError } from '../core/errors';
import { logger } from '../core/logger';
import { computeStandings, generateLeagueSchedule } from '../domain/league';
import {
  generateKnockoutBracket,
  recordKnockoutResult,
  tieWinner,
  type ResultInput,
} from '../domain/knockout';
import { generateGroups, isKnockoutMatch, maybeGenerateKnockoutPhase, roundRobinMatches } from '../domain/hybrid';
import {
  computePlayoffStandings,
  isPlayoffMatch,
  maybeGeneratePlayoffPhase,
  playoffChampion,
} from '../domain/playoff';
import {
  addPlayerSchema,
  createTournamentSchema,
  resultSchema,
  type Tournament,
} from '../domain/types';
import {
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
  requireAdmin,
  requireAuth,
  touchSession,
  adminListUsersHandler,
  adminApproveUserHandler,
  adminRejectUserHandler,
  adminDeleteUserHandler,
} from './auth';
import { loginRateLimiter } from './rateLimit';
import { broadcastUpdate, sseHandler } from './sse';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true }));

apiRouter.get('/events/:tournamentId', sseHandler);

apiRouter.use(touchSession);

// ── Auth ──
apiRouter.post('/auth/register', registerHandler);
apiRouter.post('/auth/login', loginRateLimiter, loginHandler);
apiRouter.post('/auth/logout', logoutHandler);
apiRouter.get('/auth/me', meHandler);

// ── Admin : users ──
apiRouter.get('/admin/users', requireAdmin, adminListUsersHandler);
apiRouter.patch('/admin/users/:userId/approve', requireAdmin, adminApproveUserHandler);
apiRouter.patch('/admin/users/:userId/reject', requireAdmin, adminRejectUserHandler);
apiRouter.delete('/admin/users/:userId', requireAdmin, adminDeleteUserHandler);

// ── Admin : tournament approvals ──
apiRouter.get('/admin/tournaments', requireAdmin, (req, res) => {
  const pending = listPendingTournaments();
  res.json(
    pending.map((t) => ({
      ...tournamentSummary(t),
      createdBy: t.createdBy ? findUserById(t.createdBy) : undefined,
      rejectReason: t.rejectReason,
    })),
  );
});

apiRouter.patch('/admin/tournaments/:id/approve', requireAdmin, async (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  t.status = 'active';
  delete t.rejectReason;
  await upsertTournament(t);
  broadcastUpdate(t.id);
  logger.info({ tournamentId: t.id }, 'Tournoi approuvé');
  res.json({ ok: true });
});

apiRouter.patch('/admin/tournaments/:id/reject', requireAdmin, async (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  t.status = 'pending';
  t.rejectReason = req.body?.reason || 'Refusé par l\'administrateur';
  await upsertTournament(t);
  broadcastUpdate(t.id);
  logger.info({ tournamentId: t.id }, 'Tournoi refusé');
  res.json({ ok: true });
});

// ── My tournaments ──
apiRouter.get('/my/tournaments', requireAuth, (req, res) => {
  const userId = (req as any).userId as string;
  const user = findUserById(userId);
  const all = listTournaments();
  const mine = user?.role === 'admin' ? all : all.filter((t) => t.createdBy === userId);
  res.json(mine.map(tournamentSummary));
});

// ── Helpers ──

function championOf(t: Tournament): string | null {
  const ko = t.matches.filter((m) => isKnockoutMatch(t, m));
  if (ko.length === 0) return null;
  const maxRound = Math.max(...ko.map((m) => m.round));
  const finalTie = ko.find((m) => m.round === maxRound);
  return finalTie ? tieWinner(ko, finalTie) : null;
}

function publicView(t: Tournament) {
  if (t.type === 'playoff') {
    const rr = roundRobinMatches(t);
    const groupStandings = (t.groups ?? []).map((ids) =>
      computeStandings(
        t.players.filter((p) => ids.includes(p.id)),
        rr,
      ),
    );
    const playoffStandings = t.matches.some((m) => isPlayoffMatch(m))
      ? computePlayoffStandings(t)
      : undefined;
    return {
      ...t,
      groupStandings,
      playoffStandings,
      championId: playoffChampion(t),
    };
  }
  if (t.type === 'groups-knockout') {
    const rr = roundRobinMatches(t);
    const groupStandings = (t.groups ?? []).map((ids) =>
      computeStandings(
        t.players.filter((p) => ids.includes(p.id)),
        rr,
      ),
    );
    return { ...t, groupStandings, championId: championOf(t) };
  }
  const scope = t.type === 'league-knockout' ? roundRobinMatches(t) : t.matches;
  return { ...t, standings: computeStandings(t.players, scope), championId: championOf(t) };
}

function rebuildSchedule(t: Tournament): void {
  const ids = t.players.map((p) => p.id);
  switch (t.type) {
    case 'league':
      t.matches = generateLeagueSchedule(ids, t.doubleRound);
      break;
    case 'knockout':
      t.matches = generateKnockoutBracket(ids, Math.random, t.doubleRound);
      break;
    case 'league-knockout':
      t.matches = generateLeagueSchedule(ids, t.doubleRound).map((m) => ({
        ...m,
        phase: 'league' as const,
      }));
      break;
    case 'groups-knockout': {
      t.groups = generateGroups(ids, t.groupsCount ?? 2, Math.random);
      t.matches = t.groups.flatMap((groupIds) =>
        generateLeagueSchedule(groupIds, t.doubleRound).map((m) => ({
          ...m,
          phase: 'group' as const,
        })),
      );
      break;
    }
    case 'playoff': {
      t.groups = generateGroups(ids, t.groupsCount ?? 2, Math.random);
      t.matches = t.groups.flatMap((groupIds) =>
        generateLeagueSchedule(groupIds, t.doubleRound).map((m) => ({
          ...m,
          phase: 'group' as const,
        })),
      );
      break;
    }
  }
}

function anyMatchPlayed(t: Tournament): boolean {
  return t.matches.some((m) => m.homeScore != null || m.awayScore != null);
}

// ── Tournament CRUD ──

apiRouter.post('/tournaments', requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const input = createTournamentSchema.parse(req.body);
  const t: Tournament = {
    id: randomBytes(5).toString('base64url'),
    name: input.name,
    type: input.type,
    doubleRound: input.doubleRound,
    createdAt: new Date().toISOString(),
    players: input.players.map((name) => ({ id: randomUUID(), name })),
    matches: [],
    createdBy: userId,
    status: 'active',
    ...(input.type === 'league-knockout' ? { qualifiers: input.qualifiers } : {}),
    ...(input.type === 'groups-knockout'
      ? { groupsCount: input.groupsCount, qualifiedPerGroup: input.qualifiedPerGroup ?? 1 }
      : {}),
    ...(input.type === 'playoff'
      ? { groupsCount: input.groupsCount, qualifiedPerGroup: input.qualifiedPerGroup ?? 1 }
      : {}),
  };
  rebuildSchedule(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  logger.info({ tournamentId: t.id, type: t.type, players: t.players.length, createdBy: userId }, 'Tournoi créé');
  res.status(201).json(publicView(t));
});

apiRouter.get('/tournaments', (_req, res) => {
  res.json(
    listTournaments()
      .filter((t) => t.status === 'active')
      .map(tournamentSummary),
  );
});

apiRouter.get('/tournaments/:id', (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  if (t.status !== 'active') throw new HttpError(404, 'Tournoi introuvable');
  res.json(publicView(t));
});

apiRouter.delete('/tournaments/:id', requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const id = String(req.params.id);
  const t = findTournament(id);
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  const user = findUserById(userId);
  if (user?.role !== 'admin' && t.createdBy !== userId) {
    throw new HttpError(403, 'Vous ne pouvez supprimer que vos propres tournois');
  }
  await deleteTournament(id);
  broadcastUpdate(id);
  logger.info({ tournamentId: id, deletedBy: userId }, 'Tournoi supprimé');
  res.json({ ok: true });
});

apiRouter.patch('/tournaments/:id/matches/:matchId/result', requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  const user = findUserById(userId);
  if (user?.role !== 'admin' && t.createdBy !== userId) {
    throw new HttpError(403, 'Accès refusé');
  }
  const input: ResultInput = resultSchema.parse(req.body);
  const matchId = String(req.params.matchId);
  const m = t.matches.find((x) => x.id === matchId);
  if (!m) throw new HttpError(404, 'Match introuvable');
  if (isKnockoutMatch(t, m)) {
    recordKnockoutResult(t.matches, matchId, input);
  } else {
    m.homeScore = input.homeScore;
    m.awayScore = input.awayScore;
    delete m.homePens;
    delete m.awayPens;
  }
  const generatedKO = maybeGenerateKnockoutPhase(t);
  const generatedPlayoff = maybeGeneratePlayoffPhase(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  if (generatedKO) {
    logger.info({ tournamentId: t.id }, 'Phase à élimination directe générée');
  }
  if (generatedPlayoff) {
    logger.info({ tournamentId: t.id }, 'Phase playoff générée');
  }
  res.json(publicView(t));
});

apiRouter.post('/tournaments/:id/players', requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  const user = findUserById(userId);
  if (user?.role !== 'admin' && t.createdBy !== userId) {
    throw new HttpError(403, 'Accès refusé');
  }
  if (anyMatchPlayed(t)) throw new HttpError(409, 'Le tournoi a démarré : roster verrouillé');
  if (t.players.length >= 32) throw new HttpError(409, 'Maximum 32 joueurs');
  const { name } = addPlayerSchema.parse(req.body);
  if (t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    throw new HttpError(409, 'Ce nom existe déjà dans le roster');
  }
  t.players.push({ id: randomUUID(), name });
  rebuildSchedule(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  res.status(201).json(publicView(t));
});

apiRouter.delete('/tournaments/:id/players/:playerId', requireAuth, async (req, res) => {
  const userId = (req as any).userId as string;
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  const user = findUserById(userId);
  if (user?.role !== 'admin' && t.createdBy !== userId) {
    throw new HttpError(403, 'Accès refusé');
  }
  if (anyMatchPlayed(t)) throw new HttpError(409, 'Le tournoi a démarré : roster verrouillé');
  const minPlayers = t.type === 'knockout' ? 2 : 3;
  if (t.players.length <= minPlayers) {
    throw new HttpError(409, `Minimum ${minPlayers} joueurs requis pour ce format`);
  }
  const before = t.players.length;
  t.players = t.players.filter((p) => p.id !== String(req.params.playerId));
  if (t.players.length === before) throw new HttpError(404, 'Joueur introuvable');
  rebuildSchedule(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  res.json(publicView(t));
});
