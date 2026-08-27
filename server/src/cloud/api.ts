import crypto from 'node:crypto';
import {
  computeStandings,
  generateLeagueSchedule,
} from '../domain/league';
import {
  generateKnockoutBracket,
  recordKnockoutResult,
  tieWinner,
  type ResultInput,
} from '../domain/knockout';
import {
  generateGroups,
  isKnockoutMatch,
  maybeGenerateKnockoutPhase,
  roundRobinMatches,
} from '../domain/hybrid';
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
import { HttpError } from '../core/errors';
import {
  assertLoginAllowed,
  clearLoginFailures,
  clientIp,
  memoryLoginRateStore,
  recordLoginFailure,
  type LoginRateStore,
} from './rateLimit';

/** État persisté (équivalent de data/db.json, ici dans Netlify Blobs). */
export interface CloudState {
  tournaments: Tournament[];
}

/** Adaptateur de stockage injecté (Blobs en prod, mémoire dans les tests). */
export interface CloudStore {
  read(): Promise<CloudState | null>;
  write(state: CloudState): Promise<void>;
}

export interface CloudEnv {
  adminPassword: string;
  sessionSecret: string;
  rateStore?: LoginRateStore;
}

const fallbackRateStore = memoryLoginRateStore();

// ── Auth organisateur : cookie HMAC « expiration.signature » ────────────────

const COOKIE = 'efc_admin';
const TTL_MS = 10 * 60 * 1000;

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function verifyToken(secret: string, token: string | undefined): boolean {
  if (!token || !secret) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const expRaw = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(secret, expRaw));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

function isAdmin(req: Request, env: CloudEnv): boolean {
  return verifyToken(env.sessionSecret, parseCookies(req.headers.get('cookie'))[COOKIE]);
}

/** Session glissante : repousse l'expiration sauf sur /auth/me (sonde de l'interface). */
function refreshedSessionResponse(req: Request, env: CloudEnv, res: Response): Response {
  if (!isAdmin(req, env) || res.headers.has('Set-Cookie') || routeOf(req) === '/auth/me') {
    return res;
  }
  const exp = Date.now() + TTL_MS;
  const headers = new Headers(res.headers);
  headers.set(
    'Set-Cookie',
    `${COOKIE}=${exp}.${sign(env.sessionSecret, String(exp))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
  );
  return new Response(res.body, { status: res.status, headers });
}

function routeOf(req: Request): string {
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    pathname = '/';
  }
  pathname = pathname.replace(/^\/\.netlify\/functions/, '');
  return pathname.startsWith('/api') ? pathname.slice(4) : pathname;
}

function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
  });
}

// ── Vues publiques (copie fidèle de tournaments.routes.ts) ──────────────────

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

function tournamentSummary(t: Tournament) {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    createdAt: t.createdAt,
    playerCount: t.players.length,
  };
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

// ── Handler principal (Web Request → Web Response) ──────────────────────────

async function readJsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Corps JSON invalide');
  }
}

/**
 * Traite une requête /api/* sans framework, compatible Netlify Functions v2.
 * Le préfixe (/api ou /.netlify/functions/api) est déjà retiré par l'appelant.
 */
export async function handleApiRoute(
  route: string,
  req: Request,
  store: CloudStore,
  env: CloudEnv,
): Promise<Response> {
  const method = req.method;
  const seg = route.split('/').filter(Boolean);

  // ── Santé ──
  if (route === '/health') return json({ ok: true });

  // ── Auth ──
  if (route === '/auth/login' && method === 'POST') {
    const rateStore = env.rateStore ?? fallbackRateStore;
    const ip = clientIp(req);
    await assertLoginAllowed(rateStore, ip);
    if (!env.adminPassword) {
      return json({ error: 'Mot de passe incorrect' }, { status: 401 });
    }
    const body = (await readJsonBody(req)) as { password?: unknown };
    if (typeof body.password !== 'string' || body.password !== env.adminPassword) {
      await recordLoginFailure(rateStore, ip);
      return json({ error: 'Mot de passe incorrect' }, { status: 401 });
    }
    await clearLoginFailures(rateStore, ip);
    const exp = Date.now() + TTL_MS;
    return json(
      { ok: true },
      {
        headers: {
          'Set-Cookie': `${COOKIE}=${exp}.${sign(env.sessionSecret, String(exp))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
        },
      },
    );
  }

  if (route === '/auth/logout' && method === 'POST') {
    return json(
      { ok: true },
      { headers: { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } },
    );
  }

  if (route === '/auth/me') return json({ admin: isAdmin(req, env) });

  // ── Tournois ──
  if (route === '/tournaments' && method === 'GET') {
    const state = (await store.read()) ?? { tournaments: [] };
    const list = [...state.tournaments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(list.map(tournamentSummary));
  }

  if (route === '/tournaments' && method === 'POST') {
    if (!isAdmin(req, env)) return json({ error: 'Accès organisateur requis' }, { status: 401 });
    const input = createTournamentSchema.parse(await readJsonBody(req));
    const t: Tournament = {
      id: crypto.randomBytes(5).toString('base64url'),
      name: input.name,
      type: input.type,
      doubleRound: input.doubleRound,
      createdAt: new Date().toISOString(),
      players: input.players.map((name) => ({ id: crypto.randomUUID(), name })),
      matches: [],
      ...(input.type === 'league-knockout' ? { qualifiers: input.qualifiers } : {}),
      ...(input.type === 'groups-knockout'
        ? { groupsCount: input.groupsCount, qualifiedPerGroup: input.qualifiedPerGroup ?? 1 }
        : {}),
      ...(input.type === 'playoff'
        ? { groupsCount: input.groupsCount, qualifiedPerGroup: input.qualifiedPerGroup ?? 1 }
        : {}),
    };
    rebuildSchedule(t);
    const state = (await store.read()) ?? { tournaments: [] };
    state.tournaments.push(t);
    await store.write(state);
    return json(publicView(t), { status: 201 });
  }

  if (seg[0] === 'tournaments' && seg.length >= 2) {
    const id = decodeURIComponent(seg[1]);
    const state = (await store.read()) ?? { tournaments: [] };
    const idx = state.tournaments.findIndex((x) => x.id === id);

    if (seg.length === 2 && method === 'GET') {
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      return json(publicView(state.tournaments[idx]));
    }

    if (seg.length === 2 && method === 'DELETE') {
      if (!isAdmin(req, env)) return json({ error: 'Accès organisateur requis' }, { status: 401 });
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      state.tournaments.splice(idx, 1);
      await store.write(state);
      return json({ ok: true });
    }

    // /tournaments/:id/matches/:matchId/result
    if (seg[2] === 'matches' && seg[4] === 'result' && method === 'PATCH') {
      if (!isAdmin(req, env)) return json({ error: 'Accès organisateur requis' }, { status: 401 });
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];
      const input: ResultInput = resultSchema.parse(await readJsonBody(req));
      const matchId = decodeURIComponent(seg[3]);
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
      maybeGenerateKnockoutPhase(t);
      maybeGeneratePlayoffPhase(t);
      await store.write(state);
      return json(publicView(t));
    }

    // /tournaments/:id/players[/:playerId]
    if (seg[2] === 'players') {
      if (!isAdmin(req, env)) return json({ error: 'Accès organisateur requis' }, { status: 401 });
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];

      if (seg.length === 3 && method === 'POST') {
        if (anyMatchPlayed(t)) throw new HttpError(409, 'Le tournoi a démarré : roster verrouillé');
        if (t.players.length >= 32) throw new HttpError(409, 'Maximum 32 joueurs');
        const { name } = addPlayerSchema.parse(await readJsonBody(req));
        if (t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
          throw new HttpError(409, 'Ce nom existe déjà dans le roster');
        }
        t.players.push({ id: crypto.randomUUID(), name });
        rebuildSchedule(t);
        await store.write(state);
        return json(publicView(t), { status: 201 });
      }

      if (seg.length === 4 && method === 'DELETE') {
        if (anyMatchPlayed(t)) throw new HttpError(409, 'Le tournoi a démarré : roster verrouillé');
        const minPlayers = t.type === 'knockout' ? 2 : 3;
        if (t.players.length <= minPlayers) {
          throw new HttpError(409, `Minimum ${minPlayers} joueurs requis pour ce format`);
        }
        const playerId = decodeURIComponent(seg[3]);
        const before = t.players.length;
        t.players = t.players.filter((p) => p.id !== playerId);
        if (t.players.length === before) throw new HttpError(404, 'Joueur introuvable');
        rebuildSchedule(t);
        await store.write(state);
        return json(publicView(t));
      }
    }
  }

  throw new HttpError(404, 'Route inconnue');
}

/** Point d'entrée brut : nettoie le préfixe puis délègue, avec gestion d'erreurs homogène. */
export async function handleApi(
  req: Request,
  store: CloudStore,
  env: CloudEnv,
): Promise<Response> {
  const route = routeOf(req);
  let res: Response;
  try {
    res = await handleApiRoute(route, req, store, env);
  } catch (err) {
    if (err instanceof HttpError) {
      res = json({ error: err.message }, { status: err.status });
    } else if (err instanceof Error && err.name === 'ZodError') {
      const issues = (err as unknown as { issues: { message: string }[] }).issues.map(
        (i) => i.message,
      );
      res = json({ error: 'Données invalides', details: issues }, { status: 400 });
    } else {
      console.error('[api] Erreur interne inattendue', err);
      res = json({ error: 'Erreur interne' }, { status: 500 });
    }
  }
  return refreshedSessionResponse(req, env, res);
}
