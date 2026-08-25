import { handleApi, type CloudState, type CloudStore } from '../server/src/cloud/api';
import type { LoginRateStore } from '../server/src/cloud/rateLimit';

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

function kvRateLimitStore(kv: KvLike): LoginRateStore {
  return {
    async get(key) {
      return ((await kv.get(key, 'json')) as { count: number; resetAt: number } | null) ?? null;
    },
    async put(key, value, ttlSeconds) {
      await kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    },
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      console.error(
        'ADMIN_PASSWORD / SESSION_SECRET manquants : définissez-les via `npx wrangler secret put`.',
      );
      return new Response('Configuration serveur incomplète', { status: 500 });
    }
    return handleApi(req, kvStore(env.STATE), {
      adminPassword: env.ADMIN_PASSWORD,
      sessionSecret: env.SESSION_SECRET,
      rateStore: kvRateLimitStore(env.STATE),
    });
  },
};
