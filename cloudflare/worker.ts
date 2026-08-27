import { handleApi, type CloudState, type CloudStore } from '../server/src/cloud/api';

/**
 * Point d'entrée Cloudflare Worker : sert TOUTES les routes /api/*.
 * Les données des tournois sont stockées dans Cloudflare KV (binding STATE)
 * — équivalent cloud de data/db.json, conservé entre les déploiements.
 */

/** Interface minimale du KV Cloudflare (évite une dépendance de typage). */
interface KvLike {
  get(key: string, type: 'json' | 'text'): Promise<unknown>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  STATE: KvLike;
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
    if (!env.SESSION_SECRET) {
      console.error(
        'SESSION_SECRET manquant : définissez-le via `npx wrangler secret put`.',
      );
      return new Response('Configuration serveur incomplète', { status: 500 });
    }
    return handleApi(req, kvStore(env.STATE), {
      sessionSecret: env.SESSION_SECRET,
    });
  },
};
