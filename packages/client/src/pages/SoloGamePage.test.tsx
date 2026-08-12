import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { InferenceSession } from 'onnxruntime-common';
import { SoloGamePage } from './SoloGamePage';

function stubSession(): InferenceSession {
  return {
    async run(feeds: InferenceSession.FeedsType) {
      const numCandidates = (feeds.action_vectors as { dims: readonly number[] }).dims[0] as number;
      const logits = new Float32Array(numCandidates);
      logits[0] = 1;
      return {
        action_logits: { data: logits } as never,
        state_value: { data: Float32Array.from([0]) } as never,
      };
    },
  } as unknown as InferenceSession;
}

describe('SoloGamePage', () => {
  it('plays through Large Tichu and Exchange into the Playing phase', async () => {
    const user = userEvent.setup();
    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    expect(screen.getByText('그랜드 티츄')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '선언하지 않음' }));
    await waitFor(() => expect(screen.getByText('카드 교환')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
    for (const select of selects) {
      // Query options fresh each iteration: picking a card removes it from
      // the remaining selects' option lists, so this always lands on a
      // still-available, distinct card.
      const options = Array.from((select as HTMLSelectElement).options).filter((o) => o.value !== '');
      await user.selectOptions(select, options[0]!.value);
    }

    await user.click(screen.getByRole('button', { name: '교환 제출' }));

    await waitFor(() => expect(screen.queryByText('카드 교환')).not.toBeInTheDocument());
  }, 10000);

  it('calls onExit when leaving', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<SoloGamePage session={stubSession()} onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: '나가기' }));
    expect(onExit).toHaveBeenCalled();
  });
});
