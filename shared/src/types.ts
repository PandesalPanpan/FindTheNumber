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
  fillRateMs: 120,
  reconnectGraceMs: 15000,
  iceTimeoutMs: 8000,
};

export function totalBoxes(config: GameConfig): number {
  return config.gridSize * config.gridSize;
}

/** Recommended ranges the lobby UI guides hosts toward (presets + inputs). */
export const CONFIG_LIMITS = {
  gridSize: { min: 3, max: 12 },
  sheetCount: { min: 6, max: 90 }, // upper end also capped to the value range
  fillRateMs: { min: 60, max: 400 },
} as const;

/** Hard safety bounds the engine enforces on ANY config (UI, URL params, peers)
 *  so generateSheet/scoring can never crash or hang. Wider than CONFIG_LIMITS:
 *  this is a guardrail, not a UX preference, so deliberate test/power-user
 *  values (e.g. a 2x2 grid or a very slow fill rate) still pass through. */
const SAFETY_LIMITS = {
  gridSize: { min: 2, max: 24 },
  fillRateMs: { min: 1, max: 1_000_000 },
} as const;

/** Named lobby presets. `Normal` is the default (mobile-friendly). */
export const CONFIG_PRESETS = {
  quick: { gridSize: 5, sheetCount: 20 },
  normal: { gridSize: 8, sheetCount: 30 },
  marathon: { gridSize: 10, sheetCount: 30 },
} as const satisfies Record<string, Partial<GameConfig>>;

export type PresetName = keyof typeof CONFIG_PRESETS;
export const DEFAULT_PRESET: PresetName = 'normal';

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Merge a partial override onto DEFAULT_CONFIG and clamp every knob to the hard
 * SAFETY_LIMITS so the sheet generator and scoring can never crash. `sheetCount`
 * is additionally capped to the count of distinct values available in
 * [numberMin, numberMax]. Non-finite inputs fall back to the default. This is a
 * guardrail only — the lobby UI applies the tighter CONFIG_LIMITS for good UX.
 */
export function normalizeConfig(override?: Partial<GameConfig>): GameConfig {
  const cfg: GameConfig = { ...DEFAULT_CONFIG, ...(override ?? {}) };

  const span = cfg.numberMax - cfg.numberMin + 1;
  const num = (v: number, def: number) => (Number.isFinite(v) ? v : def);

  cfg.gridSize = Math.round(
    clamp(num(cfg.gridSize, DEFAULT_CONFIG.gridSize), SAFETY_LIMITS.gridSize.min, SAFETY_LIMITS.gridSize.max),
  );
  cfg.fillRateMs = Math.round(
    clamp(num(cfg.fillRateMs, DEFAULT_CONFIG.fillRateMs), SAFETY_LIMITS.fillRateMs.min, SAFETY_LIMITS.fillRateMs.max),
  );
  cfg.sheetCount = Math.round(
    clamp(num(cfg.sheetCount, DEFAULT_CONFIG.sheetCount), 1, span),
  );

  return cfg;
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
  /** boxes the caller has banked THIS round (reset on each CALL). Each one is a
   *  full per-cell hold; the host caps this at the elapsed time budget so a
   *  caller can never bank faster than floor((now - callTime) / fillRate). */
  roundFilled: number;
  winner: Role | null;
}

// ---- Authoritative engine events (all timestamps in HOST time) ----

export type GameEvent =
  | { type: 'START'; firstCaller: Role; sheet: Sheet; config: GameConfig }
  | { type: 'CALL'; number: number; callTime: number }
  /** caller completed one cell-hold; t is the HOST-time the cell finished inking */
  | { type: 'CELL_FILL'; t: number }
  | { type: 'BELL'; bellTime: number }
  | { type: 'NEW_SHEET'; sheet: Sheet }
  | { type: 'RESET' };
