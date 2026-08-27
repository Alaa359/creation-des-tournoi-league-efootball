import { describe, expect, it, beforeEach } from 'vitest';
import { handleApi, _resetState, TOURNAMENT_TTL_MS, type CloudStore, type CloudState } from './api';

const env = { sessionSecret: 'secret-de-test-12chars' };

beforeEach(() => { _resetState(); });

function memoryStore(initial: CloudState | null = null): CloudStore & { data: CloudState | null } {
  const box: { data: CloudState | null } = { data: initial };
  return {
    get data() { return box.data; },
    set data(v: CloudState | null) { box.data = v; },
    async read() { return box.data; },
    async write(state: CloudState) { box.data = JSON.parse(JSON.stringify(state)) as CloudState; },
  };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost/api${path}`, init);
}

async function setupAdmin(store: ReturnType<typeof memoryStore>): Promise<string> {
  const regRes = await handleApi(
    req('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Admin', email: 'admin@test.com', password: 'test1234' }),
    }),
    store,
    env,
  );
  // First call: 201 (created), subsequent: 409 (exists) — both fine
  const loginRes = await handleApi(
    req('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'test1234' }),
    }),
    store,
    env,
  );
  if (loginRes.status !== 200) {
    throw new Error(`Login failed with ${loginRes.status}: ${await loginRes.text()}`);
  }
  const cookie = loginRes.headers.get('Set-Cookie') ?? '';
  return cookie.split(';')[0];
}

const PLAYERS_12 = [
  'Alice', 'Bob', 'Carla', 'David', 'Eva', 'Farid',
  'Gina', 'Hugo', 'Ines', 'Jalel', 'Karim', 'Lina',
];

async function createLeague(store: ReturnType<typeof memoryStore>, players = PLAYERS_12) {
  return handleApi(
    req('/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: await setupAdmin(store) },
      body: JSON.stringify({ name: 'Cup Test', type: 'league', doubleRound: false, players }),
    }),
    store,
    env,
  );
}

describe('cloud api — santé & auth', () => {
  it('GET /health répond ok', async () => {
    const res = await handleApi(req('/health'), memoryStore(), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('register premier user → admin, login ok', async () => {
    const store = memoryStore();
    const regRes = await handleApi(
      req('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Admin', email: 'admin@test.com', password: 'test1234' }),
      }),
      store,
      env,
    );
    expect(regRes.status).toBe(201);
    const regBody = (await regRes.json()) as { user: { role: string } };
    expect(regBody.user.role).toBe('admin');

    const loginRes = await handleApi(
      req('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@test.com', password: 'test1234' }),
      }),
      store,
      env,
    );
    expect(loginRes.status).toBe(200);
  });

  it('login refusé avec un mauvais mot de passe (401)', async () => {
    const store = memoryStore();
    await setupAdmin(store);
    const res = await handleApi(
      req('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@test.com', password: 'mauvais' }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(401);
  });

  it('me sans session → user:null ; après login → user present', async () => {
    const store = memoryStore();
    const noAuth = await handleApi(req('/auth/me'), store, env);
    expect(((await noAuth.json()) as { user: unknown }).user).toBeNull();

    await setupAdmin(store);
    const meRes = await handleApi(
      req('/auth/me', { headers: { cookie: await setupAdmin(store) } }),
      store,
      env,
    );
    const body = (await meRes.json()) as { user: { role: string } };
    expect(body.user).toBeTruthy();
    expect(body.user.role).toBe('admin');
  });

  it('login bloqué en 429 après 5 échecs depuis la même IP', async () => {
    const store = memoryStore();
    await setupAdmin(store);
    const attempt = () =>
      handleApi(
        req('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
          body: JSON.stringify({ email: 'admin@test.com', password: 'mauvais' }),
        }),
        store,
        env,
      );

    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });
});

describe('cloud api — cycle de vie league complet', () => {
  it('création sans cookie → 401 ; avec cookie → 201 + 66 matchs pour 12 joueurs', async () => {
    const store = memoryStore();

    const denied = await handleApi(
      req('/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'X', type: 'league', doubleRound: false, players: ['A', 'B', 'C'],
        }),
      }),
      store,
      env,
    );
    expect(denied.status).toBe(401);

    const res = await createLeague(store);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; matches: unknown[]; standings: unknown[] };
    expect(body.matches).toHaveLength(66);
    expect(body.standings).toHaveLength(12);
    expect(store.data?.tournaments).toHaveLength(1);
  });

  it('liste des tournois triée du plus récent au plus ancien', async () => {
    const store = memoryStore();
    await createLeague(store);
    await createLeague(store);
    const res = await handleApi(req('/tournaments'), store, env);
    const list = (await res.json()) as { createdAt: string }[];
    expect(list).toHaveLength(2);
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
  });

  it('saisie de score → classement recalculé (3 pts vainqueur)', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as {
      id: string;
      matches: { id: string; homeId: string; awayId: string }[];
      players: { id: string; name: string }[];
    };
    const m = created.matches[0];
    const homeName = created.players.find((p) => p.id === m.homeId)?.name;

    const res = await handleApi(
      req(`/tournaments/${created.id}/matches/${m.id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await setupAdmin(store) },
        body: JSON.stringify({ homeScore: 3, awayScore: 1 }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(200);
    const view = (await res.json()) as {
      standings: { name: string; played: number; points: number; goalsFor: number }[];
    };
    const row = view.standings.find((s) => s.name === homeName);
    expect(row?.played).toBe(1);
    expect(row?.points).toBe(3);
    expect(row?.goalsFor).toBe(3);
  });

  it('score invalide → 400 avec détails zod', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as {
      id: string;
      matches: { id: string }[];
    };
    const res = await handleApi(
      req(`/tournaments/${created.id}/matches/${created.matches[0].id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await setupAdmin(store) },
        body: JSON.stringify({ homeScore: -5, awayScore: 0 }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details?: string[] };
    expect(body.details?.length).toBeGreaterThan(0);
  });

  it('roster verrouillé dès qu\'un match est joué (409)', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as {
      id: string;
      matches: { id: string }[];
    };
    await handleApi(
      req(`/tournaments/${created.id}/matches/${created.matches[0].id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await setupAdmin(store) },
        body: JSON.stringify({ homeScore: 1, awayScore: 0 }),
      }),
      store,
      env,
    );
    const res = await handleApi(
      req(`/tournaments/${created.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: await setupAdmin(store) },
        body: JSON.stringify({ name: 'Nouveau' }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(409);
  });

  it('suppression réservée à l\'admin puis 404 si répétée', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as { id: string };

    const noAuth = await handleApi(req(`/tournaments/${created.id}`, { method: 'DELETE' }), store, env);
    expect(noAuth.status).toBe(401);

    const ok = await handleApi(
      req(`/tournaments/${created.id}`, { method: 'DELETE', headers: { cookie: await setupAdmin(store) } }),
      store,
      env,
    );
    expect(ok.status).toBe(200);

    const again = await handleApi(
      req(`/tournaments/${created.id}`, { method: 'DELETE', headers: { cookie: await setupAdmin(store) } }),
      store,
      env,
    );
    expect(again.status).toBe(404);
  });

  it('tournoi introuvable → 404', async () => {
    const res = await handleApi(req('/tournaments/inexistant'), memoryStore(), env);
    expect(res.status).toBe(404);
  });
});

describe('cloud api — knockout avec tirs au but', () => {
  it('égalité sans pens → 400 ; avec pens → vainqueur propagé', async () => {
    const store = memoryStore();
    const cookie = await setupAdmin(store);
    const created = (await (
      await handleApi(
        req('/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({
            name: 'KO Cup', type: 'knockout', doubleRound: false,
            players: ['A', 'B', 'C', 'D'],
          }),
        }),
        store,
        env,
      )
    ).json()) as { id: string; matches: { id: string; round: number }[] };

    const first = created.matches.find((m) => m.round === 1)!;

    const drawNoPens = await handleApi(
      req(`/tournaments/${created.id}/matches/${first.id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ homeScore: 1, awayScore: 1 }),
      }),
      store,
      env,
    );
    expect(drawNoPens.status).toBe(400);

    const withPens = await handleApi(
      req(`/tournaments/${created.id}/matches/${first.id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ homeScore: 1, awayScore: 1, homePens: 4, awayPens: 3 }),
      }),
      store,
      env,
    );
    expect(withPens.status).toBe(200);
  });
});

describe('cloud api — suppression auto 30 jours', () => {
  it('un tournoi de plus de 30 jours est purgé automatiquement', async () => {
    const store = memoryStore();
    const cookie = await setupAdmin(store);

    // Créer un tournoi
    const created = (await (
      await handleApi(
        req('/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({ name: 'Old Cup', type: 'league', doubleRound: false, players: ['A', 'B', 'C'] }),
        }),
        store,
        env,
      )
    ).json()) as { id: string };

    // Vérifier qu'il existe
    const list1 = (await (await handleApi(req('/tournaments'), store, env)).json()) as unknown[];
    expect(list1.length).toBe(1);

    // Modifier la date de création pour simuler un tournoi de 31 jours
    _resetState();
    const state = await store.read();
    if (state) {
      const oldDate = new Date(Date.now() - TOURNAMENT_TTL_MS - 1000).toISOString();
      state.tournaments[0].createdAt = oldDate;
      await store.write(state);
    }

    // Prochaine lecture du state déclenche la purge
    _resetState();
    const list2 = (await (await handleApi(req('/tournaments'), store, env)).json()) as unknown[];
    expect(list2.length).toBe(0);
  });

  it('un tournoi de 29 jours n\'est pas purgé', async () => {
    const store = memoryStore();
    const cookie = await setupAdmin(store);

    await handleApi(
      req('/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'Recent Cup', type: 'league', doubleRound: false, players: ['A', 'B', 'C'] }),
      }),
      store,
      env,
    );

    // Modifier la date pour 29 jours (encore vivant)
    _resetState();
    const state = await store.read();
    if (state) {
      const recentDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString();
      state.tournaments[0].createdAt = recentDate;
      await store.write(state);
    }

    _resetState();
    const list = (await (await handleApi(req('/tournaments'), store, env)).json()) as unknown[];
    expect(list.length).toBe(1);
  });

  it('expiresAt est inclus dans le résumé des tournois', async () => {
    const store = memoryStore();
    const cookie = await setupAdmin(store);

    await handleApi(
      req('/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body: JSON.stringify({ name: 'TTL Cup', type: 'league', doubleRound: false, players: ['A', 'B', 'C'] }),
      }),
      store,
      env,
    );

    const list = (await (await handleApi(req('/tournaments'), store, env)).json()) as { expiresAt: string }[];
    expect(list[0].expiresAt).toBeTruthy();
    const expiresAt = new Date(list[0].expiresAt).getTime();
    const expected = Date.now() + TOURNAMENT_TTL_MS;
    // Tolérance de 5 secondes
    expect(Math.abs(expiresAt - expected)).toBeLessThan(5000);
  });
});
