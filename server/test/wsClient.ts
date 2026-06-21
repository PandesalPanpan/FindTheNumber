import { WebSocket } from 'ws';

/** A ws client that queues messages and lets tests await a given type. */
export class Client {
  ws: WebSocket;
  private queue: any[] = [];
  private waiters: {
    type: string;
    resolve: (m: any) => void;
    reject: (e: any) => void;
    timer: any;
  }[] = [];

  constructor(u: string) {
    this.ws = new WebSocket(u);
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = this.waiters.findIndex((w) => w.type === msg.t);
      if (i >= 0) {
        const [w] = this.waiters.splice(i, 1);
        clearTimeout(w.timer);
        w.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
  }

  open() {
    return new Promise<void>((res, rej) => {
      this.ws.on('open', () => res());
      this.ws.on('error', rej);
    });
  }

  send(obj: any) {
    this.ws.send(JSON.stringify(obj));
  }

  /** Wait for the next message of a type (checks already-queued messages). */
  next(type: string, timeoutMs = 1500): Promise<any> {
    const i = this.queue.findIndex((m) => m.t === type);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for '${type}'`)),
        timeoutMs,
      );
      this.waiters.push({ type, resolve, reject, timer });
    });
  }

  /** Assert no message of a type arrives within a window. */
  async expectNone(type: string, windowMs = 400) {
    try {
      await this.next(type, windowMs);
      throw new Error(`unexpected '${type}' received`);
    } catch (e: any) {
      if (!String(e.message).startsWith('timeout')) throw e;
    }
  }

  close() {
    this.ws.close();
  }
}

export async function newClient(url: string) {
  const c = new Client(url);
  await c.open();
  return c;
}
