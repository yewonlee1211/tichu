const SEAT_COUNT = 4;
const HOST_SEAT = 0;

export interface WaitingRoomProps {
  readonly roomCode: string;
  readonly seat: number;
  readonly errorMessage: string | null;
  readonly onStartGame: () => void;
  readonly onLeaveRoom: () => void;
}

/** Before `START_GAME`, the server never broadcasts who else has joined
 * (`STATE_UPDATE` only exists once there is a `GameState` -- see
 * `handleJoinRoom` in `packages/server/src/gameServer.ts`), so this can only
 * honestly show what the viewer's own `ROOM_JOINED.seat` implies (at least
 * `seat + 1` players had joined at that moment) rather than a live head
 * count. The seat-0 joiner acts as the de facto host, since seats fill in
 * join order with no separate host concept in the protocol. */
export function WaitingRoom({ roomCode, seat, errorMessage, onStartGame, onLeaveRoom }: WaitingRoomProps) {
  const isHost = seat === HOST_SEAT;

  return (
    <section className="waiting-room" aria-label="대기실">
      <h1>대기실</h1>
      <p className="waiting-room__code">
        방 코드: <strong>{roomCode}</strong>
      </p>
      <p>이 코드를 다른 플레이어에게 공유하세요. 인원이 {SEAT_COUNT}명이 되면 방장이 게임을 시작할 수 있습니다.</p>
      <p>
        내 좌석: {seat}번 (참가 시점 기준 최소 {seat + 1}명 참가 확인됨)
      </p>
      {errorMessage !== null && (
        <p className="waiting-room__error" role="alert">
          {errorMessage}
        </p>
      )}
      {isHost ? (
        <button type="button" onClick={onStartGame}>
          게임 시작
        </button>
      ) : (
        <p className="waiting-room__status">방장(0번 좌석)만 게임을 시작할 수 있습니다.</p>
      )}
      <button type="button" onClick={onLeaveRoom}>
        나가기
      </button>
    </section>
  );
}
