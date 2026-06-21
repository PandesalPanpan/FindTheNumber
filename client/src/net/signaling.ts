export type Role = 'host' | 'guest';

type Handler = (msg: any) => void;

function defaultSignalUrl(): string {
  const env = (import.meta as any).env?.VITE_SIGNAL_URL as string | undefined;
  if (env) return env;
  // default: same origin, path /ws (nginx proxies it to the server in prod;
  // the Vite dev server proxies it to :8787 in development).
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/**
 * Thin WebSocket client to the signaling/relay server. Also used to tunnel game
 * messages when WebRTC falls back to relay mode.
 */
export class Signaling {
  private ws: WebSocket;
  private handlers = new Map<string, Set<Handler>>();
  private ready: Promise<void>;

  constructor(url: string = defaultSignalUrl()) {
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
    });
    this.ws.onmessage = (ev) => {
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handlers.get(msg.t)?.forEach((h) => h(msg));
    };
  }

  async waitOpen() {
    await this.ready;
  }

  on(type: string, handler: Handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  private raw(obj: any) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  create() {
    this.raw({ t: 'create' });
  }

  join(room: string) {
    this.raw({ t: 'join', room });
  }

  reconnect(room: string, role: Role, clientId: string) {
    this.raw({ t: 'reconnect', room, clientId, payload: { role } });
  }

  signal(payload: any) {
    this.raw({ t: 'signal', payload });
  }

  relay(payload: any) {
    this.raw({ t: 'relay', payload });
  }

  close() {
    this.ws.close();
  }
}
