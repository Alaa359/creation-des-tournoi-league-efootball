import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../core/config';
import {
  deleteUser,
  findUserByEmail,
  findUserById,
  insertUser,
  updateUser,
  listUsers,
} from '../core/db';
import { logger } from '../core/logger';
import { loginSchema, registerSchema } from '../domain/types';
import { loginRateLimiter, recordLoginFailure, clearLoginFailures } from './rateLimit';

const COOKIE = 'efc_session';
const TTL_MS = 24 * 60 * 60 * 1000;

// ── Helpers ──

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHash] = stored.split(':');
  if (!salt || !expectedHash) return false;
  const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
  return hash === expectedHash;
}

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

/** Token « expiration.userId.signature » vérifié en temps constant. */
function verifyToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const expRaw = token.slice(0, dot);
  const rest = token.slice(dot + 1);
  const dot2 = rest.indexOf('.');
  if (dot2 <= 0) return null;
  const userId = rest.slice(0, dot2);
  const sig = rest.slice(dot2 + 1);
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = Buffer.from(sign(`${expRaw}.${userId}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  return userId;
}

function setSessionCookie(res: Response, userId: string): void {
  const exp = Date.now() + TTL_MS;
  const sig = sign(`${exp}.${userId}`);
  const value = `${exp}.${userId}.${sig}`;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}`,
  );
}

function currentUserId(req: Request): string | null {
  return verifyToken(parseCookies(req.headers.cookie)[COOKIE]);
}

function toPublic(u: import('../domain/types').User) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, approved: u.approved, createdAt: u.createdAt };
}

// ── Middleware ──

export function touchSession(_req: Request, res: Response, next: NextFunction): void {
  const userId = currentUserId(_req);
  if (userId) setSessionCookie(res, userId);
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: 'Connexion requise' }); return; }
  const user = findUserById(userId);
  if (!user) { res.status(401).json({ error: 'Utilisateur introuvable' }); return; }
  if (!user.approved) { res.status(403).json({ error: 'Compte en attente d\'approbation' }); return; }
  (req as any).userId = userId;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const userId = currentUserId(req);
  if (!userId) { res.status(401).json({ error: 'Connexion requise' }); return; }
  const user = findUserById(userId);
  if (!user || user.role !== 'admin') { res.status(403).json({ error: 'Accès administrateur requis' }); return; }
  (req as any).userId = userId;
  next();
}

// ── Handlers ──

export function registerHandler(req: Request, res: Response): void {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Données invalides', details: parsed.error.issues.map((i) => i.message) }); return; }
  const { name, email, password } = parsed.data;
  if (findUserByEmail(email)) { res.status(409).json({ error: 'Email déjà utilisé' }); return; }
  const users = listUsers();
  const isFirst = users.length === 0;
  const user: import('../domain/types').User = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: hashPassword(password),
    role: isFirst ? 'admin' : 'user',
    approved: isFirst,
    createdAt: new Date().toISOString(),
  };
  insertUser(user);
  setSessionCookie(res, user.id);
  logger.info({ userId: user.id, role: user.role }, 'Utilisateur inscrit');
  res.status(201).json({ ok: true, user: toPublic(user) });
}

export function loginHandler(req: Request, res: Response): void {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Données invalides' }); return; }
  const { email, password } = parsed.data;
  const user = findUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    recordLoginFailure(req);
    logger.warn({ email }, 'Échec de connexion');
    res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    return;
  }
  if (!user.approved) {
    res.status(403).json({ error: 'Compte en attente d\'approbation par l\'administrateur' });
    return;
  }
  clearLoginFailures(req);
  setSessionCookie(res, user.id);
  logger.info({ userId: user.id }, 'Connexion réussie');
  res.json({ ok: true, user: toPublic(user) });
}

export function logoutHandler(_req: Request, res: Response): void {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
}

export function meHandler(req: Request, res: Response): void {
  const userId = currentUserId(req);
  if (!userId) { res.json({ user: null }); return; }
  const user = findUserById(userId);
  if (!user) { res.json({ user: null }); return; }
  res.json({ user: toPublic(user) });
}

// ── Admin handlers ──

export function adminListUsersHandler(_req: Request, res: Response): void {
  res.json(listUsers().map(toPublic));
}

export function adminApproveUserHandler(req: Request, res: Response): void {
  const user = findUserById(String(req.params.userId));
  if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
  user.approved = true;
  updateUser(user);
  logger.info({ userId: user.id }, 'Utilisateur approuvé');
  res.json({ ok: true, user: toPublic(user) });
}

export function adminRejectUserHandler(req: Request, res: Response): void {
  const user = findUserById(String(req.params.userId));
  if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
  user.approved = false;
  updateUser(user);
  logger.info({ userId: user.id }, 'Utilisateur désactivé');
  res.json({ ok: true, user: toPublic(user) });
}

export function adminDeleteUserHandler(req: Request, res: Response): void {
  const id = String(req.params.userId);
  const user = findUserById(id);
  if (!user) { res.status(404).json({ error: 'Utilisateur introuvable' }); return; }
  if (user.role === 'admin') { res.status(403).json({ error: 'Impossible de supprimer l\'administrateur' }); return; }
  deleteUser(id);
  logger.info({ userId: id }, 'Utilisateur supprimé');
  res.json({ ok: true });
}
