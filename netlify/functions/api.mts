import { getStore } from '@netlify/blobs';
import { handleApi, type CloudState, type CloudStore } from '../../server/src/cloud/api';
import type { LoginAttemptRecord, LoginRateStore } from '../../server/src/cloud/rateLimit';

/**
 * Point d'entrée Netlify Functions v2 : sert TOUTES les routes /api/*.
 * Les données sont stockées dans Netlify Blobs (magasin 'efootball', blob 'state.json')
 * — équivalent cloud de data/db.json, conservé entre les déploiements.
 */

function blobsStore(): CloudStore {
  const store = getStore({ name: 'efootball', consistency: 'strong' });
  return {
    async read(): Promise<CloudState | null> {
      return (await store.get('state.json', { type: 'json' })) as CloudState | null;
    },
    async write(state: CloudState): Promise<void> {
      await store.setJSON('state.json', state);
    },
  };
}

/** Limiteur de tentatives sur Blobs ; l'expiration est gérée à la lecture via resetAt. */
function blobsRateLimitStore(): LoginRateStore {
  const store = getStore({ name: 'efootball', consistency: 'strong' });
  return {
    async get(key): Promise<LoginAttemptRecord | null> {
      const rec = (await store.get(`rate/${key}`, { type: 'json' })) as LoginAttemptRecord | null;
      if (!rec || rec.resetAt <= Date.now()) return null;
      return rec;
    },
    async put(key, value): Promise<void> {
      if (value.count <= 0) {
        await store.delete(`rate/${key}`);
        return;
      }
      await store.setJSON(`rate/${key}`, value);
    },
  };
}

export default async (req: Request): Promise<Response> => {
  const adminPassword = process.env.ADMIN_PASSWORD ?? '';
  const sessionSecret = process.env.SESSION_SECRET ?? '';
  if (!adminPassword || !sessionSecret) {
    console.error(
      'ADMIN_PASSWORD / SESSION_SECRET manquants : définissez-les dans les variables d’environnement Netlify.',
    );
    return new Response('Configuration serveur incomplète', { status: 500 });
  }
  return handleApi(req, blobsStore(), {
    adminPassword,
    sessionSecret,
    rateStore: blobsRateLimitStore(),
  });
};
