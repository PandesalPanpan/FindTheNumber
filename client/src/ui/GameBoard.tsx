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

  let banner: string;
  if (g.isCaller && g.activeNumber === null) banner = 'YOUR TURN — tap a number to call it';
  else if (g.isCaller && g.activeNumber !== null) banner = '✍️ HOLD each box to scribble an X!';
  else if (g.isSearcher && g.activeNumber === null) banner = 'Opponent is choosing a number…';
  else if (g.bellArmed) banner = 'GOT IT — SLAP THE BELL!';
  else banner = 'FIND it on your sheet…';

  const onPick = (value: number) => {
    if (callerPickingMine) g.callNumber(value);
    else if (searcherHunting) g.clickFind(value);
  };

  return (
    <div className="board" data-testid="board">
      <div className="topbar">
        <span className="pill">Room {g.roomCode}</span>
        <span className={`pill ${g.mode}`}>{g.mode === 'p2p' ? 'P2P' : 'relay'}</span>
        <span className="pill score" data-testid="series">
          {g.seriesMine}<span className="score-sep">–</span>{g.seriesOpp}
        </span>
        <button
          className="pill mute"
          data-testid="mute"
          onClick={g.toggleMute}
          aria-label={g.muted ? 'Unmute' : 'Mute'}
        >
          {g.muted ? '🔇' : '🔊'}
        </button>
      </div>

      <Sheet sheet={s.sheet} onPick={onPick} interactive={sheetInteractive} />

      <Bell
        text={banner}
        number={searcherHunting ? g.activeNumber : null}
        armed={g.bellArmed}
        interactive={searcherHunting}
        onRing={g.ringBell}
      />

      <div className="grids">
        <Grid
          size={size}
          filled={g.myDisplayFill}
          label="You"
          mine
          cells={g.myCells}
          holdingCell={g.holdingCell}
          holdFraction={g.holdFraction}
          canFill={g.canFill}
          onCellDown={g.cellDown}
          onCellUp={g.cellUp}
        />
        <OppProgress filled={g.oppDisplayFill} total={size * size} />
      </div>
    </div>
  );
}

/** The opponent's grid is non-interactive, so on every screen it collapses to a
 *  compact progress bar — freeing the full width for the player's own grid. */
function OppProgress({ filled, total }: { filled: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (filled / total) * 100) : 0;
  return (
    <div className="opp-progress" data-testid="opp-progress">
      <div className="opp-progress-head">
        <span>Opponent</span>
        <span className="opp-count">
          {filled}<span className="opp-count-total">/{total}</span>
        </span>
      </div>
      <div className="opp-bar" role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
        <div className="opp-bar-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
