import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DragonRecipientPicker } from './DragonRecipientPicker';

describe('DragonRecipientPicker', () => {
  it('renders only the given seat options and reports the chosen seat', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(
      <DragonRecipientPicker options={[1, 3]} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} onChoose={onChoose} />,
    );

    expect(screen.queryByRole('button', { name: 'AI 2' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'AI 3' }));
    expect(onChoose).toHaveBeenCalledWith(3);
  });

  it('shows the options in reverse seat order', () => {
    render(
      <DragonRecipientPicker options={[1, 2, 3]} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} onChoose={vi.fn()} />,
    );

    const optionNames = within(screen.getByRole('group')).getAllByRole('button').map((b) => b.textContent);
    expect(optionNames).toEqual(['AI 3', 'AI 2', 'AI 1']);
  });
});
