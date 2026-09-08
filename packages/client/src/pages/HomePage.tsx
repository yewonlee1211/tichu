export interface HomePageProps {
  readonly onPlayMultiplayer: () => void;
  readonly onPlaySolo: () => void;
}

// `onPlayMultiplayer` stays part of the props contract (App.tsx still wires
// it and keeps the 'multiplayer' screen/route intact) even though no button
// here calls it -- MVP ships solo-only for now, but multiplayer is meant to
// come back without touching this component's signature again.
export function HomePage({ onPlaySolo }: HomePageProps) {
  return (
    <section className="home" aria-label="티츄 시작 화면">
      <h1>티츄</h1>
      <div className="home__options">
        <button type="button" onClick={onPlaySolo}>
          AI와 연습하기
        </button>
      </div>
    </section>
  );
}
