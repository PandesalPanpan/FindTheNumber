interface Props {
  iWon: boolean;
  canRestart: boolean;
  seriesMine: number;
  seriesOpp: number;
  onPlayAgain: () => void;
  onBackToMenu: () => void;
}

export function EndScreen({
  iWon,
  canRestart,
  seriesMine,
  seriesOpp,
  onPlayAgain,
  onBackToMenu,
}: Props) {
  return (
    <div className="overlay" data-testid="end-screen" role="dialog" aria-modal="true" aria-labelledby="end-title">
      <section className="end-card">
        <div className="trophy-mark" aria-hidden="true">🏆</div>
        <span className="eyebrow status-chip success">ROUND COMPLETE</span>
        <h2 className="end-title" id="end-title">{iWon ? 'You win!' : 'You lose'}</h2>
        <p className="result-copy">
          {iWon ? 'You filled the grid first.' : 'Your opponent filled the grid first.'}
        </p>
        <div className="series-card" data-testid="series-tally" aria-label={`Series tally: you ${seriesMine}, them ${seriesOpp}`}>
          <div className="series-player">
            <strong className={`series-num${iWon ? ' winner' : ''}`}>{seriesMine}</strong>
            <span className="series-label">YOU</span>
          </div>
          <span className="series-sep" aria-hidden="true">—</span>
          <div className="series-player">
            <strong className={`series-num${!iWon ? ' winner' : ''}`}>{seriesOpp}</strong>
            <span className="series-label">THEM</span>
          </div>
        </div>
        {canRestart ? (
          <button type="button" className="big-btn create" data-testid="play-again" onClick={onPlayAgain}>
            Play again
          </button>
        ) : (
          <p className="waiting-host" data-testid="waiting-host" role="status" aria-live="polite">
            Waiting for the host to start again…
          </p>
        )}
        <button type="button" className="big-btn menu-button" data-testid="back-to-menu" onClick={onBackToMenu}>
          Back to menu
        </button>
      </section>
    </div>
  );
}
