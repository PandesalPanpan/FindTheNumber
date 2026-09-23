import { GameView } from '../net/useGame.js';
import { Sheet } from './Sheet.js';
import { Grid } from './Grid.js';
import { Bell } from './Bell.js';

export function GameBoard({ g }: { g: GameView }) {
  const s = g.state!;
  const size = s.config.gridSize;
  const callerPickingMine = g.isCaller && g.activeNumber === null;
  const searcherHunting = g.isSearcher && g.activeNumber !== null;
  const sheetInteractive = callerPickingMine || searcherHunting;

  let state: 'call' | 'fill' | 'waiting' | 'find';
  let bannerTitle: string;
  let bannerText: string;
  if (callerPickingMine) {
    state = 'call';
    bannerTitle = 'YOUR TURN';
    bannerText = 'Choose an upside-down number to call';
  } else if (g.isCaller) {
    state = 'fill';
    bannerTitle = 'FILL YOUR BOXES';
    bannerText = 'HOLD each box until it fills';
  } else if (g.activeNumber === null) {
    state = 'waiting';
    bannerTitle = 'GET READY';
    bannerText = 'Your opponent is choosing a number…';
  } else {
    state = 'find';
    bannerTitle = 'FIND IT';
    bannerText = `Find ${g.activeNumber} on the upside-down sheet`;
  }

  const onPick = (value: number) => {
    if (callerPickingMine) g.callNumber(value);
    else if (searcherHunting) g.clickFind(value);
  };

  let bellText: string;
  if (g.bellArmed && g.activeNumber !== null) bellText = 'SLAP THE BELL NOW';
  else if (searcherHunting) bellText = 'Find the target to arm the bell';
  else if (g.isCaller && g.activeNumber !== null) bellText = 'Hold your boxes while they search';
  else if (g.isCaller) bellText = 'Call a number to start the round';
  else bellText = 'The bell arms when you find the number';

  return (
    <main className="game-page" data-testid="board">
      <div className="board">
        <header className="topbar" aria-label="Match status">
          <span className="pill room-pill">ROOM {g.roomCode}</span>
          <span className={`pill ${g.mode ?? 'relay'}`} data-testid="connection-mode">
            <span className="status-dot" aria-hidden="true" />
            {g.mode === 'p2p' ? 'P2P' : 'RELAY'}
          </span>
          <span className="pill score" data-testid="series" aria-label={`Series score ${g.seriesMine} to ${g.seriesOpp}`}>
            {g.seriesMine}<span className="score-sep">–</span>{g.seriesOpp}
          </span>
          <button
            type="button"
            className="pill mute"
            data-testid="mute"
            onClick={g.toggleMute}
            aria-label={g.muted ? 'Unmute sounds' : 'Mute sounds'}
            aria-pressed={g.muted}
          >
            {g.muted ? '🔇' : '🔊'}
          </button>
        </header>

        <section className={`turn-banner ${state}`} data-testid="banner" aria-label="Your current task" aria-live="polite">
          <strong className="turn-title">{bannerTitle}</strong>
          <span className="turn-copy">
            {searcherHunting ? (
              <>Find <span className="turn-target" data-testid="find-target">{g.activeNumber}</span> on the upside-down sheet</>
            ) : bannerText}
          </span>
        </section>

        <OpponentMiniGrid
          size={size}
          filled={g.oppDisplayFill}
          total={size * size}
        />

        <Sheet
          sheet={s.sheet}
          onPick={onPick}
          interactive={sheetInteractive}
          previewCircledValue={g.bellArmed ? g.activeNumber : null}
        />

        <Bell
          text={bellText}
          number={searcherHunting ? g.activeNumber : null}
          armed={g.bellArmed}
          interactive={searcherHunting}
          onRing={g.ringBell}
        />

        <Grid
          size={size}
          filled={g.myDisplayFill}
          label="YOUR BOXES"
          mine
          cells={g.myCells}
          holdingCell={g.holdingCell}
          holdFraction={g.holdFraction}
          canFill={g.canFill}
          onCellDown={g.cellDown}
          onCellUp={g.cellUp}
        />
      </div>
    </main>
  );
}

/** A small, non-interactive view of the opponent's row-major progress. */
function OpponentMiniGrid({
  size,
  filled,
  total,
}: {
  size: number;
  filled: number;
  total: number;
}) {
  const visibleFilled = Math.min(total, Math.max(0, filled));
  return (
    <section className="opponent-card" data-testid="opp-progress" aria-label="Opponent progress">
      <div className="opponent-copy">
        <span className="section-kicker">OPPONENT</span>
        <strong className="opponent-count">
          {visibleFilled}<span> / {total} boxes</span>
        </strong>
      </div>
      <div
        className="opponent-mini-grid"
        data-testid="opp-grid"
        role="img"
        aria-label={`Opponent grid: ${visibleFilled} of ${total} boxes filled in row order`}
        style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`opponent-mini-cell${i < visibleFilled ? ' filled' : ''}`}
            data-filled={i < visibleFilled}
            aria-hidden="true"
          />
        ))}
      </div>
    </section>
  );
}
