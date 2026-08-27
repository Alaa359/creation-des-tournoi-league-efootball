import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  registerSchema,
  loginSchema,
  resultSchema,
  type Tournament,
  type User,
  type UserPublic,
} from '../domain/types';
import { HttpError } from '../core/errors';

/** État persisté (équivalent de data/db.json, ici dans Netlify Blobs / KV). */
export interface CloudState {
  users: User[];
  tournaments: Tournament[];
}

/** Adaptateur de stockage injecté (Blobs en prod, mémoire dans les tests). */
export interface CloudStore {
  read(): Promise<CloudState | null>;
  write(state: CloudState): Promise<void>;
}

export interface CloudEnv {
  sessionSecret: string;
}

// ── TTL tournois : suppression auto après 30 jours ─────────────────────────

export const TOURNAMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function purgeExpiredTournaments(state: CloudState): number {
  const cutoff = Date.now() - TOURNAMENT_TTL_MS;
  const before = state.tournaments.length;
  state.tournaments = state.tournaments.filter((t) => {
    const created = new Date(t.createdAt).getTime();
    return created > cutoff;
  });
  return before - state.tournaments.length;
}

// ── Auth : cookie HMAC « expiration.userId.signature » ─────────────────────

const COOKIE = 'efc_session';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 heures

// ── Hachage de mot de passe (SHA-256 + salt, node:crypto) ──────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const hash = createHash('sha256').update(salt + password).digest('hex');
  return hash === expectedHash;
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
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

/** Vérifie le token et retourne l'userId ou null. */
function verifyToken(secret: string, token: string | undefined): string | null {
  if (!token || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const expRaw = token.slice(0, dot);
  const parts = expRaw.split(':');
  if (parts.length !== 2) return null;
  const exp = Number(parts[0]);
  const userId = parts[1];
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(secret, expRaw));
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(expected, given)) return null;
  return userId;
}

function makeSessionToken(secret: string, userId: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${exp}:${userId}`;
  return `${payload}.${sign(secret, payload)}`;
}

let _cachedState: CloudState | null = null;

/** Reset in-memory cache (for tests only). */
export function _resetState(): void {
  _cachedState = null;
  _loginFailures.clear();
}

// ── Simple in-memory login rate limiter ──
const _loginFailures = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 5;

function checkLoginRate(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const bucket = _loginFailures.get(ip);
  if (bucket && bucket.resetAt > now && bucket.count >= RATE_MAX) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const bucket = _loginFailures.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    _loginFailures.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
  } else {
    bucket.count += 1;
  }
}

function clearLoginFailures(ip: string): void {
  _loginFailures.delete(ip);
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return '127.0.0.1';
}

function randomId(): string {
  return randomUUID();
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

async function currentUser(req: Request, env: CloudEnv, store: CloudStore): Promise<User | null> {
  const token = verifyToken(env.sessionSecret, parseCookies(req.headers.get('cookie'))[COOKIE]);
  if (!token) return null;
  const state = await readState(store);
  return state.users.find((u) => u.id === token) ?? null;
}

async function isAdmin(req: Request, env: CloudEnv, store: CloudStore): Promise<boolean> {
  const user = await currentUser(req, env, store);
  return user?.role === 'admin';
}

async function requireUser(req: Request, env: CloudEnv, store: CloudStore): Promise<User> {
  const user = await currentUser(req, env, store);
  if (!user) throw new HttpError(401, 'Connexion requise');
  return user;
}

async function requireApprovedUser(req: Request, env: CloudEnv, store: CloudStore): Promise<User> {
  const user = await requireUser(req, env, store);
  if (!user.approved) throw new HttpError(403, "Compte en attente d'approbation par l'administrateur");
  return user;
}

function userPublic(u: User): UserPublic {
  const { passwordHash, ...rest } = u;
  return rest;
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

function tournamentSummary(t: Tournament, users?: Map<string, User>) {
  const creator = users?.get(t.createdBy ?? '');
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    createdAt: t.createdAt,
    playerCount: t.players.length,
    status: t.status ?? 'active',
    expiresAt: new Date(new Date(t.createdAt).getTime() + TOURNAMENT_TTL_MS).toISOString(),
    creatorName: creator?.name,
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

async function readState(store: CloudStore): Promise<CloudState> {
  if (!_cachedState) {
    _cachedState = (await store.read()) ?? { users: [], tournaments: [] };
    if (!_cachedState.users) _cachedState.users = [];
    if (!_cachedState.tournaments) _cachedState.tournaments = [];
    const purged = purgeExpiredTournaments(_cachedState);
    if (purged > 0) {
      await store.write(_cachedState);
    }
  }
  return _cachedState;
}

async function writeState(store: CloudStore, state: CloudState): Promise<void> {
  _cachedState = state;
  await store.write(state);
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

  // ════════════════════════════════════════════════════════════════════════
  //  AUTH : inscription, connexion, déconnexion, session
  // ════════════════════════════════════════════════════════════════════════

  // POST /auth/register
  if (route === '/auth/register' && method === 'POST') {
    const body = registerSchema.parse(await readJsonBody(req));
    const state = await readState(store);
    if (state.users.some((u) => u.email.toLowerCase() === body.email.toLowerCase())) {
      throw new HttpError(409, 'Un compte avec cet email existe déjà');
    }
    const isFirst = state.users.length === 0;
    const user: User = {
      id: randomId(),
      name: body.name,
      email: body.email.toLowerCase(),
      passwordHash: hashPassword(body.password),
      role: isFirst ? 'admin' : 'user',
      approved: isFirst,
      createdAt: new Date().toISOString(),
    };
    state.users.push(user);
    await writeState(store, state);
    if (isFirst) {
      const res = json({ ok: true, user: userPublic(user) }, { status: 201 });
      return new Response(res.body, {
        status: res.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `${COOKIE}=${makeSessionToken(env.sessionSecret, user.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
        },
      });
    }
    return json({ ok: true, pending: true, message: "Compte en attente d'approbation par l'administrateur" }, { status: 202 });
  }

  // POST /auth/login
  if (route === '/auth/login' && method === 'POST') {
    const ip = clientIp(req);
    const rateCheck = checkLoginRate(ip);
    if (!rateCheck.ok) {
      return new Response(JSON.stringify({ error: `Trop de tentatives. Réessayez dans ${Math.max(1, Math.ceil((rateCheck.retryAfter ?? 0) / 60))} min.` }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter) },
      });
    }
    const body = loginSchema.parse(await readJsonBody(req));
    const state = await readState(store);
    const user = state.users.find((u) => u.email === body.email.toLowerCase());
    if (!user || !verifyPassword(body.password, user.passwordHash)) {
      recordLoginFailure(ip);
      throw new HttpError(401, 'Email ou mot de passe incorrect');
    }
    if (!user.approved) {
      throw new HttpError(403, "Compte en attente d'approbation par l'administrateur");
    }
    clearLoginFailures(ip);
    const res = json({ ok: true, user: userPublic(user) });
    return new Response(res.body, {
      status: res.status,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${COOKIE}=${makeSessionToken(env.sessionSecret, user.id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
      },
    });
  }

  // POST /auth/logout
  if (route === '/auth/logout' && method === 'POST') {
    return json(
      { ok: true },
      { headers: { 'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } },
    );
  }

  // GET /auth/me
  if (route === '/auth/me') {
    const user = await currentUser(req, env, store);
    if (!user) return json({ user: null });
    return json({ user: userPublic(user) });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  ADMIN : gestion des utilisateurs
  // ════════════════════════════════════════════════════════════════════════

  // GET /admin/users
  if (route === '/admin/users' && method === 'GET') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    return json(state.users.map(userPublic));
  }

  // PATCH /admin/users/:userId/approve
  if (seg[0] === 'admin' && seg[1] === 'users' && seg[3] === 'approve' && method === 'PATCH') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const user = state.users.find((u) => u.id === seg[2]);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    user.approved = true;
    await writeState(store, state);
    return json({ ok: true, user: userPublic(user) });
  }

  // PATCH /admin/users/:userId/reject
  if (seg[0] === 'admin' && seg[1] === 'users' && seg[3] === 'reject' && method === 'PATCH') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const user = state.users.find((u) => u.id === seg[2]);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    if (user.role === 'admin') throw new HttpError(400, 'Impossible de désapprouver l\'administrateur');
    user.approved = false;
    await writeState(store, state);
    return json({ ok: true, user: userPublic(user) });
  }

  // DELETE /admin/users/:userId
  if (seg[0] === 'admin' && seg[1] === 'users' && seg.length === 3 && method === 'DELETE') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const user = state.users.find((u) => u.id === seg[2]);
    if (!user) throw new HttpError(404, 'Utilisateur introuvable');
    if (user.role === 'admin') throw new HttpError(400, 'Impossible de supprimer l\'administrateur');
    state.users = state.users.filter((u) => u.id !== seg[2]);
    await writeState(store, state);
    return json({ ok: true });
  }

  // GET /admin/tournaments (tous, y compris pending)
  if (route === '/admin/tournaments' && method === 'GET') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const list = [...state.tournaments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const users = new Map(state.users.map((u) => [u.id, u]));
    return json(list.map((t) => ({
      ...tournamentSummary(t, users),
      status: t.status ?? 'active',
      createdBy: t.createdBy ? userPublic(users.get(t.createdBy)!) : undefined,
      rejectReason: t.rejectReason,
    })));
  }

  // PATCH /admin/tournaments/:id/approve
  if (seg[0] === 'admin' && seg[1] === 'tournaments' && seg[3] === 'approve' && method === 'PATCH') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const t = state.tournaments.find((x) => x.id === seg[2]);
    if (!t) throw new HttpError(404, 'Tournoi introuvable');
    t.status = 'active';
    t.rejectReason = undefined;
    await writeState(store, state);
    return json({ ok: true });
  }

  // PATCH /admin/tournaments/:id/reject
  if (seg[0] === 'admin' && seg[1] === 'tournaments' && seg[3] === 'reject' && method === 'PATCH') {
    if (!(await isAdmin(req, env, store))) throw new HttpError(403, 'Accès administrateur requis');
    const state = await readState(store);
    const t = state.tournaments.find((x) => x.id === seg[2]);
    if (!t) throw new HttpError(404, 'Tournoi introuvable');
    const body = await readJsonBody(req) as { reason?: string };
    t.status = 'pending';
    t.rejectReason = body.reason ?? 'Demande refusée par l\'administrateur';
    await writeState(store, state);
    return json({ ok: true });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  TOURNOIS
  // ════════════════════════════════════════════════════════════════════════

  // GET /tournaments — liste publique (uniquement les tournois actifs)
  if (route === '/tournaments' && method === 'GET') {
    const state = await readState(store);
    const users = new Map(state.users.map((u) => [u.id, u]));
    const list = [...state.tournaments]
      .filter((t) => t.status !== 'pending')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(list.map((t) => tournamentSummary(t, users)));
  }

  // GET /my/tournaments — tournois de l'utilisateur connecté (y compris pending)
  if (route === '/my/tournaments' && method === 'GET') {
    const user = await requireUser(req, env, store);
    const state = await readState(store);
    const users = new Map(state.users.map((u) => [u.id, u]));
    const list = [...state.tournaments]
      .filter((t) => t.createdBy === user.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(list.map((t) => ({ ...tournamentSummary(t, users), status: t.status ?? 'active' })));
  }

  // POST /tournaments — création (nécessite compte approuvé)
  if (route === '/tournaments' && method === 'POST') {
    const user = await requireApprovedUser(req, env, store);
    const input = createTournamentSchema.parse(await readJsonBody(req));
    const t: Tournament = {
      id: randomBase64Url(5),
      name: input.name,
      type: input.type,
      doubleRound: input.doubleRound,
      createdAt: new Date().toISOString(),
      players: input.players.map((name) => ({ id: randomId(), name })),
      matches: [],
      createdBy: user.id,
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
    const state = await readState(store);
    state.tournaments.push(t);
    await writeState(store, state);
    return json(publicView(t), { status: 201 });
  }

  // ── Tournoi par ID ──
  if (seg[0] === 'tournaments' && seg.length >= 2) {
    const id = decodeURIComponent(seg[1]);
    const state = await readState(store);
    const idx = state.tournaments.findIndex((x) => x.id === id);

    // GET /tournaments/:id
    if (seg.length === 2 && method === 'GET') {
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];
      if (t.status === 'pending') {
        const user = await currentUser(req, env, store);
        if (!user || (t.createdBy !== user.id && user.role !== 'admin')) {
          throw new HttpError(404, 'Tournoi introuvable');
        }
      }
      return json(publicView(t));
    }

    // DELETE /tournaments/:id
    if (seg.length === 2 && method === 'DELETE') {
      const user = await requireUser(req, env, store);
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];
      if (t.createdBy !== user.id && user.role !== 'admin') {
        throw new HttpError(403, 'Non autorisé');
      }
      state.tournaments.splice(idx, 1);
      await writeState(store, state);
      return json({ ok: true });
    }

    // PATCH /tournaments/:id/matches/:matchId/result
    if (seg[2] === 'matches' && seg[4] === 'result' && method === 'PATCH') {
      const user = await requireUser(req, env, store);
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];
      if (t.createdBy !== user.id && user.role !== 'admin') {
        throw new HttpError(403, 'Non autorisé');
      }
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
      await writeState(store, state);
      return json(publicView(t));
    }

    // /tournaments/:id/players[/:playerId]
    if (seg[2] === 'players') {
      const user = await requireUser(req, env, store);
      if (idx < 0) throw new HttpError(404, 'Tournoi introuvable');
      const t = state.tournaments[idx];
      if (t.createdBy !== user.id && user.role !== 'admin') {
        throw new HttpError(403, 'Non autorisé');
      }

      if (seg.length === 3 && method === 'POST') {
        if (anyMatchPlayed(t)) throw new HttpError(409, 'Le tournoi a démarré : roster verrouillé');
        if (t.players.length >= 32) throw new HttpError(409, 'Maximum 32 joueurs');
        const { name } = addPlayerSchema.parse(await readJsonBody(req));
        if (t.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
          throw new HttpError(409, 'Ce nom existe déjà dans le roster');
        }
        t.players.push({ id: randomId(), name });
        rebuildSchedule(t);
        await writeState(store, state);
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
        await writeState(store, state);
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
  return res;
}
