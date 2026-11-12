import { readFileSync } from 'fs';
import { start } from '@hotmeshio/long-tail';

import { temporalProvider } from './provider';

const DEFAULT_ADMIN = 'superadmin';
const ENV_OWNED_KEYS = ['database', 'server', 'durable', 'workers', 'examples'];

/**
 * Long Tail with Temporal as the durable engine, configured from the environment:
 * TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_UI_URL, DATABASE_URL or POSTGRES_*,
 * PORT, JWT_SECRET, LT_ADMIN_USER / LT_ADMIN_PASSWORD / LT_ADMIN_EMAIL, LT_ROLES.
 * TEMPORAL_API_KEY is optional, for a Temporal deployment that requires one.
 * LT_START_CONFIG optionally names a JSON file with further start() settings.
 */
export async function startLongTailTemporal(env: NodeJS.ProcessEnv = process.env) {
  // 1. Temporal provider
  const namespace = env.TEMPORAL_NAMESPACE ?? 'default';
  const provider = temporalProvider({
    address: required(env, 'TEMPORAL_ADDRESS'),
    namespace,
    apiKey: env.TEMPORAL_API_KEY,
  });

  // 2. Console link: the dashboard fills in only {workflowId}
  const consoleUrl = env.TEMPORAL_UI_URL
    ? `${env.TEMPORAL_UI_URL.replace(/\/+$/, '')}/namespaces/${encodeURIComponent(namespace)}/workflows/{workflowId}`
    : undefined;

  // 3. Long Tail
  return start({
    ...fileConfig(env.LT_START_CONFIG),
    database: env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
      host: env.POSTGRES_HOST, port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : undefined,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB,
    },
    server: { port: env.PORT ? Number(env.PORT) : undefined },
    ...(env.JWT_SECRET ? { auth: { secret: env.JWT_SECRET } } : {}),
    ...(env.LT_ADMIN_PASSWORD ? { seed: { admin: {
      externalId: env.LT_ADMIN_USER ?? DEFAULT_ADMIN, email: env.LT_ADMIN_EMAIL, password: env.LT_ADMIN_PASSWORD,
    } } } : {}),
    ...(env.LT_ROLES ? { roles: env.LT_ROLES.split(',').map((role) => ({ role: role.trim() })).filter((r) => r.role) } : {}),
    durable: { provider, consoleUrl },
  });
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function fileConfig(path: string | undefined): Record<string, unknown> {
  if (!path) return {};
  const parsed = JSON.parse(readFileSync(path, 'utf-8'));
  for (const key of ENV_OWNED_KEYS) {
    if (key in parsed) throw new Error(`LT_START_CONFIG may not set "${key}"; it is set by environment or not allowed with Temporal`);
  }
  return parsed;
}

if (require.main === module) {
  startLongTailTemporal().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
