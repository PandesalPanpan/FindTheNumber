interface Props {
  iWon: boolean;
  canRestart: boolean;
  seriesMine: number;
  seriesOpp: number;
  onPlayAgain: () => void;
}

export function EndScreen({ iWon, canRestart, seriesMine, seriesOpp, onPlayAgain }: Props) {
  return (
    <div className="overlay" data-testid="end-screen">
      <div className="end-card">
        <h2 className="end-title">{iWon ? '🎉 You win!' : '😖 You lose'}</h2>
        <div className="series-tally" data-testid="series-tally">
          <span className="series-num">{seriesMine}</span>
          <span className="series-label">you</span>
          <span className="series-sep">–</span>
          <span className="series-num">{seriesOpp}</span>
          <span className="series-label">them</span>
        </div>
        {canRestart ? (
          <button className="big-btn create" data-testid="play-again" onClick={onPlayAgain}>
            Play again
          </button>
        ) : (
          <p className="muted">Waiting for host to start a new game…</p>
        )}
      </div>
    </div>
  );
}
