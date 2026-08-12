export interface HomePageProps {
  readonly onPlayMultiplayer: () => void;
  readonly onPlaySolo: () => void;
}

export function HomePage({ onPlayMultiplayer, onPlaySolo }: HomePageProps) {
  return (
    <section className="home" aria-label="티츄 시작 화면">
      <h1>티츄</h1>
      <div className="home__options">
        <button type="button" onClick={onPlayMultiplayer}>
          사람과 플레이
        </button>
        <button type="button" onClick={onPlaySolo}>
          AI와 연습하기
        </button>
      </div>
    </section>
  );
}
