import { getStore } from '@netlify/blobs';
import { handleApi, type CloudState, type CloudStore } from '../../server/src/cloud/api';

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

export default async (req: Request): Promise<Response> => {
  const env = {
    adminPassword: process.env.ADMIN_PASSWORD ?? 'admin1234',
    sessionSecret: process.env.SESSION_SECRET ?? '',
  };
  return handleApi(req, blobsStore(), env);
};
