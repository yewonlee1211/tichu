import { GameServer } from './gameServer';

const port = Number(process.env.PORT ?? 8080);
const roundOverDisplayMs = process.env.ROUND_OVER_DISPLAY_MS !== undefined ? Number(process.env.ROUND_OVER_DISPLAY_MS) : undefined;
new GameServer({ port, roundOverDisplayMs });
