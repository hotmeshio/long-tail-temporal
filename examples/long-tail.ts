import { api, createClient, start } from '@hotmeshio/long-tail';
import { temporalProvider } from '@hotmeshio/long-tail-temporal/provider';
import type { LongTailClient } from '@hotmeshio/long-tail-temporal/worker';

import machineLine from './machine-line/long-tail.json';
import reviewOrder from './review-order/long-tail.json';

/** The account a worker opens and closes its waits as. */
export interface WorkflowBot {
  name: string;
  roles: { role: string; type: 'admin' | 'member' }[];
}

interface Bot { id: string; external_id: string }

/** The roles and registered workflows every process in the stack declares. */
const SHARED_CONFIG: Record<string, unknown> = {
  roles: [...reviewOrder.roles, ...machineLine.roles],
  workers: [...reviewOrder.workers, ...machineLine.workers],
};

/** Starts Long Tail in this process and returns its client, acting as the bot. */
export async function connectLongTail(bot: WorkflowBot, env: NodeJS.ProcessEnv = process.env): Promise<{ client: LongTailClient }> {
  // 1. Long Tail on its database, with no HTTP server: the dashboard runs in its own container
  await start({
    ...SHARED_CONFIG,
    database: env.DATABASE_URL ? { connectionString: env.DATABASE_URL } : {
      host: env.POSTGRES_HOST, port: env.POSTGRES_PORT ? Number(env.POSTGRES_PORT) : undefined,
      user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB,
    },
    server: { enabled: false },
    ...(env.JWT_SECRET ? { auth: { secret: env.JWT_SECRET } } : {}),
    durable: { provider: temporalProvider({
      address: env.TEMPORAL_ADDRESS ?? 'localhost:7233',
      namespace: env.TEMPORAL_NAMESPACE ?? 'default',
      apiKey: env.TEMPORAL_API_KEY,
    }) },
  });

  // 2. The bot, holding the roles its workflows wait on
  const account = await findOrCreateBot(bot);
  return { client: createClient({ auth: { userId: account.id } }) };
}

async function findOrCreateBot(bot: WorkflowBot): Promise<Bot> {
  const listed = unwrap<{ bots?: Bot[] } | Bot[]>('list bots', await api.botAccounts.listBots({ search: bot.name, limit: 50 }));
  const existing = (Array.isArray(listed) ? listed : listed.bots ?? []).find((b) => b.external_id === bot.name);
  if (!existing) return unwrap<Bot>('create bot', await api.botAccounts.createBot(bot));
  for (const role of bot.roles) unwrap('add bot role', await api.botAccounts.addBotRole({ id: existing.id, ...role }));
  return existing;
}

function unwrap<T>(what: string, result: { status: number; data?: unknown; error?: string }): T {
  if (result.status >= 400) throw new Error(`${what}: ${result.error ?? result.status}`);
  return result.data as T;
}
