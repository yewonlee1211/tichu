import { useState } from 'react';

export interface JoinRoomFormProps {
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly onJoin: (roomCode: string, playerName: string) => void;
}

/** An empty room code asks the server to mint a fresh one (create-a-room);
 * a non-empty code joins an existing room -- see `JOIN_ROOM` in
 * `packages/shared/src/protocol.ts`. */
export function JoinRoomForm({ busy, errorMessage, onJoin }: JoinRoomFormProps) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (playerName.trim() === '') return;
    onJoin(roomCode.trim().toUpperCase(), playerName.trim());
  }

  return (
    <form className="join-form" onSubmit={handleSubmit}>
      <h1>사람과 플레이</h1>
      <label>
        이름
        <input
          type="text"
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          maxLength={20}
          required
        />
      </label>
      <label>
        방 코드 (비워두면 새 방 생성)
        <input
          type="text"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value)}
          maxLength={6}
          placeholder="예: AB2CDE"
        />
      </label>
      {errorMessage !== null && (
        <p className="join-form__error" role="alert">
          {errorMessage}
        </p>
      )}
      <button type="submit" disabled={busy || playerName.trim() === ''}>
        {roomCode.trim() === '' ? '방 만들기' : '방 입장'}
      </button>
    </form>
  );
}
