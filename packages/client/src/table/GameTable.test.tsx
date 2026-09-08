import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { identifyCombo, Phase, Rank, Suit } from '@tichu/shared';
import type { TableViewModel } from './TableViewModel';
import { GameTable } from './GameTable';

const seatNames = ['나', 'AI 1', 'AI 2', 'AI 3'];

function baseVm(overrides: Partial<TableViewModel>): TableViewModel {
  return {
    viewerSeat: 0,
    hand: [],
    handSizes: [8, 8, 8, 8],
    trickCards: [],
    collectedPoints: [0, 0, 0, 0],
    phase: Phase.Playing,
    currentPlayer: 0,
    trickLeader: 0,
    currentBest: null,
    currentStrength: 0,
    lastPlayerToAct: null,
    finishedOrder: [],
    tichuCalls: [false, false, false, false],
    largeTichuCalls: [null, null, null, null],
    mahjongWish: null,
    passesInARow: 0,
    seatNames,
    dragonRecipientPreDecided: false,
    ...overrides,
  };
}

const noop = {
  onDecideGrandTichu: vi.fn(),
  onSubmitExchange: vi.fn(),
  onCallTichu: vi.fn(),
  onPlayCards: vi.fn(),
  onPass: vi.fn(),
};

describe('GameTable phase routing', () => {
  it('renders the Large Tichu prompt during Phase.LargeTichu', () => {
    render(
      <GameTable
        vm={baseVm({ phase: Phase.LargeTichu, hand: [{ rank: Rank.King, suit: Suit.Sword }] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByText('그랜드 티츄')).toBeInTheDocument();
  });

  it('renders the exchange prompt during Phase.Exchange', () => {
    render(
      <GameTable
        vm={baseVm({ phase: Phase.Exchange, hand: [], tichuCalls: [false, false, false, false] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByText('카드 교환')).toBeInTheDocument();
  });

  it('renders the round-over summary during Phase.RoundOver', () => {
    render(
      <GameTable
        vm={baseVm({ phase: Phase.RoundOver, finishedOrder: [0, 1, 2, 3] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByText('라운드 종료')).toBeInTheDocument();
  });

  it('shows an error banner when errorMessage is set', () => {
    render(
      <GameTable
        vm={baseVm({})}
        legalCombos={[]}
        busy={false}
        errorMessage="방을 찾을 수 없습니다"
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('방을 찾을 수 없습니다');
  });
});

describe('GameTable playing phase interaction', () => {
  it('lets the viewer select cards and submit a legal play', async () => {
    const user = userEvent.setup();
    const onPlayCards = vi.fn();
    const hand = [{ rank: Rank.King, suit: Suit.Sword }];
    const legalCombos = [identifyCombo(hand)!];

    render(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, hand, currentPlayer: 0, viewerSeat: 0, currentBest: null, trickLeader: 0 })}
        legalCombos={legalCombos}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
        onPlayCards={onPlayCards}
      />,
    );

    const submitButton = screen.getByRole('button', { name: '제출' });
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'K⚔' }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(onPlayCards).toHaveBeenCalledWith(hand, null, null);
  });

  it('disables pass for the trick leader (must play, not pass)', () => {
    render(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, currentPlayer: 0, viewerSeat: 0, currentBest: null, trickLeader: 0 })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByRole('button', { name: '패스' })).toBeDisabled();
  });

  it('enables pass when following and a currentBest is set', () => {
    const currentBest = identifyCombo([{ rank: Rank.King, suit: Suit.Sword }]);
    render(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, currentPlayer: 0, viewerSeat: 0, currentBest, trickLeader: 1 })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.getByRole('button', { name: '패스' })).toBeEnabled();
  });

  it('shows a center-screen announcement naming the player, the cards played, and the combo once the view model reflects a play', () => {
    const { rerender } = render(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, currentPlayer: 1, viewerSeat: 0, handSizes: [8, 8, 8, 8] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const kingCombo = identifyCombo([{ rank: Rank.King, suit: Suit.Sword }])!;
    rerender(
      <GameTable
        vm={baseVm({
          phase: Phase.Playing,
          currentPlayer: 2,
          viewerSeat: 0,
          handSizes: [8, 7, 8, 8],
          currentBest: kingCombo,
          lastPlayerToAct: 1,
        })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('AI 1');
    expect(status).toHaveTextContent('싱글 K');
  });

  it('does not show or disturb the announcement when a player merely passes', () => {
    const { rerender } = render(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, currentPlayer: 1, viewerSeat: 0, handSizes: [8, 8, 8, 8] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );

    rerender(
      <GameTable
        vm={baseVm({ phase: Phase.Playing, currentPlayer: 2, viewerSeat: 0, handSizes: [8, 8, 8, 8] })}
        legalCombos={[]}
        busy={false}
        errorMessage={null}
        exchangeSubmitted={false}
        {...noop}
      />,
    );

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
