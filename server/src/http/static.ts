import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { ROOT_DIR } from '../core/config';
import { logger } from '../core/logger';

/** Sert la SPA buildée (web/dist) avec fallback index.html — production LAN. */
export function mountStatic(app: Express): void {
  const distDir = path.join(ROOT_DIR, 'web', 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    logger.info('Front non buildé (web/dist absent) — utilisez `npm run dev` ou `npm run build`');
    return;
  }
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });
}
