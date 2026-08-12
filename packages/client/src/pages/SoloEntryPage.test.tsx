import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InferenceSession } from 'onnxruntime-common';
import { SoloEntryPage } from './SoloEntryPage';
import { loadModel } from '../ai/loadModel';

vi.mock('../ai/loadModel', () => ({ loadModel: vi.fn() }));

const loadModelMock = vi.mocked(loadModel);

afterEach(() => {
  vi.unstubAllGlobals();
  loadModelMock.mockReset();
});

describe('SoloEntryPage', () => {
  it('shows a loading state and calls onReady once the model resolves', async () => {
    let resolveLoad!: (session: InferenceSession) => void;
    loadModelMock.mockReturnValue(new Promise<InferenceSession>((resolve) => (resolveLoad = resolve)));
    const onReady = vi.fn();

    render(<SoloEntryPage onReady={onReady} onExit={vi.fn()} />);
    expect(screen.getByText(/AI 모델을 내려받는 중입니다/)).toBeInTheDocument();

    const fakeSession = {} as InferenceSession;
    resolveLoad(fakeSession);
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(fakeSession));
  });

  it('shows the offline-first-run explanation for the specific "not cached yet" error', async () => {
    loadModelMock.mockRejectedValue(
      new Error('AI model is not cached yet and the network is unavailable -- connect once to download it.'),
    );

    render(<SoloEntryPage onReady={vi.fn()} onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('최초 1회는 온라인 상태에서 접속해야 합니다'));
  });

  it('shows a generic error message for other failures, and retries on demand', async () => {
    const user = userEvent.setup();
    loadModelMock.mockRejectedValueOnce(new Error('failed to fetch AI model: HTTP 500'));
    const fakeSession = {} as InferenceSession;
    loadModelMock.mockResolvedValueOnce(fakeSession);
    const onReady = vi.fn();

    render(<SoloEntryPage onReady={onReady} onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('failed to fetch AI model: HTTP 500'));
    await user.click(screen.getByRole('button', { name: '다시 시도' }));

    await waitFor(() => expect(onReady).toHaveBeenCalledWith(fakeSession));
    expect(loadModelMock).toHaveBeenCalledTimes(2);
  });

  it('calls onExit when leaving', async () => {
    const user = userEvent.setup();
    loadModelMock.mockReturnValue(new Promise(() => {}));
    const onExit = vi.fn();

    render(<SoloEntryPage onReady={vi.fn()} onExit={onExit} />);
    await user.click(screen.getByRole('button', { name: '나가기' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('renders live download progress reported through the fetchFn passed to loadModel', async () => {
    const chunk = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(chunk, { status: 200, headers: { 'content-length': '4' } })),
    );
    loadModelMock.mockImplementation(async (options) => {
      await options!.fetchFn!('https://example.test/model.onnx.enc');
      return new Promise(() => {}); // stay loading so the progress render is observable
    });

    render(<SoloEntryPage onReady={vi.fn()} onExit={vi.fn()} />);

    const progressEl = await screen.findByRole<HTMLProgressElement>('progressbar');
    await waitFor(() => expect(progressEl.value).toBe(4));
    expect(progressEl.max).toBe(4);
  });
});
