import fs from 'node:fs/promises';
import path from 'node:path';
import type { Tournament } from '../domain/types';
import { config } from './config';
import { logger } from './logger';

interface DbShape {
  tournaments: Tournament[];
}

let state: DbShape = { tournaments: [] };
let tail: Promise<unknown> = Promise.resolve();

export async function initDb(): Promise<void> {
  try {
    state = JSON.parse(await fs.readFile(config.dataFile, 'utf8')) as DbShape;
    if (!Array.isArray(state.tournaments)) throw new Error('format invalide');
    logger.info({ file: config.dataFile }, 'Base JSON chargée');
  } catch {
    state = { tournaments: [] };
    await persist();
    logger.info({ file: config.dataFile }, 'Nouvelle base JSON créée');
  }
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
