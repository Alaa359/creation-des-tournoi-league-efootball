import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../core/config';
import { logger } from '../core/logger';

const COOKIE = 'efc_admin';
const TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string): string {
  return crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/** Token « expiration.signature » vérifié en temps constant. */
function verifyToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return false;
  const expRaw = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = Buffer.from(sign(expRaw));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function isAdmin(req: Request): boolean {
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Accès organisateur requis' });
}

export function loginHandler(req: Request, res: Response): void {
  const password = req.body?.password;
  if (typeof password !== 'string' || password !== config.adminPassword) {
    logger.warn('Échec de connexion organisateur');
    res.status(401).json({ error: 'Mot de passe incorrect' });
    return;
  }
  const exp = Date.now() + TTL_MS;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${exp}.${sign(String(exp))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
  );
  logger.info('Session organisateur ouverte');
  res.json({ ok: true });
}

export function logoutHandler(_req: Request, res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}

export function meHandler(req: Request, res: Response): void {
  res.json({ admin: isAdmin(req) });
}
