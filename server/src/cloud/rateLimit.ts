import { HttpError } from '../core/errors';

export interface LoginAttemptRecord {
  count: number;
  resetAt: number;
}

export interface LoginRateStore {
  get(key: string): Promise<LoginAttemptRecord | null>;
  put(key: string, value: LoginAttemptRecord, ttlSeconds: number): Promise<void>;
}

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const RECORDED_CAP = 20;

export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'inconnue';
}

function recordKey(ip: string): string {
  return `login-failures:${ip}`;
}

export async function assertLoginAllowed(store: LoginRateStore, ip: string): Promise<void> {
  const rec = await store.get(recordKey(ip));
  if (rec && rec.resetAt > Date.now() && rec.count >= MAX_FAILURES) {
    const minutes = Math.max(1, Math.ceil((rec.resetAt - Date.now()) / 60000));
    throw new HttpError(429, `Trop de tentatives de connexion. Réessayez dans ${minutes} min.`);
  }
}

export async function recordLoginFailure(store: LoginRateStore, ip: string): Promise<void> {
  const key = recordKey(ip);
  const now = Date.now();
  let rec = await store.get(key);
  if (!rec || rec.resetAt <= now) {
    rec = { count: 0, resetAt: now + WINDOW_MS };
  }
  if (rec.count >= RECORDED_CAP) return;
  rec.count += 1;
  const ttlSeconds = Math.max(60, Math.ceil((rec.resetAt - now) / 1000));
  await store.put(key, rec, ttlSeconds);
}

export async function clearLoginFailures(store: LoginRateStore, ip: string): Promise<void> {
  await store.put(recordKey(ip), { count: 0, resetAt: 0 }, 60);
}

/** Repli en mémoire (isolat unique : tests, dev). En prod on injecte un store KV. */
export function memoryLoginRateStore(): LoginRateStore {
  const map = new Map<string, LoginAttemptRecord>();
  return {
    async get(key) {
      const rec = map.get(key);
      if (!rec || rec.resetAt <= Date.now()) return null;
      return rec;
    },
    async put(key, value) {
      if (map.size > 10_000) {
        for (const [k, v] of map) {
          if (v.resetAt <= Date.now()) map.delete(k);
        }
      }
      map.set(key, value);
    },
  };
}
