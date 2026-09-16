import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import { announcement } from '../content/announcement';

describe('HomePage', () => {
  it('renders the announcement title and body', () => {
    render(<HomePage onPlayMultiplayer={vi.fn()} onPlaySolo={vi.fn()} />);

    expect(screen.getByRole('heading', { name: announcement.title })).toBeInTheDocument();
    expect(screen.getByText(announcement.body)).toBeInTheDocument();
  });
});
