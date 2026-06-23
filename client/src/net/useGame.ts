import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEvent,
  DEFAULT_CONFIG,
  GameConfig,
  GameEvent,
  GameState,
  generateSheet,
  needsNewSheet,
  normalizeConfig,
  Role,
  totalBoxes,
} from '@ftn/shared';
import { Signaling } from './signaling.js';
import { Transport, TransportMode } from './transport.js';
import { answerPings, syncClock } from './clock.js';
import {
  isMuted,
  setMuted as persistMuted,
  playBell,
  playEnd,
  playFind,
  playScribble,
  playYourTurn,
} from '../audio.js';

export type Status =
  | 'idle'
  | 'connecting'
  | 'waiting' // host waiting for guest
  | 'syncing' // transport open, clock sync in progress
  | 'playing'
  | 'over'
  | 'reconnecting'
  | 'ended'; // peer left for good / fatal

export interface GameView {
  status: Status;
  error: string | null;
  role: Role | null;
  roomCode: string | null;
  mode: TransportMode | null;
  state: GameState | null;
  me: Role | null;
  isCaller: boolean;
  isSearcher: boolean;
  activeNumber: number | null;
  bellArmed: boolean;
  myDisplayFill: number;
  /** set of box indices the caller has X'd in (their own grid only) */
  myCells: Set<number>;
  /** box index currently being held, or null */
  holdingCell: number | null;
  /** ink-in progress [0,1] of the held cell (0 once committed/idle) */
  holdFraction: number;
  /** true while it's the caller's turn to fill (number is active) */
  canFill: boolean;
  oppDisplayFill: number;
  winner: Role | null;
  iWon: boolean;
  seriesMine: number;
  seriesOpp: number;
  muted: boolean;
  toggleMute: () => void;
  // actions
  createRoom: (config?: Partial<GameConfig>) => void;
  joinRoom: (code: string) => void;
  callNumber: (value: number) => void;
  clickFind: (value: number) => void;
  ringBell: () => void;
  cellDown: (index: number) => void;
  cellUp: () => void;
  playAgain: () => void;
}

function buildConfig(override?: Partial<GameConfig>): GameConfig {
  const p = new URLSearchParams(location.search);
  const fromUrl: Partial<GameConfig> = {};
  const rate = Number(p.get('rate'));
  const grid = Number(p.get('grid'));
  const count = Number(p.get('count'));
  if (rate > 0) fromUrl.fillRateMs = rate;
  if (grid > 0) fromUrl.gridSize = grid;
  if (count > 0) fromUrl.sheetCount = count;
  // host's lobby choice wins over URL params; both are clamped to safe ranges
  return normalizeConfig({ ...fromUrl, ...(override ?? {}) });
}

function pickFirstCaller(): Role {
  const f = new URLSearchParams(location.search).get('first');
  if (f === 'host' || f === 'guest') return f;
  return Math.random() < 0.5 ? 'host' : 'guest';
}

function newGameState(firstCaller: Role, override?: Partial<GameConfig>): GameState {
  const config = buildConfig(override);
  const sheet = generateSheet((Math.random() * 1e9) | 0, config);
  return applyEvent({} as GameState, {
    type: 'START',
    firstCaller,
    sheet,
    config,
  });
}

export function useGame(): GameView {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [mode, setMode] = useState<TransportMode | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [bellArmed, setBellArmed] = useState(false);
  const [tick, forceTick] = useState(0);
  const [series, setSeries] = useState<Record<Role, number>>({ host: 0, guest: 0 });
  const [muted, setMutedState] = useState(isMuted());
  const seriesRef = useRef<Record<Role, number>>({ host: 0, guest: 0 });

  // per-cell hold state for the caller's own grid
  const [holdingCell, setHoldingCell] = useState<number | null>(null);
  const holdCellStart = useRef(0); // host-time the current cell-hold began
  const myCells = useRef<Set<number>>(new Set()); // box indices I've X'd in

  const sig = useRef<Signaling | null>(null);
  const transport = useRef<Transport | null>(null);
  const offset = useRef(0); // guest's offset to host time
  const synced = useRef(false);
  const stateRef = useRef<GameState | null>(null);
  const hostDispatchRef = useRef<((e: GameEvent) => void) | null>(null);
  const clientId = useRef<string | null>(null);
  const wired = useRef(false);
  // host's chosen game config (from the lobby), persisted across rematches
  const chosenConfig = useRef<Partial<GameConfig> | null>(null);
  const isHost = role === 'host';

  const nowHost = useCallback(
    () => (isHost ? Date.now() : Date.now() + offset.current),
    [isHost],
  );

  const setBoth = useCallback((s: GameState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  // ---------- HOST: authoritative dispatch ----------
  const broadcast = useCallback(() => {
    if (stateRef.current) {
      transport.current?.send({ t: 'state', state: stateRef.current, series: seriesRef.current });
    }
  }, []);

  const hostDispatch = useCallback(
    (event: GameEvent) => {
      const cur = stateRef.current;
      if (!cur) return;
      let next = applyEvent(cur, event);
      // auto-refresh the sheet when exhausted
      if (needsNewSheet(next)) {
        next = applyEvent(next, {
          type: 'NEW_SHEET',
          sheet: generateSheet((Math.random() * 1e9) | 0, next.config),
        });
      }
      // tally the series once, on the transition into 'over'
      const justWon = next.phase === 'over' && cur.phase !== 'over' && next.winner;
      if (justWon) {
        seriesRef.current = {
          ...seriesRef.current,
          [next.winner!]: seriesRef.current[next.winner!] + 1,
        };
        setSeries(seriesRef.current);
      }
      setBoth(next);
      broadcast(); // includes the updated series
      if (next.phase === 'over') setStatus('over');
    },
    [broadcast, setBoth],
  );
  hostDispatchRef.current = hostDispatch;

  // ---------- wire a transport (host or guest) ----------
  const wireTransport = useCallback(
    (t: Transport, myRole: Role) => {
      transport.current = t;

      t.onOpen(async (m) => {
        setMode(m);
        if (myRole === 'host') {
          answerPings(t); // serve guest clock sync
          // start the match
          const first: Role = pickFirstCaller();
          setBoth(newGameState(first, chosenConfig.current ?? undefined));
          broadcast();
          setStatus('playing');
        } else {
          setStatus('syncing');
          offset.current = await syncClock(t);
          synced.current = true;
          setStatus(stateRef.current && stateRef.current.phase !== 'over' ? 'playing' : (stateRef.current?.phase === 'over' ? 'over' : 'syncing'));
        }
      });

      t.onMessage((msg) => {
        if (myRole === 'host') {
          switch (msg.t) {
            case 'call':
              hostDispatch({ type: 'CALL', number: msg.number, callTime: msg.callTime });
              break;
            case 'cellFill':
              hostDispatch({ type: 'CELL_FILL', t: msg.at });
              break;
            case 'bell':
              hostDispatch({ type: 'BELL', bellTime: msg.bellTime });
              break;
          }
        } else {
          if (msg.t === 'state') {
            const gs = msg.state as GameState;
            setBoth(gs);
            if (msg.series) {
              seriesRef.current = msg.series;
              setSeries(msg.series);
            }
            // stay on 'syncing' until clock sync resolves; then 'playing'
            setStatus(gs.phase === 'over' ? 'over' : synced.current ? 'playing' : 'syncing');
          }
        }
      });

      t.start();
    },
    [broadcast, hostDispatch, setBoth],
  );

  // ---------- signaling lifecycle ----------
  const connect = useCallback(
    (kind: 'create' | 'join', code?: string) => {
      setError(null);
      setStatus('connecting');
      const qp = new URLSearchParams(location.search);
      const forceRelay = qp.get('transport') === 'relay';
      const relayDelayMs = Number(qp.get('relayDelay')) || 0;
      const s = new Signaling();
      sig.current = s;

      s.on('joined', (m) => {
        setRole(m.role);
        setRoomCode(m.room);
        clientId.current = m.clientId;
        if (m.role === 'host') setStatus('waiting');
        const t = new Transport(s, m.role, {
          iceTimeoutMs: DEFAULT_CONFIG.iceTimeoutMs,
          forceRelay,
          relayDelayMs,
        });
        // host waits for guest before starting; guest starts immediately
        if (m.role === 'guest') {
          wired.current = true;
          wireTransport(t, 'guest');
        } else {
          transport.current = t;
          s.on('peer-joined', () => {
            if (wired.current) return;
            wired.current = true;
            wireTransport(t, 'host');
          });
        }
      });

      s.on('error', (m) => {
        setError(m.error ?? 'error');
        setStatus('idle');
      });

      s.on('peer-dropped', () => setStatus((p) => (p === 'over' ? p : 'reconnecting')));
      s.on('peer-reconnected', () => setStatus((p) => (p === 'over' ? p : 'playing')));
      s.on('peer-left', () => {
        setStatus('ended');
        setError('Opponent left the game.');
      });

      s.waitOpen()
        .then(() => {
          if (kind === 'create') s.create();
          else s.join((code ?? '').toUpperCase());
        })
        .catch(() => {
          setError('Cannot reach server.');
          setStatus('idle');
        });
    },
    [wireTransport],
  );

  // ---------- guest-side timestamped send ----------
  const sendTimed = useCallback(
    (msg: any) => transport.current?.send(msg),
    [],
  );

  // ---------- actions ----------
  const createRoom = useCallback(
    (config?: Partial<GameConfig>) => {
      chosenConfig.current = config ?? null;
      connect('create');
    },
    [connect],
  );
  const joinRoom = useCallback((code: string) => connect('join', code), [connect]);

  const callNumber = useCallback(
    (value: number) => {
      if (isHost) hostDispatch({ type: 'CALL', number: value, callTime: Date.now() });
      else sendTimed({ t: 'call', number: value, callTime: nowHost() });
    },
    [isHost, hostDispatch, sendTimed, nowHost],
  );

  // commit one fully-held cell: bank it optimistically + tell the host
  const commitCell = useCallback(
    (index: number, tDone: number) => {
      if (myCells.current.has(index)) return;
      myCells.current.add(index);
      if (isHost) hostDispatch({ type: 'CELL_FILL', t: tDone });
      else sendTimed({ t: 'cellFill', at: tDone });
      if (!isMuted()) {
        playScribble();
        try {
          navigator.vibrate?.(12);
        } catch {
          /* haptics best-effort */
        }
      }
      forceTick((n) => n + 1);
    },
    [isHost, hostDispatch, sendTimed],
  );

  const cellDown = useCallback(
    (index: number) => {
      const s = stateRef.current;
      if (!s || s.phase !== 'playing' || s.caller !== role || s.activeNumber === null) return;
      if (myCells.current.has(index)) return; // already filled
      holdCellStart.current = nowHost();
      setHoldingCell(index);
    },
    [role, nowHost],
  );

  const cellUp = useCallback(() => {
    setHoldingCell(null);
  }, []);

  const clickFind = useCallback(
    (value: number) => {
      const s = stateRef.current;
      if (!s || s.activeNumber === null) return;
      if (value === s.activeNumber) setBellArmed(true);
      else forceTick((n) => n + 1); // wrong: shake handled by UI via this nudge
    },
    [],
  );

  const ringBell = useCallback(() => {
    if (!bellArmed) return;
    setBellArmed(false);
    if (isHost) hostDispatch({ type: 'BELL', bellTime: Date.now() });
    else sendTimed({ t: 'bell', bellTime: nowHost() });
  }, [bellArmed, isHost, hostDispatch, sendTimed, nowHost]);

  const playAgain = useCallback(() => {
    if (!isHost) return;
    myCells.current = new Set();
    setHoldingCell(null);
    const first: Role = pickFirstCaller();
    setBoth(newGameState(first, chosenConfig.current ?? undefined));
    broadcast();
    setStatus('playing');
  }, [isHost, setBoth, broadcast]);

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      const nm = !m;
      persistMuted(nm);
      return nm;
    });
  }, []);

  // reset bell arm at the start of each round
  useEffect(() => {
    if (state?.activeNumber === null) setBellArmed(false);
  }, [state?.activeNumber]);

  // bell SFX: play when a round resolves (active number clears) — both players
  const prevActive = useRef<number | null>(null);
  useEffect(() => {
    const a = state?.activeNumber ?? null;
    if (prevActive.current !== null && a === null) playBell();
    prevActive.current = a;
  }, [state?.activeNumber]);

  // end SFX: play on the transition into 'over'
  const prevPhase = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (state?.phase === 'over' && prevPhase.current !== 'over') {
      playEnd(state.winner === role);
    }
    prevPhase.current = state?.phase;
  }, [state?.phase, state?.winner, role]);

  // per-cell hold loop: animate the held cell inking in, commit when it's full
  useEffect(() => {
    if (holdingCell === null) return;
    const idx = holdingCell;
    if (myCells.current.has(idx)) return; // already committed; nothing to animate
    const rate = state?.config.fillRateMs ?? DEFAULT_CONFIG.fillRateMs;
    let raf = 0;
    const loop = () => {
      if (nowHost() - holdCellStart.current >= rate) {
        // exact completion time keeps the host's budget check latency-immune
        commitCell(idx, holdCellStart.current + rate);
        return; // cell full — stop animating until they lift & press another
      }
      forceTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [holdingCell, state?.config.fillRateMs, nowHost, commitCell]);

  // reconcile my optimistic cell set with the host-authoritative count
  useEffect(() => {
    const me = role;
    if (!state || !me) return;
    const auth = state.filled[me];
    const set = myCells.current;
    if (auth === set.size) return;
    if (auth < set.size) {
      // host rejected some (e.g. too fast) — drop highest-index extras
      const sorted = [...set].sort((a, b) => b - a);
      for (let i = 0; set.size > auth && i < sorted.length; i++) set.delete(sorted[i]);
    } else {
      // fresh state / resync — pad row-major so the count matches
      const total = totalBoxes(state.config);
      for (let i = 0; i < total && set.size < auth; i++) set.add(i);
    }
    forceTick((n) => n + 1);
  }, [state, role]);

  // end any in-progress hold when the round resolves
  useEffect(() => {
    if (state?.activeNumber === null) setHoldingCell(null);
  }, [state?.activeNumber]);

  // turn cues: caller hears "you're up", searcher hears "find it!"
  const wasMyCall = useRef(false);
  const wasMyFind = useRef(false);
  useEffect(() => {
    const s = state;
    const me = role;
    const myCallTurn =
      !!s && !!me && s.phase === 'playing' && s.caller === me && s.activeNumber === null;
    const myFindTurn =
      !!s && !!me && s.phase === 'playing' && s.caller !== me && s.activeNumber !== null;
    if (myCallTurn && !wasMyCall.current) playYourTurn();
    if (myFindTurn && !wasMyFind.current) playFind();
    wasMyCall.current = myCallTurn;
    wasMyFind.current = myFindTurn;
  }, [state?.phase, state?.caller, state?.activeNumber, role, state]);

  useEffect(() => {
    return () => {
      transport.current?.destroy();
      sig.current?.close();
    };
  }, []);

  // ---------- derived view ----------
  const view = useMemo<GameView>(() => {
    const me = role;
    const s = state;
    const isCaller = !!s && s.caller === me && s.phase === 'playing';
    const isSearcher = !!s && s.caller !== me && s.phase === 'playing';
    const cap = s ? totalBoxes(s.config) : 0;

    const oppRole: Role | null = me ? (me === 'host' ? 'guest' : 'host') : null;
    const oppDisplayFill = s && oppRole ? s.filled[oppRole] : 0;

    const canFill = isCaller && !!s && s.activeNumber !== null;
    // own count is the optimistic cell set (reconciled to host authority)
    const myDisplayFill = Math.min(cap, myCells.current.size);

    let holdFraction = 0;
    if (canFill && holdingCell !== null && !myCells.current.has(holdingCell)) {
      const rate = s!.config.fillRateMs;
      holdFraction = Math.min(1, Math.max(0, (nowHost() - holdCellStart.current) / rate));
    }

    return {
      status,
      error,
      role,
      roomCode,
      mode,
      state: s,
      me,
      isCaller,
      isSearcher,
      activeNumber: s?.activeNumber ?? null,
      bellArmed,
      myDisplayFill,
      myCells: myCells.current,
      holdingCell,
      holdFraction,
      canFill,
      oppDisplayFill,
      winner: s?.winner ?? null,
      iWon: !!s && s.winner === me,
      seriesMine: me ? series[me] : 0,
      seriesOpp: oppRole ? series[oppRole] : 0,
      muted,
      toggleMute,
      createRoom,
      joinRoom,
      callNumber,
      clickFind,
      ringBell,
      cellDown,
      cellUp,
      playAgain,
    };
    // forceTick (tick) + holdingCell drive re-eval of the live hold each frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status, error, role, roomCode, mode, state, bellArmed, nowHost, tick, series, muted,
    holdingCell, createRoom, joinRoom, callNumber, clickFind, ringBell, cellDown, cellUp,
    playAgain, toggleMute,
  ]);

  return view;
}
