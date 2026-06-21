export interface GameConfig {
  gridSize: number; // N -> NxN boxes
  sheetCount: number; // count of unique numbers on the sheet
  numberMin: number;
  numberMax: number;
  fillRateMs: number; // ms per box while holding
  reconnectGraceMs: number;
  iceTimeoutMs: number; // fall back to relay after this
}

export const DEFAULT_CONFIG: GameConfig = {
  gridSize: 10,
  sheetCount: 30,
  numberMin: 1,
  numberMax: 99,
  fillRateMs: 400,
  reconnectGraceMs: 15000,
  iceTimeoutMs: 8000,
};

export function totalBoxes(config: GameConfig): number {
  return config.gridSize * config.gridSize;
}

export type Role = 'host' | 'guest';

export interface SheetNumber {
  /** stable id so circles survive re-renders */
  id: number;
  value: number;
  /** normalized position in [0,1], pre-flip (flip is a render concern) */
  x: number;
  y: number;
  /** font rotation in degrees for hand-drawn feel */
  rot: number;
  circled: boolean;
}

export interface Sheet {
  seed: number;
  numbers: SheetNumber[];
}

export type Phase = 'lobby' | 'playing' | 'over';

export interface GameState {
  config: GameConfig;
  phase: Phase;
  sheet: Sheet;
  /** boxes filled per role, 0..totalBoxes */
  filled: Record<Role, number>;
  /** whose turn it is to CALL */
  caller: Role;
  /** the number currently called this round, or null between rounds */
  activeNumber: number | null;
  /** host-time ms when the active number was called */
  callTime: number | null;
  /** accumulated active fill time for the caller this round (ms) */
  heldMs: number;
  /** host-time ms when the current hold began, or null if not holding */
  holdStart: number | null;
  winner: Role | null;
}

// ---- Authoritative engine events (all timestamps in HOST time) ----

export type GameEvent =
  | { type: 'START'; firstCaller: Role; sheet: Sheet; config: GameConfig }
  | { type: 'CALL'; number: number; callTime: number }
  | { type: 'HOLD_START'; tStart: number }
  | { type: 'HOLD_END'; tEnd: number }
  | { type: 'BELL'; bellTime: number }
  | { type: 'NEW_SHEET'; sheet: Sheet }
  | { type: 'RESET' };

/** Active fill time accumulated for the round, given an evaluation timestamp. */
export function activeFillMs(state: GameState, atTime: number): number {
  const open = state.holdStart !== null ? Math.max(0, atTime - state.holdStart) : 0;
  return state.heldMs + open;
}
