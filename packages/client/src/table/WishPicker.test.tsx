import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Rank } from '@tichu/shared';
import { WishPicker } from './WishPicker';

describe('WishPicker', () => {
  it('calls onChoose with the selected rank', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<WishPicker onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: 'K' }));
    expect(onChoose).toHaveBeenCalledWith(Rank.King);
  });

  it('calls onChoose with null when skipped', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<WishPicker onChoose={onChoose} />);

    await user.click(screen.getByRole('button', { name: '선택 안 함' }));
    expect(onChoose).toHaveBeenCalledWith(null);
  });
});
