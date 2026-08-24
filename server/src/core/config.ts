import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..', '..');

function loadDotEnv(file: string): void {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined && value !== '') process.env[key] = value;
  }
}
loadDotEnv(path.join(ROOT_DIR, '.env'));

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  ADMIN_PASSWORD: z.string().min(4).default('admin1234'),
  SESSION_SECRET: z.string().min(8).optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATA_FILE: z.string().min(1).default(path.join(ROOT_DIR, 'data', 'db.json')),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :', JSON.stringify(parsed.error.issues, null, 2));
  process.exit(1);
}

const env = parsed.data;

const sessionSecretGenerated = !env.SESSION_SECRET;
const sessionSecret =
  env.SESSION_SECRET ?? (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');

export const config = {
  port: env.PORT,
  adminPassword: env.ADMIN_PASSWORD,
  adminPasswordIsDefault: env.ADMIN_PASSWORD === 'admin1234',
  sessionSecret,
  sessionSecretGenerated,
  logLevel: env.LOG_LEVEL,
  dataFile: path.resolve(env.DATA_FILE),
};
