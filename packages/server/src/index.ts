import { GameServer } from './gameServer';

const port = Number(process.env.PORT ?? 8080);
new GameServer({ port });
