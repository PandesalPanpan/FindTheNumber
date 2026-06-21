import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  activeFillMs,
  applyEvent,
  boxesForDuration,
  DEFAULT_CONFIG,
  GameEvent,
  GameState,
  generateSheet,
  needsNewSheet,
  Role,
  totalBoxes,
} from '@ftn/shared';
import { Signaling } from './signaling.js';
import { Transport, TransportMode } from './transport.js';
import { answerPings, syncClock } from './clock.js';
import { isMuted, setMuted as persistMuted, playBell, playEnd, playScribble } from '../audio.js';

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
  /** exact fractional fill for the caller mid-hold (drives live ink) */
  myFillExact: number;
  /** caller is actively pressing & holding their grid */
  isHolding: boolean;
  oppDisplayFill: number;
  winner: Role | null;
  iWon: boolean;
  seriesMine: number;
  seriesOpp: number;
  muted: boolean;
  toggleMute: () => void;
  // actions
  createRoom: () => void;
  joinRoom: (code: string) => void;
  callNumber: (value: number) => void;
  clickFind: (value: number) => void;
  ringBell: () => void;
  holdStart: () => void;
  holdEnd: () => void;
  playAgain: () => void;
}

function buildConfig() {
  const p = new URLSearchParams(location.search);
  const cfg = { ...DEFAULT_CONFIG };
  const rate = Number(p.get('rate'));
  const grid = Number(p.get('grid'));
  const count = Number(p.get('count'));
  if (rate > 0) cfg.fillRateMs = rate;
  if (grid > 0) cfg.gridSize = grid;
  if (count > 0) cfg.sheetCount = count;
  return cfg;
}

function pickFirstCaller(): Role {
  const f = new URLSearchParams(location.search).get('first');
  if (f === 'host' || f === 'guest') return f;
  return Math.random() < 0.5 ? 'host' : 'guest';
}

function newGameState(firstCaller: Role): GameState {
  const config = buildConfig();
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

  const sig = useRef<Signaling | null>(null);
  const transport = useRef<Transport | null>(null);
  const offset = useRef(0); // guest's offset to host time
  const synced = useRef(false);
  const stateRef = useRef<GameState | null>(null);
  const winTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hostDispatchRef = useRef<((e: GameEvent) => void) | null>(null);
  const clientId = useRef<string | null>(null);
  const wired = useRef(false);
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

  const clearWinTimer = useCallback(() => {
    if (winTimer.current) {
      clearTimeout(winTimer.current);
      winTimer.current = null;
    }
  }, []);

  const scheduleWinTimer = useCallback(() => {
    // host only: if the caller keeps holding, end exactly when they hit the cap
    clearWinTimer();
    const s = stateRef.current;
    if (!s || s.phase !== 'playing' || s.holdStart === null) return;
    const cap = totalBoxes(s.config);
    const remaining = cap - s.filled[s.caller];
    if (remaining <= 0) return;
    const msNeeded = remaining * s.config.fillRateMs - s.heldMs;
    const fireAt = s.holdStart + msNeeded;
    const delay = Math.max(0, fireAt - Date.now());
    winTimer.current = setTimeout(() => {
      hostDispatchRef.current?.({ type: 'BELL', bellTime: fireAt });
    }, delay);
  }, [clearWinTimer]);

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
      if (event.type === 'HOLD_START') scheduleWinTimer();
      if (event.type === 'HOLD_END' || event.type === 'BELL') clearWinTimer();
      if (next.phase === 'over') {
        clearWinTimer();
        setStatus('over');
      }
    },
    [broadcast, scheduleWinTimer, clearWinTimer, setBoth],
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
          setBoth(newGameState(first));
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
            case 'holdStart':
              hostDispatch({ type: 'HOLD_START', tStart: msg.t0 });
              break;
            case 'holdEnd':
              hostDispatch({ type: 'HOLD_END', tEnd: msg.t1 });
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
  const createRoom = useCallback(() => connect('create'), [connect]);
  const joinRoom = useCallback((code: string) => connect('join', code), [connect]);

  const callNumber = useCallback(
    (value: number) => {
      if (isHost) hostDispatch({ type: 'CALL', number: value, callTime: Date.now() });
      else sendTimed({ t: 'call', number: value, callTime: nowHost() });
    },
    [isHost, hostDispatch, sendTimed, nowHost],
  );

  const holdStart = useCallback(() => {
    if (isHost) hostDispatch({ type: 'HOLD_START', tStart: Date.now() });
    else sendTimed({ t: 'holdStart', t0: nowHost() });
  }, [isHost, hostDispatch, sendTimed, nowHost]);

  const holdEnd = useCallback(() => {
    if (isHost) hostDispatch({ type: 'HOLD_END', tEnd: Date.now() });
    else sendTimed({ t: 'holdEnd', t1: nowHost() });
  }, [isHost, hostDispatch, sendTimed, nowHost]);

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
    const first: Role = pickFirstCaller();
    setBoth(newGameState(first));
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

  // animate optimistic fill while I'm the caller and holding
  useEffect(() => {
    const s = state;
    if (!s || s.phase !== 'playing') return;
    if (s.caller !== role || s.holdStart === null) return;
    let raf = 0;
    const loop = () => {
      forceTick((n) => n + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, role]);

  useEffect(() => {
    return () => {
      transport.current?.destroy();
      sig.current?.close();
      clearWinTimer();
    };
  }, [clearWinTimer]);

  // ---------- derived view ----------
  const view = useMemo<GameView>(() => {
    const me = role;
    const s = state;
    const isCaller = !!s && s.caller === me && s.phase === 'playing';
    const isSearcher = !!s && s.caller !== me && s.phase === 'playing';
    const cap = s ? totalBoxes(s.config) : 0;

    let myDisplayFill = s && me ? s.filled[me] : 0;
    let myFillExact = myDisplayFill;
    const oppRole: Role | null = me ? (me === 'host' ? 'guest' : 'host') : null;
    const oppDisplayFill = s && oppRole ? s.filled[oppRole] : 0;

    // optimistic preview for the caller mid-hold (integer for the count,
    // fractional for the live ink on the next box)
    if (s && me && isCaller && s.activeNumber !== null) {
      const ms = activeFillMs(s, nowHost());
      myDisplayFill = Math.min(cap, s.filled[me] + boxesForDuration(ms, s.config.fillRateMs));
      myFillExact = Math.min(cap, s.filled[me] + ms / s.config.fillRateMs);
    }
    const isHolding = !!s && isCaller && s.holdStart !== null;

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
      myFillExact,
      isHolding,
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
      holdStart,
      holdEnd,
      playAgain,
    };
    // forceTick drives re-eval of the optimistic preview each frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    status, error, role, roomCode, mode, state, bellArmed, nowHost, tick, series, muted,
    createRoom, joinRoom, callNumber, clickFind, ringBell, holdStart, holdEnd, playAgain, toggleMute,
  ]);

  // scribble SFX + haptic: fire once per box committed while the caller holds
  const prevFill = useRef(0);
  useEffect(() => {
    const f = view.myDisplayFill;
    if (view.isHolding && f > prevFill.current && !muted) {
      playScribble();
      try {
        navigator.vibrate?.(12);
      } catch {
        /* haptics best-effort */
      }
    }
    prevFill.current = f;
  }, [view.myDisplayFill, view.isHolding, muted]);

  return view;
}
