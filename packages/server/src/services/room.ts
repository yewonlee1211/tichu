import { randomInt } from 'node:crypto';
import { type Result, err, ok } from '@tichu/shared';

export const SEAT_COUNT = 4;
export const ROOM_CODE_LENGTH = 6;

// Excludes 0/O and 1/I/L -- characters players could misread when typing a
// room code back in from a screen or a voice call.
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Seat {
  readonly playerId: string;
  readonly playerName: string;
}

export interface Room {
  readonly code: string;
  readonly seats: readonly (Seat | null)[];
}

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

export function createRoom(code: string): Room {
  return { code, seats: Array.from({ length: SEAT_COUNT }, () => null) };
}

export function isRoomEmpty(room: Room): boolean {
  return room.seats.every((seat) => seat === null);
}

export function isRoomFull(room: Room): boolean {
  return room.seats.every((seat) => seat !== null);
}

/** Seats a player in the first open seat, in ascending seat order. Seats 0/2
 * and 1/3 are opposite each other and form a team (see `PARTNER` in
 * `@tichu/shared`'s gameState.ts) -- filling seats in order therefore seats
 * the first two joiners on opposing teams, then the second two fill out
 * each team, with no separate team-assignment step needed. */
export function joinRoom(room: Room, player: Seat): Result<{ room: Room; seat: number }, string> {
  const seatIndex = room.seats.findIndex((seat) => seat === null);
  if (seatIndex === -1) {
    return err('room is full');
  }
  const seats = [...room.seats];
  seats[seatIndex] = player;
  return ok({ room: { ...room, seats }, seat: seatIndex });
}

/** Clears a seat. Returns `null` instead of a `Room` when that was the last
 * occupied seat, signaling to the caller that the room should be deleted. */
export function leaveRoom(room: Room, seatIndex: number): Room | null {
  const seats = [...room.seats];
  seats[seatIndex] = null;
  const next = { ...room, seats };
  return isRoomEmpty(next) ? null : next;
}
