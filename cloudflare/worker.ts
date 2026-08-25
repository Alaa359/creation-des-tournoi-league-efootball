import { handleApi, type CloudState, type CloudStore } from '../server/src/cloud/api';

/**
 * Point d'entrée Cloudflare Worker : sert TOUTES les routes /api/*.
 * Les données des tournois sont stockées dans Cloudflare KV (binding STATE)
 * — équivalent cloud de data/db.json, conservé entre les déploiements.
 */

/** Interface minimale du KV Cloudflare (évite une dépendance de typage). */
interface KvLike {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  STATE: KvLike;
  ADMIN_PASSWORD?: string;
  SESSION_SECRET?: string;
}

function kvStore(kv: KvLike): CloudStore {
  return {
    async read(): Promise<CloudState | null> {
      return ((await kv.get('state.json', 'json')) as CloudState | null) ?? null;
    },
    async write(state: CloudState): Promise<void> {
      await kv.put('state.json', JSON.stringify(state));
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleApi(req, kvStore(env.STATE), {
      adminPassword: env.ADMIN_PASSWORD ?? 'admin1234',
      sessionSecret: env.SESSION_SECRET ?? '',
    });
  },
};
