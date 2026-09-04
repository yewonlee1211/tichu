import type { Room } from '@prisma/client';
import { ok, err, type Result } from '@tichu/shared';
import { generateRoomCode } from './room';
import { createRoom as createRoomRow, listOpenRooms as listOpenRoomsRepo, type OpenRoomSummary } from '../repositories/roomRepository';
import { type DbError } from '../db/errors';

const MAX_CODE_ATTEMPTS = 5;

export interface RoomError {
  readonly kind: 'db_error';
  readonly message: string;
}

function fromDbError(error: DbError): RoomError {
  return { kind: 'db_error', message: error.message };
}

export interface CreateRoomInput {
  readonly title: string;
  readonly isPublic: boolean;
}

/** Retries with a freshly generated code on a uniqueness conflict --
 * `generateRoomCode`'s 6-character alphabet makes a collision rare, but not
 * impossible, so a bare single attempt would occasionally fail a room
 * creation for no reason visible to the user. */
export async function createRoom(input: CreateRoomInput): Promise<Result<Room, RoomError>> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const created = await createRoomRow({ code: generateRoomCode(), title: input.title, isPublic: input.isPublic });
    if (created.ok) return ok(created.value);
    if (created.error.kind !== 'conflict') return err(fromDbError(created.error));
  }
  return err({ kind: 'db_error', message: '방 코드를 생성하지 못했습니다. 다시 시도해 주세요.' });
}

export async function listOpenRooms(): Promise<Result<readonly OpenRoomSummary[], RoomError>> {
  const result = await listOpenRoomsRepo();
  if (!result.ok) return err(fromDbError(result.error));
  return ok(result.value);
}
