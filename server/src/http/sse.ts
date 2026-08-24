import type { Request, Response } from 'express';

const channels = new Map<string, Set<Response>>();

let heartbeat: NodeJS.Timeout | undefined;

/** GET /api/events/:tournamentId — flux SSE unidirectionnel serveur → spectateurs. */
export function sseHandler(req: Request, res: Response): void {
  const tournamentId = String(req.params.tournamentId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  let set = channels.get(tournamentId);
  if (!set) {
    set = new Set();
    channels.set(tournamentId, set);
  }
  set.add(res);

  req.on('close', () => {
    set?.delete(res);
    if (set && set.size === 0) channels.delete(tournamentId);
  });

  heartbeat ??= setInterval(() => {
    for (const set of channels.values()) {
      for (const res of set) res.write(': hb\n\n');
    }
  }, 25_000);
  heartbeat.unref();
}

export function broadcastUpdate(tournamentId: string): void {
  const set = channels.get(tournamentId);
  if (!set) return;
  for (const res of set) res.write('event: update\ndata: {}\n\n');
}
