import { createServer } from 'node:http';
import { createApp } from './http/app';
import { GameServer } from './transport/gameServer';
import { checkDatabaseConnection } from './db/client';
import { logOperational } from './logger';

const port = Number(process.env.PORT ?? 8080);
const roundOverDisplayMs = process.env.ROUND_OVER_DISPLAY_MS !== undefined ? Number(process.env.ROUND_OVER_DISPLAY_MS) : undefined;

if (!process.env.JWT_SECRET) {
  logOperational('startup_jwt_secret_missing');
  process.exit(1);
}

const dbHealth = await checkDatabaseConnection();
if (!dbHealth.ok) {
  logOperational('startup_db_check_failed', { kind: dbHealth.error.kind, message: dbHealth.error.message });
  process.exit(1);
}

const httpServer = createServer(createApp());
new GameServer({ server: httpServer, roundOverDisplayMs });
httpServer.listen(port);
