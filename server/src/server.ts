import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

type Role = 'host' | 'guest';

interface Member {
  socket: WebSocket | null;
  clientId: string;
  graceTimer?: ReturnType<typeof setTimeout>;
}

interface Room {
  code: string;
  members: Partial<Record<Role, Member>>;
}

interface Incoming {
  t: string;
  room?: string;
  clientId?: string;
  payload?: unknown;
}

export interface SignalingServer {
  port: number;
  close: () => Promise<void>;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no ambiguous chars

function send(socket: WebSocket | null | undefined, msg: unknown) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function peerRole(role: Role): Role {
  return role === 'host' ? 'guest' : 'host';
}

function roomFull(room: Room): boolean {
  return Boolean(room.members.host?.socket && room.members.guest?.socket);
}

/**
 * Start a signaling/relay server. Each instance owns its own room registry so
 * multiple instances (e.g. in tests) are fully isolated. Pass port 0 for an
 * ephemeral port; the resolved port is returned.
 */
export function startServer(
  opts: { port?: number; graceMs?: number } = {},
): Promise<SignalingServer> {
  const graceMs = opts.graceMs ?? 15000;
  const rooms = new Map<string, Room>();

  function makeCode(): string {
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
    } while (rooms.has(code));
    return code;
  }

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (socket) => {
    let myRoom: string | null = null;
    let myRole: Role | null = null;

    socket.on('message', (raw) => {
      let msg: Incoming;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.t) {
        case 'create': {
          const code = makeCode();
          const clientId = randomUUID();
          const room: Room = { code, members: { host: { socket, clientId } } };
          rooms.set(code, room);
          myRoom = code;
          myRole = 'host';
          send(socket, { t: 'joined', room: code, role: 'host', clientId });
          break;
        }

        case 'join': {
          const code = (msg.room ?? '').toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            send(socket, { t: 'error', error: 'room-not-found' });
            return;
          }
          if (room.members.guest?.socket) {
            send(socket, { t: 'error', error: 'room-full' });
            return;
          }
          const clientId = randomUUID();
          room.members.guest = { socket, clientId };
          myRoom = code;
          myRole = 'guest';
          send(socket, { t: 'joined', room: code, role: 'guest', clientId });
          // tell the host its peer arrived (host initiates the WebRTC offer)
          send(room.members.host?.socket, { t: 'peer-joined' });
          break;
        }

        case 'reconnect': {
          const code = (msg.room ?? '').toUpperCase();
          const room = rooms.get(code);
          const role = (msg.payload as { role?: Role })?.role;
          const clientId = msg.clientId;
          if (!room || !role || !clientId) {
            send(socket, { t: 'error', error: 'reconnect-failed' });
            return;
          }
          const member = room.members[role];
          if (!member || member.clientId !== clientId) {
            send(socket, { t: 'error', error: 'reconnect-rejected' });
            return;
          }
          if (member.graceTimer) {
            clearTimeout(member.graceTimer);
            member.graceTimer = undefined;
          }
          member.socket = socket;
          myRoom = code;
          myRole = role;
          send(socket, { t: 'joined', room: code, role, clientId });
          send(room.members[peerRole(role)]?.socket, { t: 'peer-reconnected' });
          if (roomFull(room) && role === 'guest') {
            send(room.members.host?.socket, { t: 'peer-joined' });
          }
          break;
        }

        // WebRTC signaling passthrough (sdp / ice) and game relay fallback
        case 'signal':
        case 'relay': {
          if (!myRoom || !myRole) return;
          const room = rooms.get(myRoom);
          if (!room) return;
          send(room.members[peerRole(myRole)]?.socket, {
            t: msg.t,
            payload: msg.payload,
          });
          break;
        }

        default:
          break;
      }
    });

    socket.on('close', () => {
      if (!myRoom || !myRole) return;
      const room = rooms.get(myRoom);
      if (!room) return;
      const member = room.members[myRole];
      if (!member) return;
      member.socket = null;
      send(room.members[peerRole(myRole)]?.socket, { t: 'peer-dropped' });
      member.graceTimer = setTimeout(() => {
        send(room.members[peerRole(myRole!)]?.socket, { t: 'peer-left' });
        rooms.delete(room.code);
      }, graceMs);
    });
  });

  return new Promise((resolve) => {
    http.listen(opts.port ?? 0, () => {
      const addr = http.address();
      const port = typeof addr === 'object' && addr ? addr.port : (opts.port ?? 0);
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            for (const room of rooms.values()) {
              for (const m of Object.values(room.members)) {
                if (m?.graceTimer) clearTimeout(m.graceTimer);
              }
            }
            wss.close(() => http.close(() => res()));
          }),
      });
    });
  });
}
