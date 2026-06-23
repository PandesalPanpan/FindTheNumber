import {
  GameEvent,
  GameState,
  Role,
  Sheet,
  totalBoxes,
} from './types.js';
import { boxesForDuration } from './scoring.js';

export function other(role: Role): Role {
  return role === 'host' ? 'guest' : 'host';
}

function allCircled(sheet: Sheet): boolean {
  return sheet.numbers.every((n) => n.circled);
}

/**
 * Pure authoritative reducer. All timestamps are HOST time. The host runs this;
 * the guest receives resulting snapshots and may also run it for prediction.
 */
export function applyEvent(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'START': {
      return {
        config: event.config,
        phase: 'playing',
        sheet: event.sheet,
        filled: { host: 0, guest: 0 },
        caller: event.firstCaller,
        activeNumber: null,
        callTime: null,
        roundFilled: 0,
        winner: null,
      };
    }

    case 'CALL': {
      if (state.phase !== 'playing') return state;
      if (state.activeNumber !== null) return state; // round already active
      const target = state.sheet.numbers.find(
        (n) => n.value === event.number && !n.circled,
      );
      if (!target) return state; // not on sheet or already circled
      return {
        ...state,
        activeNumber: event.number,
        callTime: event.callTime,
        roundFilled: 0,
      };
    }

    case 'CELL_FILL': {
      if (state.phase !== 'playing') return state;
      if (state.activeNumber === null || state.callTime === null) return state;

      const cap = totalBoxes(state.config);
      const caller = state.caller;
      if (state.filled[caller] >= cap) return state;

      // trust-but-cap: the caller can never bank more boxes this round than the
      // elapsed time budget allows. Latency only delays event.t, never inflates
      // the budget, so a slow/clumsy caller falls short but no one can cheat.
      const budget = boxesForDuration(event.t - state.callTime, state.config.fillRateMs);
      if (state.roundFilled + 1 > budget) return state; // too fast — reject

      const filled = { ...state.filled };
      filled[caller] = Math.min(cap, filled[caller] + 1);

      // instant win the moment the grid is full, mid-search
      if (filled[caller] >= cap) {
        return {
          ...state,
          filled,
          roundFilled: state.roundFilled + 1,
          phase: 'over',
          winner: caller,
          activeNumber: null,
          callTime: null,
        };
      }

      return { ...state, filled, roundFilled: state.roundFilled + 1 };
    }

    case 'BELL': {
      if (state.phase !== 'playing') return state;
      if (state.activeNumber === null || state.callTime === null) return state;

      // boxes were already banked live per-cell; the bell just ends the round.
      const caller = state.caller;

      // circle the found number
      const numbers = state.sheet.numbers.map((n) =>
        n.value === state.activeNumber ? { ...n, circled: true } : n,
      );
      const sheet: Sheet = { ...state.sheet, numbers };

      return {
        ...state,
        sheet,
        caller: other(caller),
        activeNumber: null,
        callTime: null,
        roundFilled: 0,
      };
    }

    case 'NEW_SHEET': {
      return { ...state, sheet: event.sheet };
    }

    case 'RESET': {
      return { ...state, phase: 'lobby', winner: null };
    }

    default:
      return state;
  }
}

/** True when the sheet is exhausted and the host should issue NEW_SHEET. */
export function needsNewSheet(state: GameState): boolean {
  return state.phase === 'playing' && allCircled(state.sheet);
}
