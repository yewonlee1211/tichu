import type { Room } from '@prisma/client';
import { ok, err, type Result } from '@tichu/shared';
import { prisma } from '../db/client';
import { withDb, type DbError } from '../db/errors';

export interface CreateRoomInput {
  readonly code: string;
  readonly title: string;
  readonly isPublic: boolean;
}

export function createRoom(data: CreateRoomInput): Promise<Result<Room, DbError>> {
  return withDb(() => prisma.room.create({ data }));
}

export function findRoomByCode(code: string): Promise<Result<Room | null, DbError>> {
  return withDb(() => prisma.room.findUnique({ where: { code } }));
}

export interface OpenRoomSummary {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly participantCount: number;
}

/** "Open" = joinable from the room list: public and not currently mid-game
 * (`activeGameId` is the schema's single source of truth for WAITING vs
 * PLAYING -- see `schema.prisma`'s comment on `Room.activeGameId`). */
export async function listOpenRooms(): Promise<Result<readonly OpenRoomSummary[], DbError>> {
  const result = await withDb(() =>
    prisma.room.findMany({
      where: { isPublic: true, activeGameId: null },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { participants: true } } },
    }),
  );
  if (!result.ok) return err(result.error);
  return ok(
    result.value.map((room) => ({
      id: room.id,
      code: room.code,
      title: room.title,
      participantCount: room._count.participants,
    })),
  );
}
