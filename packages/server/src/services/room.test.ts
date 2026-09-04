import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_LENGTH,
  type Seat,
  createRoom,
  generateRoomCode,
  isRoomEmpty,
  isRoomFull,
  joinRoom,
  leaveRoom,
} from './room';

function seat(playerName: string): Seat {
  return { playerId: playerName, playerName };
}

describe('generateRoomCode', () => {
  it('generates a code of the expected length using only unambiguous characters', () => {
    const code = generateRoomCode();
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
  });
});

describe('joinRoom', () => {
  it('seats four players into an empty room in ascending seat order', () => {
    let room = createRoom('ABCDEF');
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      const result = joinRoom(room, seat(name));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      room = result.value.room;
    }
    expect(isRoomFull(room)).toBe(true);
    expect(room.seats.map((s) => s?.playerName)).toEqual(['alice', 'bob', 'carol', 'dave']);
  });

  it('rejects a fifth player once all four seats are taken', () => {
    let room = createRoom('ABCDEF');
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      const result = joinRoom(room, seat(name));
      if (!result.ok) throw new Error('unreachable');
      room = result.value.room;
    }

    const fifth = joinRoom(room, seat('eve'));

    expect(fifth.ok).toBe(false);
    if (fifth.ok) throw new Error('unreachable');
    expect(fifth.error).toMatch(/full/);
  });
});

describe('leaveRoom', () => {
  it('clears the vacated seat but keeps the room while others remain', () => {
    let room = createRoom('ABCDEF');
    const first = joinRoom(room, seat('alice'));
    if (!first.ok) throw new Error('unreachable');
    room = first.value.room;
    const second = joinRoom(room, seat('bob'));
    if (!second.ok) throw new Error('unreachable');
    room = second.value.room;

    const afterLeave = leaveRoom(room, first.value.seat);

    expect(afterLeave).not.toBeNull();
    expect(afterLeave?.seats[first.value.seat]).toBeNull();
    expect(afterLeave?.seats[second.value.seat]?.playerName).toBe('bob');
  });

  it('signals room deletion by returning null once the last player leaves', () => {
    const room = createRoom('ABCDEF');
    const joined = joinRoom(room, seat('alice'));
    if (!joined.ok) throw new Error('unreachable');
    expect(isRoomEmpty(joined.value.room)).toBe(false);

    const afterLeave = leaveRoom(joined.value.room, joined.value.seat);

    expect(afterLeave).toBeNull();
  });
});
