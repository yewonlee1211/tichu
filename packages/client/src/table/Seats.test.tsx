import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Seats } from './Seats';

const seatNames = ['나', 'AI 1', 'AI 2', 'AI 3'];

describe('Seats', () => {
  it('arranges seats bottom(me)/right/top(partner)/left relative to the viewer', () => {
    const { container } = render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={0}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={null}
      />,
    );

    expect(container.querySelector('.seats__seat--bottom')).toHaveTextContent('나');
    expect(container.querySelector('.seats__seat--right')).toHaveTextContent('AI 1');
    expect(container.querySelector('.seats__seat--top')).toHaveTextContent('AI 2');
    expect(container.querySelector('.seats__seat--left')).toHaveTextContent('AI 3');
  });

  it('labels the top seat as the partner and the side seats as the opposing team', () => {
    render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={0}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={null}
      />,
    );

    const partnerSeat = screen.getByText('AI 2').closest('.seats__seat');
    expect(partnerSeat).toHaveTextContent('파트너');
    expect(partnerSeat).toHaveClass('seats__seat--partner');

    const rightOpponent = screen.getByText('AI 1').closest('.seats__seat');
    const leftOpponent = screen.getByText('AI 3').closest('.seats__seat');
    expect(rightOpponent).toHaveTextContent('상대팀');
    expect(leftOpponent).toHaveTextContent('상대팀');
  });

  it('rotates the arrangement to stay relative to a non-zero viewer seat', () => {
    const { container } = render(
      <Seats
        seatNames={seatNames}
        viewerSeat={1}
        currentPlayer={1}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={null}
      />,
    );

    expect(container.querySelector('.seats__seat--bottom')).toHaveTextContent('AI 1');
    expect(container.querySelector('.seats__seat--right')).toHaveTextContent('AI 2');
    expect(container.querySelector('.seats__seat--top')).toHaveTextContent('AI 3');
    expect(container.querySelector('.seats__seat--left')).toHaveTextContent('나');
  });

  it('highlights the current player and shows a Tichu badge above the name', () => {
    render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={2}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, true, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={null}
      />,
    );

    const activeSeat = document.querySelector('.seats__seat--active');
    expect(activeSeat).toHaveTextContent('AI 2');
    expect(screen.getByText('티츄')).toBeInTheDocument();
    expect(screen.getByText('티츄')).toHaveClass('seats__badges');
  });

  it('shows a finish-rank badge, and combines it with the Tichu badge when both apply', () => {
    render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={0}
        handSizes={[0, 5, 5, 5]}
        tichuCalls={[true, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[0]}
        announcement={null}
      />,
    );

    const mySeat = document.querySelector('.seats__seat--bottom');
    expect(mySeat).toHaveTextContent('1위 · 티츄');
  });

  it('omits the badge line entirely when a seat has no rank or Tichu call', () => {
    render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={0}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={null}
      />,
    );

    expect(document.querySelector('.seats__badges')).not.toBeInTheDocument();
  });

  it('renders the action announcement inside the table center, not as a standalone element', () => {
    const { container } = render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={0}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={{ kind: 'play', seat: 1, cards: [], label: '개' }}
      />,
    );

    const center = container.querySelector('.seats__center');
    expect(center).not.toBeNull();
    const banner = center!.querySelector('.action-announcement');
    expect(banner).toHaveTextContent('AI 1');
    expect(banner).toHaveTextContent('개');
  });

  it('renders a trickWon announcement as "<winner> 님이 트릭 획득" / "<next> 님의 차례"', () => {
    const { container } = render(
      <Seats
        seatNames={seatNames}
        viewerSeat={0}
        currentPlayer={1}
        handSizes={[10, 11, 12, 13]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        finishedOrder={[]}
        announcement={{ kind: 'trickWon', winnerSeat: 0, nextSeat: 1 }}
      />,
    );

    const banner = container.querySelector('.seats__center .action-announcement');
    expect(banner).toHaveTextContent('나 님이 트릭 획득');
    expect(banner).toHaveTextContent('AI 1 님의 차례');
  });
});
