import { useMemo, useState } from 'react';
import { Phase, isGameOver } from '@tichu/shared';
import { useGameSocket } from '../ws/useGameSocket';
import { fromPlayerView } from '../table/TableViewModel';
import { legalCombosForView } from '../table/legalPlay';
import { GameTable } from '../table/GameTable';
import { JoinRoomForm } from './JoinRoomForm';
import { WaitingRoom } from './WaitingRoom';

export interface MultiplayerPageProps {
  readonly wsUrl?: string;
  readonly onExit: () => void;
}

/** Owns the one `useGameSocket` connection for the whole human-vs-human
 * flow, and switches between the join form, the waiting room, and the game
 * table based on what the server has told us -- there is no separate local
 * "screen" state to keep in sync. `socket.view` is null until the server
 * broadcasts the first `STATE_UPDATE`, which only happens once the game has
 * actually started, so `view === null` is itself the accurate "still in the
 * lobby" signal (see `WaitingRoom`'s doc comment for why no seat count is
 * shown before that). */
export function MultiplayerPage({ wsUrl, onExit }: MultiplayerPageProps) {
  const socket = useGameSocket(wsUrl);
  const [exchangeSubmitted, setExchangeSubmitted] = useState(false);

  // Reset the local "submitted, waiting for others" flag during render
  // (React's documented way to adjust state when an external value changes,
  // instead of a useEffect+setState round trip -- see
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes):
  // once whenever the phase leaves Exchange, and once whenever a fresh
  // server error arrives while still in Exchange (a rejected merge means
  // every seat must resubmit -- see `handleExchangeCards` in
  // `packages/server/src/gameServer.ts`).
  const [lastSeenPhase, setLastSeenPhase] = useState(socket.view?.phase);
  if (socket.view?.phase !== lastSeenPhase) {
    setLastSeenPhase(socket.view?.phase);
    if (socket.view?.phase !== Phase.Exchange) setExchangeSubmitted(false);
  }
  const [lastSeenError, setLastSeenError] = useState(socket.error);
  if (socket.error !== lastSeenError) {
    setLastSeenError(socket.error);
    if (socket.error !== null && socket.view?.phase === Phase.Exchange) setExchangeSubmitted(false);
  }

  const legalCombos = useMemo(() => (socket.view === null ? [] : legalCombosForView(socket.view)), [socket.view]);

  function handleLeave(): void {
    socket.leaveRoom();
    onExit();
  }

  if (socket.roomCode === null || socket.seat === null) {
    return (
      <div className="multiplayer-page">
        <JoinRoomForm busy={socket.status === 'connecting'} errorMessage={socket.error} onJoin={socket.joinRoom} />
        <button type="button" onClick={onExit}>
          홈으로
        </button>
      </div>
    );
  }

  if (socket.view === null) {
    return (
      <WaitingRoom
        roomCode={socket.roomCode}
        seat={socket.seat}
        errorMessage={socket.error}
        onStartGame={socket.startGame}
        onLeaveRoom={handleLeave}
      />
    );
  }

  return (
    <div className="multiplayer-page">
      <p className="multiplayer-page__room-code">방 코드: {socket.roomCode}</p>
      <GameTable
        vm={fromPlayerView(socket.view)}
        legalCombos={legalCombos}
        busy={socket.status !== 'open'}
        errorMessage={socket.error}
        exchangeSubmitted={exchangeSubmitted}
        cumulativeScores={socket.view.cumulativeScores}
        matchOver={isGameOver(socket.view.cumulativeScores)}
        onDecideGrandTichu={socket.decideGrandTichu}
        onSubmitExchange={(gifts) => {
          setExchangeSubmitted(true);
          socket.exchangeCards(gifts);
        }}
        onCallTichu={socket.callTichu}
        onPlayCards={(cards, wish, dragonRecipient) =>
          socket.playCards(cards, wish ?? undefined, dragonRecipient ?? undefined)
        }
        onPass={(dragonRecipient) => socket.pass(dragonRecipient ?? undefined)}
      />
      <button type="button" onClick={handleLeave}>
        로비 나가기
      </button>
    </div>
  );
}
