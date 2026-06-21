import { Signaling, Role } from './signaling.js';

export type TransportMode = 'p2p' | 'relay';

/**
 * Unified game-message transport. Tries WebRTC DataChannel (P2P); if ICE does
 * not connect within `iceTimeoutMs`, falls back to relaying through the
 * signaling WebSocket. Same send()/onMessage() API either way.
 */
export class Transport {
  mode: TransportMode = 'p2p';
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private msgHandlers = new Set<(m: any) => void>();
  private openHandlers = new Set<(mode: TransportMode) => void>();
  private opened = false;
  private iceTimer?: ReturnType<typeof setTimeout>;
  private offSignal?: () => void;
  private offRelay?: () => void;

  constructor(
    private signaling: Signaling,
    private role: Role,
    private opts: { iceTimeoutMs: number; forceRelay?: boolean; relayDelayMs?: number },
  ) {}

  onMessage(cb: (m: any) => void) {
    this.msgHandlers.add(cb);
    return () => this.msgHandlers.delete(cb);
  }

  onOpen(cb: (mode: TransportMode) => void) {
    this.openHandlers.add(cb);
    if (this.opened) cb(this.mode);
    return () => this.openHandlers.delete(cb);
  }

  private emitMessage(m: any) {
    this.msgHandlers.forEach((h) => h(m));
  }

  private markOpen(mode: TransportMode) {
    if (this.opened) return;
    this.opened = true;
    this.mode = mode;
    this.openHandlers.forEach((h) => h(mode));
  }

  /** Begin connecting. Host should call once the guest has joined. */
  start() {
    // always listen for relayed game messages (used in fallback mode)
    this.offRelay = this.signaling.on('relay', (msg) => {
      if (this.mode === 'relay') this.emitMessage(msg.payload);
    });

    if (this.opts.forceRelay) {
      this.useRelay();
      return;
    }
    this.setupPeer();
  }

  private setupPeer() {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    this.pc = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.signal({ kind: 'ice', candidate: e.candidate });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && !this.opened) this.useRelay();
    };

    this.offSignal = this.signaling.on('signal', async (msg) => {
      const p = msg.payload;
      try {
        if (p.kind === 'offer') {
          await pc.setRemoteDescription(p.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signaling.signal({ kind: 'answer', sdp: answer });
        } else if (p.kind === 'answer') {
          await pc.setRemoteDescription(p.sdp);
        } else if (p.kind === 'ice') {
          await pc.addIceCandidate(p.candidate);
        }
      } catch {
        /* ignore stray/late candidates */
      }
    });

    if (this.role === 'host') {
      const dc = pc.createDataChannel('game', { ordered: true });
      this.bindChannel(dc);
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => this.signaling.signal({ kind: 'offer', sdp: offer }))
        .catch(() => this.useRelay());
    } else {
      pc.ondatachannel = (e) => this.bindChannel(e.channel);
    }

    this.iceTimer = setTimeout(() => {
      if (!this.opened) this.useRelay();
    }, this.opts.iceTimeoutMs);
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => {
      if (this.iceTimer) clearTimeout(this.iceTimer);
      this.markOpen('p2p');
    };
    dc.onmessage = (e) => {
      try {
        this.emitMessage(JSON.parse(e.data));
      } catch {
        /* ignore */
      }
    };
  }

  private useRelay() {
    if (this.opened && this.mode === 'p2p') return;
    if (this.iceTimer) clearTimeout(this.iceTimer);
    try {
      this.pc?.close();
    } catch {
      /* noop */
    }
    this.markOpen('relay');
  }

  send(msg: any) {
    if (this.mode === 'p2p' && this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
    } else {
      // optional artificial per-message latency on the relay path (testing).
      // Applied symmetrically on both peers, so clock-sync offset stays ~0.
      const d = this.opts.relayDelayMs ?? 0;
      if (d > 0) setTimeout(() => this.signaling.relay(msg), d);
      else this.signaling.relay(msg);
    }
  }

  destroy() {
    this.offSignal?.();
    this.offRelay?.();
    if (this.iceTimer) clearTimeout(this.iceTimer);
    try {
      this.pc?.close();
    } catch {
      /* noop */
    }
  }
}
