import os from 'node:os';
import express, { type ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { config } from './core/config';
import { initDb } from './core/db';
import { HttpError } from './core/errors';
import { logger } from './core/logger';
import { apiRouter } from './http/tournaments.routes';
import { mountStatic } from './http/static';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

// Journal d'accès API (Protocole n°4) — une ligne info par requête, SSE exclu.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const route = req.originalUrl.split('?')[0];
    if (!route.startsWith('/api') || route.includes('/events')) return;
    const ms = Date.now() - start;
    const line = `${req.method} ${route} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) logger.error(line);
    else if (res.statusCode >= 400) logger.warn(line);
    else logger.info(line);
  });
  next();
});

app.use('/api', apiRouter);
mountStatic(app);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue' }));

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Données invalides',
      details: err.issues.map((i) => i.message),
    });
  }
  if (typeof (err as { type?: string }).type === 'string' && (err as { type: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Corps JSON invalide' });
  }
  logger.error({ err }, 'Erreur interne inattendue');
  return res.status(500).json({ error: 'Erreur interne' });
};
app.use(errorHandler);

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

async function main(): Promise<void> {
  await initDb();

  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info('── eFootball Cup ──────────────────────────────');
    logger.info(`Local     : http://localhost:${config.port}`);
    for (const ip of lanAddresses()) {
      logger.info(`Réseau LAN : http://${ip}:${config.port}`);
    }
    logger.info(
      config.adminPasswordIsDefault
        ? 'Mot de passe organisateur PAR DÉFAUT ("admin1234") — modifiez ADMIN_PASSWORD dans .env'
        : 'Mot de passe organisateur personnalisé actif',
    );
    if (config.sessionSecretGenerated) {
      logger.debug('SESSION_SECRET généré à la volée — les sessions admin expirent au redémarrage');
    }
    logger.info('───────────────────────────────────────────────');
  });

  const shutdown = (): void => {
    logger.info('Arrêt du serveur…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
