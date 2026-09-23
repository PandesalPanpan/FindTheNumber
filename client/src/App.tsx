import { useEffect, useState } from 'react';
import { useGame } from './net/useGame.js';
import { Lobby } from './ui/Lobby.js';
import { GameBoard } from './ui/GameBoard.js';
import { EndScreen } from './ui/EndScreen.js';

/** Copy text to the clipboard with a fallback for non-secure origins
 * (LAN IP / plain http), where navigator.clipboard is undefined. */
function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return fallbackCopy(text);
}

function fallbackCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    } catch (e) {
      reject(e);
    }
  });
}

export function App() {
  const g = useGame();
  const [copyFeedback, setCopyFeedback] = useState<'room' | 'invite' | 'failed' | null>(null);
  const roomParam = new URLSearchParams(location.search).get('room') ?? undefined;

  const copyWithFeedback = (value: string, kind: 'room' | 'invite') => {
    copyText(value)
      .then(() => {
        setCopyFeedback(kind);
        window.setTimeout(() => setCopyFeedback(null), 1800);
      })
      .catch(() => setCopyFeedback('failed'));
  };

  const backToMenu = () => {
    const url = new URL(location.href);
    url.searchParams.delete('room');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    location.reload();
  };

  // auto-join when arriving via a shared ?room= link
  useEffect(() => {
    if (roomParam && g.status === 'idle') g.joinRoom(roomParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (g.status === 'idle') {
    return <Lobby onCreate={g.createRoom} onJoin={g.joinRoom} error={g.error} initialCode={roomParam} />;
  }

  if (g.status === 'connecting') {
    return <StatusScreen title="Connecting…" detail="Finding a connection to your table." busy />;
  }

  if (g.status === 'waiting') {
    const link = `${location.origin}${location.pathname}?room=${g.roomCode}`;
    return (
      <main className="waiting-page page-shell" data-testid="waiting">
        <span className="eyebrow status-chip success">ROOM CREATED</span>
        <h1 className="waiting-title">Your table is ready.</h1>
        <p className="waiting-intro">
          Send the code to your friend. The match starts automatically when they join.
        </p>

        <section className="invite-card" aria-labelledby="room-code-label">
          <span id="room-code-label" className="section-kicker">ROOM CODE</span>
          <button
            type="button"
            className="room-code"
            data-testid="room-code"
            onClick={() => copyWithFeedback(g.roomCode ?? '', 'room')}
            aria-label={`Copy room code ${g.roomCode}`}
            title="Tap to copy the code"
          >
            {g.roomCode}
          </button>
          <span className="copy-hint">{copyFeedback === 'room' ? '✓ Code copied' : 'Tap the code to copy'}</span>
        </section>

        <button
          type="button"
          className="big-btn join invite-copy"
          data-testid="copy-invite"
          onClick={() => copyWithFeedback(link, 'invite')}
        >
          {copyFeedback === 'invite' ? '✓ Copied!' : '↗  Copy invite link'}
        </button>

        <label className="manual-link-wrap">
          <span className="visually-hidden">Invite link for manual copying</span>
          <input
            className="manual-link"
            data-testid="invite-link"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
            onClick={(event) => event.currentTarget.select()}
            aria-describedby="copy-feedback"
          />
        </label>
        <p id="copy-feedback" className="copy-feedback" data-testid="copy-feedback" role="status" aria-live="polite">
          {copyFeedback === 'failed'
            ? 'Copy failed. Select the invite link above to copy it.'
            : copyFeedback === 'invite'
              ? 'Invite link copied.'
              : copyFeedback === 'room'
                ? 'Room code copied.'
                : ''}
        </p>

        <p className="waiting-indicator" aria-live="polite">
          <span className="waiting-dots" aria-hidden="true"><i /><i /><i /></span>
          Waiting for opponent…
        </p>
        <aside className="next-card">
          <strong>What happens next?</strong>
          <span>Both players see the same shuffled sheet. One calls a number; the other races to find it and slap the bell.</span>
        </aside>
      </main>
    );
  }

  if (g.status === 'syncing') {
    return <StatusScreen title="Syncing clocks…" detail="Making sure both players share fair timing." busy />;
  }

  if (g.status === 'reconnecting') {
    return <StatusScreen title="Reconnecting…" detail="Your game is trying to restore the connection." busy />;
  }

  if (g.status === 'ended') {
    return (
      <StatusScreen title="Game ended" detail={g.error ?? 'The match has ended.'}>
        <button className="big-btn create" onClick={backToMenu}>Back to menu</button>
      </StatusScreen>
    );
  }

  // playing or over
  return (
    <>
      {g.state && <GameBoard g={g} />}
      {g.status === 'over' && (
        <EndScreen
          iWon={g.iWon}
          canRestart={g.role === 'host'}
          seriesMine={g.seriesMine}
          seriesOpp={g.seriesOpp}
          onPlayAgain={g.playAgain}
          onBackToMenu={backToMenu}
        />
      )}
    </>
  );
}

function StatusScreen({
  title,
  detail,
  busy = false,
  children,
}: {
  title: string;
  detail: string;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <main className="status-page page-shell" data-testid="status" role="status" aria-live="polite">
      {busy && <span className="status-spinner" aria-hidden="true" />}
      <h1>{title}</h1>
      <p>{detail}</p>
      {children}
    </main>
  );
}
