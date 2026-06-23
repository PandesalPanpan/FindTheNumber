import { useRef, useState } from 'react';
import {
  CONFIG_LIMITS,
  CONFIG_PRESETS,
  DEFAULT_CONFIG,
  GameConfig,
  PresetName,
  normalizeConfig,
} from '@ftn/shared';

interface Props {
  onCreate: (config: Partial<GameConfig>) => void;
  onJoin: (code: string) => void;
  error: string | null;
  initialCode?: string;
}

type RoomSettings = Pick<GameConfig, 'gridSize' | 'sheetCount' | 'fillRateMs'>;

const STORAGE_KEY = 'ftn:roomConfig';

const PRESET_META: { name: PresetName; label: string }[] = [
  { name: 'quick', label: 'Quick' },
  { name: 'normal', label: 'Normal' },
  { name: 'marathon', label: 'Marathon' },
];

/** Seed the form: URL params (used by tests/power users) win, then the last
 *  saved choice, then the Normal preset default. Everything is clamped. */
function initialSettings(): RoomSettings {
  const cfg: GameConfig = normalizeConfig({ ...CONFIG_PRESETS.normal });
  let saved: Partial<GameConfig> = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch {
    /* ignore unreadable storage */
  }
  const p = new URLSearchParams(location.search);
  const fromUrl: Partial<GameConfig> = {};
  const grid = Number(p.get('grid'));
  const rate = Number(p.get('rate'));
  const count = Number(p.get('count'));
  if (grid > 0) fromUrl.gridSize = grid;
  if (rate > 0) fromUrl.fillRateMs = rate;
  if (count > 0) fromUrl.sheetCount = count;

  const merged = normalizeConfig({ ...cfg, ...saved, ...fromUrl });
  return {
    gridSize: merged.gridSize,
    sheetCount: merged.sheetCount,
    fillRateMs: merged.fillRateMs,
  };
}

export function Lobby({ onCreate, onJoin, error, initialCode }: Props) {
  const [code, setCode] = useState(initialCode ?? '');
  const [settings, setSettings] = useState<RoomSettings>(initialSettings);
  const [advanced, setAdvanced] = useState(false);

  const activePreset = PRESET_META.find(
    ({ name }) =>
      CONFIG_PRESETS[name].gridSize === settings.gridSize &&
      CONFIG_PRESETS[name].sheetCount === settings.sheetCount,
  )?.name;

  const applyPreset = (name: PresetName) => {
    const preset = CONFIG_PRESETS[name];
    setSettings((s) =>
      normalizeAndPick({ ...s, gridSize: preset.gridSize!, sheetCount: preset.sheetCount! }),
    );
  };

  const setField = (key: keyof RoomSettings) => (value: number) =>
    setSettings((s) => normalizeAndPick({ ...s, [key]: value }));

  const create = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore unwritable storage */
    }
    onCreate(settings);
  };

  const cells = settings.gridSize * settings.gridSize;

  return (
    <div className="lobby">
      <h1 className="title">Find the Number</h1>
      <p className="tagline">Free 2-player online number-finding race · no install</p>

      <Trailer />

      <div className="room-config" data-testid="room-config">
        <div className="preset-row" role="group" aria-label="Game length">
          {PRESET_META.map(({ name, label }) => (
            <button
              key={name}
              type="button"
              className={`preset${activePreset === name ? ' active' : ''}`}
              data-testid={`preset-${name}`}
              aria-pressed={activePreset === name}
              onClick={() => applyPreset(name)}
            >
              <span className="preset-label">{label}</span>
              <span className="preset-sub">
                {CONFIG_PRESETS[name].gridSize}×{CONFIG_PRESETS[name].gridSize}
              </span>
            </button>
          ))}
        </div>
        <p className="muted small config-summary" data-testid="config-summary">
          {settings.gridSize}×{settings.gridSize} grid · first to fill {cells} cells
        </p>

        <button
          type="button"
          className="advanced-toggle"
          data-testid="advanced-toggle"
          aria-expanded={advanced}
          onClick={() => setAdvanced((a) => !a)}
        >
          {advanced ? '▾' : '▸'} Advanced
        </button>

        {advanced && (
          <div className="advanced" data-testid="advanced">
            <NumberField
              label="Grid size (N×N)"
              testid="grid-size"
              value={settings.gridSize}
              min={CONFIG_LIMITS.gridSize.min}
              max={CONFIG_LIMITS.gridSize.max}
              onChange={setField('gridSize')}
            />
            <NumberField
              label="Numbers on sheet"
              testid="sheet-count"
              value={settings.sheetCount}
              min={CONFIG_LIMITS.sheetCount.min}
              max={Math.min(
                CONFIG_LIMITS.sheetCount.max,
                DEFAULT_CONFIG.numberMax - DEFAULT_CONFIG.numberMin + 1,
              )}
              onChange={setField('sheetCount')}
            />
            <NumberField
              label="Fill speed (ms / cell)"
              testid="fill-rate"
              value={settings.fillRateMs}
              min={CONFIG_LIMITS.fillRateMs.min}
              max={CONFIG_LIMITS.fillRateMs.max}
              step={10}
              onChange={setField('fillRateMs')}
            />
          </div>
        )}
      </div>

      <button className="big-btn create" data-testid="create" onClick={create}>
        Create a game
      </button>

      <div className="divider">or join with a code</div>

      <form
        className="join-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) onJoin(code.trim());
        }}
      >
        <input
          className="code-input"
          data-testid="code-input"
          placeholder="ABCDE"
          maxLength={5}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <button className="big-btn join" data-testid="join" type="submit">
          Join
        </button>
      </form>

      {error && <p className="error" data-testid="error">{error}</p>}

      <section className="how-to" aria-label="How to play">
        <h2>How to play Find the Number</h2>
        <p>
          Find the Number is a fast, free two-player browser game you can play
          with a friend — no download and no signup. Create a game, share the
          room code, and race head-to-head in real time.
        </p>
        <ol>
          <li>On your turn, call a number from the shared flipped paper sheet.</li>
          <li>Your opponent hunts for that number and slaps the bell when found.</li>
          <li>
            While they search, you hold each box to scribble an X. First player
            to fill their whole grid wins the round.
          </li>
        </ol>
      </section>
    </div>
  );
}

/** Autoplaying (muted, looping) gameplay teaser with a one-tap unmute toggle —
 *  browsers only allow muted autoplay, so the chiptune is opt-in. Assets are
 *  generated by `npm run trailer` (tools/record-trailer.mjs). */
function Trailer() {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(true);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    if (!next) void v.play(); // resume in case autoplay paused it
    setMuted(next);
  };

  return (
    <div className="trailer">
      <video
        ref={ref}
        className="trailer-video"
        data-testid="trailer"
        poster="/trailer-poster.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-label="Find the Number gameplay teaser"
      >
        <source src="/trailer.webm" type="video/webm" />
        <source src="/trailer.mp4" type="video/mp4" />
      </video>
      <button
        type="button"
        className="trailer-mute"
        data-testid="trailer-mute"
        aria-pressed={!muted}
        aria-label={muted ? 'Unmute teaser' : 'Mute teaser'}
        onClick={toggle}
      >
        {muted ? '🔇 Tap for sound' : '🔊 Sound on'}
      </button>
    </div>
  );
}

/** Clamp form values to the recommended UI ranges (CONFIG_LIMITS) after an
 *  explicit preset pick or field edit. (The initial URL-param seed deliberately
 *  uses only the wider engine safety bounds so power-user/test values survive.) */
function normalizeAndPick(s: RoomSettings): RoomSettings {
  const span = DEFAULT_CONFIG.numberMax - DEFAULT_CONFIG.numberMin + 1;
  const c = (v: number, lo: number, hi: number) =>
    Math.round(Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo)));
  return {
    gridSize: c(s.gridSize, CONFIG_LIMITS.gridSize.min, CONFIG_LIMITS.gridSize.max),
    sheetCount: c(
      s.sheetCount,
      CONFIG_LIMITS.sheetCount.min,
      Math.min(CONFIG_LIMITS.sheetCount.max, span),
    ),
    fillRateMs: c(s.fillRateMs, CONFIG_LIMITS.fillRateMs.min, CONFIG_LIMITS.fillRateMs.max),
  };
}

interface NumberFieldProps {
  label: string;
  testid: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}

function NumberField({ label, testid, value, min, max, step = 1, onChange }: NumberFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input
        className="field-input"
        data-testid={`adv-${testid}`}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <span className="field-range">
        {min}–{max}
      </span>
    </label>
  );
}
