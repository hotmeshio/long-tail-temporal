import { readFileSync } from 'fs';
import { start } from '@hotmeshio/long-tail';

import { temporalProvider } from './provider';

const DEFAULT_ADMIN = 'superadmin';
const ENV_OWNED_KEYS = ['database', 'server', 'durable', 'examples'];
/** Keys several config files add to rather than set. */
const LIST_KEYS = ['workers', 'roles'];

/**
 * Long Tail with Temporal as the durable engine, configured from the environment:
 * TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_UI_URL, DATABASE_URL or POSTGRES_*,
 * PORT, JWT_SECRET, LT_ADMIN_USER / LT_ADMIN_PASSWORD / LT_ADMIN_EMAIL, LT_ROLES.
 * TEMPORAL_API_KEY is optional, for a Temporal deployment that requires one.
 * LT_START_CONFIG optionally names JSON files, comma separated, with further
 * start() settings, such as `workers` entries that register Temporal
 * workflows for invoke and the `roles` they wait on. `workers` and `roles`
 * from every file are combined; any other key may be set by one file only.
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

function fileConfig(paths: string | undefined): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const path of (paths ?? '').split(',').map((p) => p.trim()).filter(Boolean)) {
    for (const [key, value] of Object.entries(readConfigFile(path))) {
      if (LIST_KEYS.includes(key)) {
        if (!Array.isArray(value)) throw new Error(`LT_START_CONFIG ${path}: "${key}" must be an array`);
        merged[key] = [...((merged[key] as unknown[] | undefined) ?? []), ...value];
      } else if (key in merged) {
        throw new Error(`LT_START_CONFIG: "${key}" is set by more than one file`);
      } else {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function readConfigFile(path: string): Record<string, unknown> {
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
