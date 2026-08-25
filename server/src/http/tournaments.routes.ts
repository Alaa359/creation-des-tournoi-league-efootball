import { Router } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  findTournament,
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
  addPlayerSchema,
  createTournamentSchema,
  resultSchema,
  type Tournament,
} from '../domain/types';
import { loginHandler, logoutHandler, meHandler, requireAdmin } from './auth';
import { loginRateLimiter } from './rateLimit';
import { broadcastUpdate, sseHandler } from './sse';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => res.json({ ok: true }));

apiRouter.get('/events/:tournamentId', sseHandler);

apiRouter.post('/auth/login', loginRateLimiter, loginHandler);
apiRouter.post('/auth/logout', logoutHandler);
apiRouter.get('/auth/me', meHandler);

/** Champion d'un tournoi : vainqueur de la dernière confrontation à élimination directe. */
function championOf(t: Tournament): string | null {
  const ko = t.matches.filter((m) => isKnockoutMatch(t, m));
  if (ko.length === 0) return null;
  const maxRound = Math.max(...ko.map((m) => m.round));
  const finalTie = ko.find((m) => m.round === maxRound);
  return finalTie ? tieWinner(ko, finalTie) : null;
}

/** Snapshot public : tournoi + classements calculés + champion (formats avec éliminations). */
function publicView(t: Tournament) {
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
  // league et league-knockout : classement limité à la phase championnat
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
  }
}

function anyMatchPlayed(t: Tournament): boolean {
  return t.matches.some((m) => m.homeScore != null || m.awayScore != null);
}

apiRouter.post('/tournaments', requireAdmin, async (req, res) => {
  const input = createTournamentSchema.parse(req.body);
  const t: Tournament = {
    id: randomBytes(5).toString('base64url'),
    name: input.name,
    type: input.type,
    doubleRound: input.doubleRound,
    createdAt: new Date().toISOString(),
    players: input.players.map((name) => ({ id: randomUUID(), name })),
    matches: [],
    ...(input.type === 'league-knockout' ? { qualifiers: input.qualifiers } : {}),
    ...(input.type === 'groups-knockout'
      ? { groupsCount: input.groupsCount, qualifiedPerGroup: input.qualifiedPerGroup ?? 1 }
      : {}),
  };
  rebuildSchedule(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  logger.info({ tournamentId: t.id, type: t.type, players: t.players.length }, 'Tournoi créé');
  res.status(201).json(publicView(t));
});

apiRouter.get('/tournaments', (_req, res) => {
  res.json(listTournaments().map(tournamentSummary));
});

apiRouter.get('/tournaments/:id', (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
  res.json(publicView(t));
});

apiRouter.delete('/tournaments/:id', requireAdmin, async (req, res) => {
  const id = String(req.params.id);
  const removed = await deleteTournament(id);
  if (!removed) throw new HttpError(404, 'Tournoi introuvable');
  broadcastUpdate(id);
  logger.info({ tournamentId: id }, 'Tournoi supprimé');
  res.json({ ok: true });
});

apiRouter.patch('/tournaments/:id/matches/:matchId/result', requireAdmin, async (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
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
  const generated = maybeGenerateKnockoutPhase(t);
  await upsertTournament(t);
  broadcastUpdate(t.id);
  if (generated) {
    logger.info({ tournamentId: t.id }, 'Phase à élimination directe générée');
  }
  res.json(publicView(t));
});

apiRouter.post('/tournaments/:id/players', requireAdmin, async (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
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

apiRouter.delete('/tournaments/:id/players/:playerId', requireAdmin, async (req, res) => {
  const t = findTournament(String(req.params.id));
  if (!t) throw new HttpError(404, 'Tournoi introuvable');
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
