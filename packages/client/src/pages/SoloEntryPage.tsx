import { useEffect, useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { loadModel } from '../ai/loadModel';
import { createProgressFetch, type DownloadProgress } from '../ai/downloadProgressFetch';

export interface SoloEntryPageProps {
  readonly onReady: (session: InferenceSession) => void;
  readonly onExit: () => void;
}

type LoadState =
  | { readonly status: 'loading'; readonly progress: DownloadProgress }
  | { readonly status: 'error'; readonly message: string; readonly offlineNoCache: boolean };

const INITIAL_PROGRESS: DownloadProgress = { loadedBytes: 0, totalBytes: null };

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** `loadModel()` throws a specific message when nothing is cached yet and
 * there is no network (see `packages/client/src/ai/loadModel.ts`) -- that
 * case gets its own explanation rather than a generic error banner. */
function isOfflineNoCacheError(message: string): boolean {
  return message.includes('network is unavailable');
}

export function SoloEntryPage({ onReady, onExit }: SoloEntryPageProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading', progress: INITIAL_PROGRESS });
  const [attempt, setAttempt] = useState(0);

  // Reset to the loading state during render when a retry starts, rather
  // than as an effect side-effect (see MultiplayerPage.tsx for the same
  // "adjust state from a changed value" pattern).
  const [lastSeenAttempt, setLastSeenAttempt] = useState(attempt);
  if (attempt !== lastSeenAttempt) {
    setLastSeenAttempt(attempt);
    setState({ status: 'loading', progress: INITIAL_PROGRESS });
  }

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const fetchFn = createProgressFetch((progress) => {
          if (!cancelled) setState({ status: 'loading', progress });
        });
        const session = await loadModel({ fetchFn });
        if (!cancelled) onReady(session);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '모델을 불러오지 못했습니다';
        setState({ status: 'error', message, offlineNoCache: isOfflineNoCacheError(message) });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `attempt` is the sole re-run trigger for retry; onReady is a stable page-transition callback.
  }, [attempt]);

  return (
    <section className="solo-entry" aria-label="AI 모델 로딩">
      <h1>AI와 연습하기</h1>

      {state.status === 'loading' && (
        <div className="solo-entry__progress" role="status" aria-live="polite">
          <p>AI 모델을 내려받는 중입니다 (최초 1회만 필요, 이후에는 오프라인에서도 재생 가능합니다)...</p>
          {state.progress.totalBytes !== null ? (
            <>
              <progress value={state.progress.loadedBytes} max={state.progress.totalBytes} />
              <p>
                {formatMb(state.progress.loadedBytes)} / {formatMb(state.progress.totalBytes)}
              </p>
            </>
          ) : (
            <p>{formatMb(state.progress.loadedBytes)} 다운로드됨</p>
          )}
        </div>
      )}

      {state.status === 'error' && (
        <div className="solo-entry__error" role="alert">
          {state.offlineNoCache ? (
            <p>AI 모델을 아직 내려받지 않았습니다. 최초 1회는 온라인 상태에서 접속해야 합니다.</p>
          ) : (
            <p>AI 모델을 불러오지 못했습니다: {state.message}</p>
          )}
          <button type="button" onClick={() => setAttempt((a) => a + 1)}>
            다시 시도
          </button>
        </div>
      )}

      <button type="button" onClick={onExit}>
        나가기
      </button>
    </section>
  );
}
