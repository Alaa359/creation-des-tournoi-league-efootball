import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tournament, User } from '../domain/types';
import { config } from './config';
import { logger } from './logger';

export const TOURNAMENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface DbShape {
  users: User[];
  tournaments: Tournament[];
}

let state: DbShape = { users: [], tournaments: [] };
let tail: Promise<unknown> = Promise.resolve();

function purgeExpiredTournaments(): number {
  const cutoff = Date.now() - TOURNAMENT_TTL_MS;
  const before = state.tournaments.length;
  state.tournaments = state.tournaments.filter((t) => {
    const created = new Date(t.createdAt).getTime();
    return created > cutoff;
  });
  return before - state.tournaments.length;
}

export async function initDb(): Promise<void> {
  try {
    state = JSON.parse(await fs.readFile(config.dataFile, 'utf8')) as DbShape;
    if (!Array.isArray(state.tournaments)) throw new Error('format invalide');
    if (!Array.isArray(state.users)) state.users = [];
    const purged = purgeExpiredTournaments();
    if (purged > 0) {
      await persist();
      logger.info({ purged }, 'Tournois expirés supprimés au démarrage');
    }
    logger.info({ file: config.dataFile }, 'Base JSON chargée');
  } catch {
    state = { users: [], tournaments: [] };
    await persist();
    logger.info({ file: config.dataFile }, 'Nouvelle base JSON créée');
  }
}

// ── Users ──

export function listUsers(): User[] {
  return [...state.users];
}

export function findUserByEmail(email: string): User | undefined {
  return state.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
}

export function findUserById(id: string): User | undefined {
  return state.users.find((u) => u.id === id);
}

export function insertUser(u: User): void {
  state.users.push(u);
}

export function updateUser(u: User): void {
  const i = state.users.findIndex((x) => x.id === u.id);
  if (i >= 0) state.users[i] = u;
}

export function deleteUser(id: string): boolean {
  const before = state.users.length;
  state.users = state.users.filter((u) => u.id !== id);
  return state.users.length < before;
}

async function writeSnapshot(): Promise<void> {
  await fs.mkdir(path.dirname(config.dataFile), { recursive: true });
  const tmp = `${config.dataFile}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
  await fs.rename(tmp, config.dataFile);
}

/** Écritures sérialisées (file d'attente) + renommage atomique — jamais d'écriture concurrente. */
export async function persist(): Promise<void> {
  const run = writeSnapshot();
  tail = tail.then(
    () => run,
    () => run,
  );
  try {
    await run;
  } catch (err) {
    logger.error({ err }, 'Échec de la persistance JSON');
    throw err;
  }
}

export interface TournamentSummary {
  id: string;
  name: string;
  type: Tournament['type'];
  createdAt: string;
  playerCount: number;
  expiresAt: string;
}

export function listTournaments(): Tournament[] {
  return [...state.tournaments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function tournamentSummary(t: Tournament): TournamentSummary {
  return {
    id: t.id,
    name: t.name,
    type: t.type,
    createdAt: t.createdAt,
    playerCount: t.players.length,
    expiresAt: new Date(new Date(t.createdAt).getTime() + TOURNAMENT_TTL_MS).toISOString(),
  };
}

export function findTournament(id: string): Tournament | undefined {
  return state.tournaments.find((t) => t.id === id);
}

export async function upsertTournament(t: Tournament): Promise<void> {
  const i = state.tournaments.findIndex((x) => x.id === t.id);
  if (i >= 0) state.tournaments[i] = t;
  else state.tournaments.push(t);
  await persist();
}

export async function deleteTournament(id: string): Promise<boolean> {
  const before = state.tournaments.length;
  state.tournaments = state.tournaments.filter((t) => t.id !== id);
  if (state.tournaments.length === before) return false;
  await persist();
  return true;
}

export function listPendingTournaments(): Tournament[] {
  return state.tournaments.filter((t) => t.status === 'pending');
}
