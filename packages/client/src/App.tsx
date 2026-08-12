import { useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { HomePage } from './pages/HomePage';
import { MultiplayerPage } from './pages/MultiplayerPage';
import { SoloEntryPage } from './pages/SoloEntryPage';
import { SoloGamePage } from './pages/SoloGamePage';

type Screen = { readonly kind: 'home' } | { readonly kind: 'multiplayer' } | { readonly kind: 'solo-entry' } | { readonly kind: 'solo-game'; readonly session: InferenceSession };

export function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'home' });
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
