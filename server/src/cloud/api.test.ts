import { describe, expect, it } from 'vitest';
import { handleApi, type CloudStore, type CloudState } from './api';

const env = { adminPassword: 'test-pass', sessionSecret: 'secret-de-test-12chars' };

function memoryStore(initial: CloudState | null = null): CloudStore & { data: CloudState | null } {
  const box: { data: CloudState | null } = { data: initial };
  return {
    get data() {
      return box.data;
    },
    set data(v: CloudState | null) {
      box.data = v;
    },
    async read() {
      return box.data;
    },
    async write(state: CloudState) {
      box.data = JSON.parse(JSON.stringify(state)) as CloudState;
    },
  };
}

function req(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost/api${path}`, init);
}

async function loginAsAdmin(password = env.adminPassword): Promise<string> {
  const res = await handleApi(
    req('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }),
    memoryStore(),
    env,
  );
  expect(res.status).toBe(200);
  const cookie = res.headers.get('Set-Cookie') ?? '';
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
      headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
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

  it('login refusé avec un mauvais mot de passe (401)', async () => {
    const res = await handleApi(
      req('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'mauvais' }),
      }),
      memoryStore(),
      env,
    );
    expect(res.status).toBe(401);
  });

  it('me sans session → admin:false ; après login via cookie → true', async () => {
    const noAuth = await handleApi(req('/auth/me'), memoryStore(), env);
    expect(((await noAuth.json()) as { admin: boolean }).admin).toBe(false);

    const cookie = await loginAsAdmin();
    const yes = await handleApi(req('/auth/me', { headers: { cookie } }), memoryStore(), env);
    expect(((await yes.json()) as { admin: boolean }).admin).toBe(true);
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
    expect(body.matches).toHaveLength(66); // N=12 : C(12,2)
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
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
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
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
        body: JSON.stringify({ homeScore: -5, awayScore: 0 }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details?: string[] };
    expect(body.details?.length).toBeGreaterThan(0);
  });

  it('roster verrouillé dès qu’un match est joué (409)', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as {
      id: string;
      matches: { id: string }[];
    };
    await handleApi(
      req(`/tournaments/${created.id}/matches/${created.matches[0].id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
        body: JSON.stringify({ homeScore: 1, awayScore: 0 }),
      }),
      store,
      env,
    );
    const res = await handleApi(
      req(`/tournaments/${created.id}/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
        body: JSON.stringify({ name: 'Nouveau' }),
      }),
      store,
      env,
    );
    expect(res.status).toBe(409);
  });

  it('suppression réservée à l’admin puis 404 si répétée', async () => {
    const store = memoryStore();
    const created = (await (await createLeague(store)).json()) as { id: string };

    const noAuth = await handleApi(req(`/tournaments/${created.id}`, { method: 'DELETE' }), store, env);
    expect(noAuth.status).toBe(401);

    const ok = await handleApi(
      req(`/tournaments/${created.id}`, { method: 'DELETE', headers: { cookie: await loginAsAdmin() } }),
      store,
      env,
    );
    expect(ok.status).toBe(200);

    const again = await handleApi(
      req(`/tournaments/${created.id}`, { method: 'DELETE', headers: { cookie: await loginAsAdmin() } }),
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
    const created = (await (
      await handleApi(
        req('/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
          body: JSON.stringify({
            name: 'KO Cup', type: 'knockout', doubleRound: false,
            players: ['A', 'B', 'C', 'D'],
          }),
        }),
        store,
        env,
      )
    ).json()) as { id: string; matches: { id: string; round: number; nextMatchId?: string }[] };

    const first = created.matches.find((m) => m.round === 1)!;

    const drawNoPens = await handleApi(
      req(`/tournaments/${created.id}/matches/${first.id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
        body: JSON.stringify({ homeScore: 1, awayScore: 1 }),
      }),
      store,
      env,
    );
    expect(drawNoPens.status).toBe(400);

    const withPens = await handleApi(
      req(`/tournaments/${created.id}/matches/${first.id}/result`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', cookie: await loginAsAdmin() },
        body: JSON.stringify({ homeScore: 1, awayScore: 1, homePens: 4, awayPens: 3 }),
      }),
      store,
      env,
    );
    expect(withPens.status).toBe(200);
  });
});
