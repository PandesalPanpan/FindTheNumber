import {
  activeFillMs,
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
        heldMs: 0,
        holdStart: null,
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
        heldMs: 0,
        holdStart: null,
      };
    }

    case 'HOLD_START': {
      if (state.activeNumber === null || state.holdStart !== null) return state;
      return { ...state, holdStart: event.tStart };
    }

    case 'HOLD_END': {
      if (state.holdStart === null) return state;
      const add = Math.max(0, event.tEnd - state.holdStart);
      return { ...state, heldMs: state.heldMs + add, holdStart: null };
    }

    case 'BELL': {
      if (state.phase !== 'playing') return state;
      if (state.activeNumber === null || state.callTime === null) return state;

      const activeMs = activeFillMs(state, event.bellTime);
      const earned = boxesForDuration(activeMs, state.config.fillRateMs);
      const cap = totalBoxes(state.config);
      const caller = state.caller;
      const filled = { ...state.filled };
      filled[caller] = Math.min(cap, filled[caller] + earned);

      // circle the found number
      const numbers = state.sheet.numbers.map((n) =>
        n.value === state.activeNumber ? { ...n, circled: true } : n,
      );
      const sheet: Sheet = { ...state.sheet, numbers };

      // win check (instant win possible: filled hit cap)
      if (filled[caller] >= cap) {
        return {
          ...state,
          sheet,
          filled,
          phase: 'over',
          winner: caller,
          activeNumber: null,
          callTime: null,
          heldMs: 0,
          holdStart: null,
        };
      }

      return {
        ...state,
        sheet,
        filled,
        caller: other(caller),
        activeNumber: null,
        callTime: null,
        heldMs: 0,
        holdStart: null,
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
