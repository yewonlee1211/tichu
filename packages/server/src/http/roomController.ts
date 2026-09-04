import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { createRoom, listOpenRooms } from '../services/roomService';
import { requireAccessToken } from './authMiddleware';

const createRoomSchema = z.object({
  title: z.string().min(1).max(64),
  isPublic: z.boolean().optional().default(true),
});

export const roomRouter: Router = Router();

roomRouter.use(requireAccessToken);

roomRouter.post('/', async (req: Request, res: Response) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값을 확인해 주세요.', details: parsed.error.flatten() });
    return;
  }

  const result = await createRoom(parsed.data);
  if (!result.ok) {
    res.status(500).json({ error: result.error.message });
    return;
  }

  const room = result.value;
  res.status(201).json({ room: { id: room.id, code: room.code, title: room.title, isPublic: room.isPublic } });
});

roomRouter.get('/', async (_req: Request, res: Response) => {
  const result = await listOpenRooms();
  if (!result.ok) {
    res.status(500).json({ error: result.error.message });
    return;
  }
  res.status(200).json({ rooms: result.value });
});
