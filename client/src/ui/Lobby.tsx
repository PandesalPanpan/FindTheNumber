import { useState } from 'react';

interface Props {
  onCreate: () => void;
  onJoin: (code: string) => void;
  error: string | null;
  initialCode?: string;
}

export function Lobby({ onCreate, onJoin, error, initialCode }: Props) {
  const [code, setCode] = useState(initialCode ?? '');

  return (
    <div className="lobby">
      <h1 className="title">Find the Number</h1>
      <p className="tagline">flip-paper bell race · 2 players</p>

      <button className="big-btn create" data-testid="create" onClick={onCreate}>
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
    </div>
  );
}
