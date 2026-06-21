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
  const [copied, setCopied] = useState(false);
  const roomParam = new URLSearchParams(location.search).get('room') ?? undefined;

  // auto-join when arriving via a shared ?room= link
  useEffect(() => {
    if (roomParam && g.status === 'idle') g.joinRoom(roomParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (g.status === 'idle') {
    return <Lobby onCreate={g.createRoom} onJoin={g.joinRoom} error={g.error} initialCode={roomParam} />;
  }

  if (g.status === 'connecting') {
    return <Centered>Connecting…</Centered>;
  }

  if (g.status === 'waiting') {
    const link = `${location.origin}${location.pathname}?room=${g.roomCode}`;
    const doCopy = () => {
      copyText(link)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {
          /* leave the link visible for manual copy */
        });
    };
    return (
      <div className="lobby" data-testid="waiting">
        <h1 className="title">Waiting for a friend…</h1>
        <p className="tagline">Share this with your opponent</p>
        <button
          type="button"
          className="room-code"
          data-testid="room-code"
          onClick={() => copyText(g.roomCode ?? '')}
          title="Tap to copy the code"
        >
          {g.roomCode}
        </button>
        <button className="big-btn join" onClick={doCopy}>
          {copied ? '✓ Copied!' : 'Copy invite link'}
        </button>
        <p className="muted small link-copy" onClick={doCopy} title="Tap to copy">{link}</p>
      </div>
    );
  }

  if (g.status === 'syncing') {
    return <Centered>Syncing clocks…</Centered>;
  }

  if (g.status === 'reconnecting') {
    return <Centered>Connection lost — reconnecting…</Centered>;
  }

  if (g.status === 'ended') {
    return (
      <Centered>
        <div>
          <p>{g.error ?? 'Game ended.'}</p>
          <button className="big-btn create" onClick={() => location.reload()}>
            Back to menu
          </button>
        </div>
      </Centered>
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
        />
      )}
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="centered" data-testid="status">
      {children}
    </div>
  );
}
