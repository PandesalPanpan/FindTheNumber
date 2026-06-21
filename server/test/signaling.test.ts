import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, SignalingServer } from '../src/server.js';
import { newClient as connect } from './wsClient.js';

let server: SignalingServer;
let url: string;

beforeAll(async () => {
  // short grace so the expiry test is fast
  server = await startServer({ port: 0, graceMs: 300 });
  url = `ws://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

const newClient = () => connect(url);

async function makeRoom() {
  const host = await newClient();
  host.send({ t: 'create' });
  const joined = await host.next('joined');
  const guest = await newClient();
  guest.send({ t: 'join', room: joined.room });
  const gJoined = await guest.next('joined');
  await host.next('peer-joined');
  return { host, guest, code: joined.room as string, hostId: joined.clientId, guestId: gJoined.clientId };
}

describe('signaling server', () => {
  it('create assigns host role + a room code + clientId', async () => {
    const host = await newClient();
    host.send({ t: 'create' });
    const m = await host.next('joined');
    expect(m.role).toBe('host');
    expect(m.room).toMatch(/^[A-Z2-9]{5}$/);
    expect(typeof m.clientId).toBe('string');
    host.close();
  });

  it('join pairs the guest and notifies the host', async () => {
    const { host, guest, code } = await makeRoom();
    expect(code).toBeTruthy();
    host.close();
    guest.close();
  });

  it('rejects joining a non-existent room', async () => {
    const c = await newClient();
    c.send({ t: 'join', room: 'ZZZZZ' });
    const e = await c.next('error');
    expect(e.error).toBe('room-not-found');
    c.close();
  });

  it('rejects a third player (room full)', async () => {
    const { host, guest, code } = await makeRoom();
    const third = await newClient();
    third.send({ t: 'join', room: code });
    const e = await third.next('error');
    expect(e.error).toBe('room-full');
    host.close();
    guest.close();
    third.close();
  });

  it('passes WebRTC signaling between peers', async () => {
    const { host, guest } = await makeRoom();
    host.send({ t: 'signal', payload: { kind: 'offer', sdp: 'X' } });
    const got = await guest.next('signal');
    expect(got.payload).toEqual({ kind: 'offer', sdp: 'X' });
    // and back the other way
    guest.send({ t: 'signal', payload: { kind: 'answer', sdp: 'Y' } });
    const back = await host.next('signal');
    expect(back.payload).toEqual({ kind: 'answer', sdp: 'Y' });
    host.close();
    guest.close();
  });

  it('relays game messages between peers (fallback path)', async () => {
    const { host, guest } = await makeRoom();
    guest.send({ t: 'relay', payload: { t: 'bell', bellTime: 123 } });
    const got = await host.next('relay');
    expect(got.payload).toEqual({ t: 'bell', bellTime: 123 });
    host.close();
    guest.close();
  });

  it('supports reconnect within the grace window', async () => {
    const { host, guest, code, guestId } = await makeRoom();
    guest.close();
    await host.next('peer-dropped');
    // reconnect quickly with the same clientId
    const back = await newClient();
    back.send({ t: 'reconnect', room: code, clientId: guestId, payload: { role: 'guest' } });
    const rejoined = await back.next('joined');
    expect(rejoined.role).toBe('guest');
    await host.next('peer-reconnected');
    // host should NOT get peer-left because grace was cancelled
    await host.expectNone('peer-left', 500);
    host.close();
    back.close();
  });

  it('rejects reconnect with a wrong clientId', async () => {
    const { host, guest, code } = await makeRoom();
    guest.close();
    await host.next('peer-dropped');
    const back = await newClient();
    back.send({ t: 'reconnect', room: code, clientId: 'nope', payload: { role: 'guest' } });
    const e = await back.next('error');
    expect(e.error).toBe('reconnect-rejected');
    host.close();
    back.close();
  });

  it('emits peer-left and deletes the room after grace expiry', async () => {
    const { host, guest, code } = await makeRoom();
    guest.close();
    await host.next('peer-dropped');
    const left = await host.next('peer-left', 1500); // graceMs=300
    expect(left.t).toBe('peer-left');
    // room is gone: a fresh join now fails
    const c = await newClient();
    c.send({ t: 'join', room: code });
    const e = await c.next('error');
    expect(e.error).toBe('room-not-found');
    host.close();
    c.close();
  });
});
