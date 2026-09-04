import { GameServer } from './transport/gameServer';
import { checkDatabaseConnection } from './db/client';
import { logOperational } from './logger';

const port = Number(process.env.PORT ?? 8080);
const roundOverDisplayMs = process.env.ROUND_OVER_DISPLAY_MS !== undefined ? Number(process.env.ROUND_OVER_DISPLAY_MS) : undefined;

const dbHealth = await checkDatabaseConnection();
if (!dbHealth.ok) {
  logOperational('startup_db_check_failed', { kind: dbHealth.error.kind, message: dbHealth.error.message });
  process.exit(1);
}

new GameServer({ port, roundOverDisplayMs });
