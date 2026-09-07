import { useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { hasSoloGameSnapshot } from './ai/soloGamePersistence';
import { HomePage } from './pages/HomePage';
import { MultiplayerPage } from './pages/MultiplayerPage';
import { SoloEntryPage } from './pages/SoloEntryPage';
import { SoloGamePage } from './pages/SoloGamePage';

type Screen = { readonly kind: 'home' } | { readonly kind: 'multiplayer' } | { readonly kind: 'solo-entry' } | { readonly kind: 'solo-game'; readonly session: InferenceSession };

/** A page refresh always remounts `App` from scratch, so surviving one is
 * purely a matter of picking the right starting screen -- a saved solo-game
 * snapshot means go straight back into the solo-AI flow (which reloads the
 * model, then `SoloGamePage` itself resumes the snapshot) instead of home. */
function initialScreen(): Screen {
  return hasSoloGameSnapshot() ? { kind: 'solo-entry' } : { kind: 'home' };
}

export function App() {
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const goHome = () => setScreen({ kind: 'home' });

  switch (screen.kind) {
    case 'home':
      return (
        <HomePage
          onPlayMultiplayer={() => setScreen({ kind: 'multiplayer' })}
          onPlaySolo={() => setScreen({ kind: 'solo-entry' })}
        />
      );
    case 'multiplayer':
      return <MultiplayerPage onExit={goHome} />;
    case 'solo-entry':
      return <SoloEntryPage onExit={goHome} onReady={(session) => setScreen({ kind: 'solo-game', session })} />;
    case 'solo-game':
      return <SoloGamePage session={screen.session} onExit={goHome} />;
  }
}
