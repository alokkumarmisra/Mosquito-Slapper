import {
  AttackEvent,
  BackendApiConfig,
  CompanionConnectionState,
  RemoteCommand,
  RemoteVisionFramePayload,
  TvHudSyncPayload,
  VideoTransportMode,
} from '../types/game';
import { resolveCompanionWsUrl } from './BackendApiClient';

export interface CompanionCallbacks {
  onConnectionStateChange?: (state: CompanionConnectionState) => void;
  onRoomCode?: (code: string) => void;
  onTransportChange?: (mode: VideoTransportMode) => void;
  onError?: (message: string) => void;
  onRemoteStream?: (stream: MediaStream | null) => void;
  onRemoteJpegFrame?: (dataUrl: string, mirrored: boolean) => void;
  onRemoteVisionFrame?: (frame: RemoteVisionFramePayload) => void;
  onRemoteAttack?: (attack: AttackEvent) => void;
  onRemoteCommand?: (command: RemoteCommand) => void;
  onTvHud?: (hud: TvHudSyncPayload) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Real-time WebSocket + WebRTC Companion Link between a Phone Camera Controller
 * and a TV Display over the Express/WS server on port 3000.
 *
 * Video strategy:
 *  - Primary: WebRTC P2P video stream signaled over /ws (low-latency hardware encode/decode).
 *  - Automatic Fallback: Compressed 480x270 JPEG frames over /ws if ICE does not connect within 2.4s.
 * Tracking & Game Control:
 *  - Real-time hand landmarks, face/ear anchors, gesture attacks, remote commands, and TV HUD sync over /ws.
 */
export class CompanionLink {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private role: 'tv' | 'phone' | null = null;
  private roomCode: string | null = null;
  private callbacks: CompanionCallbacks = {};
  private intentionallyClosed = false;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private webrtcWatchdogTimer: number | null = null;
  private jpegRelayTimer: number | null = null;
  private jpegCanvas: HTMLCanvasElement | null = null;
  private jpegCtx: CanvasRenderingContext2D | null = null;

  private connectionState: CompanionConnectionState = 'DISCONNECTED';
  private transportMode: VideoTransportMode = 'NONE';
  private peerConnected = false;

  // Phone-side video source references for WebRTC & JPEG fallback
  private phoneStream: MediaStream | null = null;
  private phoneVideoEl: HTMLVideoElement | null = null;
  private phoneMirrored = true;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private backendConfig: BackendApiConfig | null = null;

  public setBackendConfig(config: BackendApiConfig): void {
    const prevUrl = this.getWsUrl();
    this.backendConfig = { ...config };
    const nextUrl = this.getWsUrl();
    // If actively connected and the target WS URL changed, seamlessly reconnect to the new backend
    if (prevUrl !== nextUrl && this.role && !this.intentionallyClosed) {
      if (this.ws) {
        try {
          this.ws.onclose = null;
          this.ws.close();
        } catch {
          // Ignore close error
        }
        this.ws = null;
      }
      this.openSocket();
    }
  }

  public setCallbacks(callbacks: CompanionCallbacks): void {
    this.callbacks = callbacks;
  }

  public getRoomCode(): string | null {
    return this.roomCode;
  }

  public getConnectionState(): CompanionConnectionState {
    return this.connectionState;
  }

  public getTransportMode(): VideoTransportMode {
    return this.transportMode;
  }

  public connectAsTv(preferredCode?: string): void {
    this.disconnect();
    this.intentionallyClosed = false;
    this.role = 'tv';
    this.roomCode = preferredCode && /^\d{4}$/.test(preferredCode) ? preferredCode : null;
    this.openSocket();
  }

  public connectAsPhone(roomCode: string): void {
    const clean = roomCode.trim();
    if (!/^\d{4}$/.test(clean)) {
      this.callbacks.onError?.('Enter the 4-digit room code displayed on your TV.');
      return;
    }
    this.disconnect();
    this.intentionallyClosed = false;
    this.role = 'phone';
    this.roomCode = clean;
    this.openSocket();
  }

  public attachPhoneMedia(
    stream: MediaStream | null,
    videoEl: HTMLVideoElement | null,
    mirrored: boolean,
  ): void {
    this.phoneStream = stream;
    this.phoneVideoEl = videoEl;
    this.phoneMirrored = mirrored;

    if (this.role !== 'phone' || !this.peerConnected) return;

    if (stream) {
      const nextTrack = stream.getVideoTracks()[0];
      if (this.pc && nextTrack) {
        const videoSender = this.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(nextTrack).catch(() => {
            void this.startPhoneWebRtcOffer();
          });
          return;
        }
      }
      void this.startPhoneWebRtcOffer();
    }
  }

  public updatePhoneMirror(mirrored: boolean): void {
    this.phoneMirrored = mirrored;
  }

  public sendVisionFrame(payload: RemoteVisionFramePayload): void {
    if (!this.peerConnected || this.role !== 'phone') return;
    this.sendJson({ type: 'vision:frame', payload });
  }

  public sendAttack(attack: AttackEvent): void {
    if (!this.peerConnected || this.role !== 'phone') return;
    this.sendJson({ type: 'vision:attack', attack });
  }

  public sendRemoteCommand(command: RemoteCommand): void {
    if (!this.peerConnected || this.role !== 'phone') return;
    this.sendJson({ type: 'remote:command', command });
  }

  public sendTvHud(hud: TvHudSyncPayload): void {
    if (!this.peerConnected || this.role !== 'tv') return;
    this.sendJson({ type: 'tv:hud', hud });
  }

  public disconnect(): void {
    this.intentionallyClosed = true;
    this.peerConnected = false;
    this.clearTimers();
    this.closePeerConnection();

    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {
        // Ignore close failures
      }
      this.ws = null;
    }

    this.role = null;
    this.roomCode = null;
    this.setTransportMode('NONE');
    this.setConnectionState('DISCONNECTED');
  }

  private getWsUrl(): string {
    return resolveCompanionWsUrl(this.backendConfig);
  }

  private openSocket(): void {
    this.clearTimers();
    this.setConnectionState('CONNECTING');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.getWsUrl());
    } catch {
      this.callbacks.onError?.('Unable to open WebSocket connection to TV pairing server.');
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      if (this.role === 'tv') {
        this.sendJson({ type: 'tv:create', code: this.roomCode ?? undefined });
      } else if (this.role === 'phone' && this.roomCode) {
        this.sendJson({ type: 'phone:join', code: this.roomCode });
      }

      this.pingTimer = window.setInterval(() => {
        this.sendJson({ type: 'ping' });
      }, 15_000);
    };

    ws.onmessage = (event) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handleMessage(msg);
    };

    ws.onerror = () => {
      // onclose handles reconnect cleanly
    };

    ws.onclose = () => {
      this.peerConnected = false;
      this.closePeerConnection();
      this.stopJpegRelay();
      if (!this.intentionallyClosed) {
        this.setConnectionState('CONNECTING');
        this.scheduleReconnect();
      }
    };
  }

  private handleMessage(msg: Record<string, unknown>): void {
    const type = typeof msg.type === 'string' ? msg.type : '';

    if (type === 'room:created') {
      const code = typeof msg.code === 'string' ? msg.code : '';
      this.roomCode = code;
      this.callbacks.onRoomCode?.(code);
      if (msg.peerConnected === true) {
        this.peerConnected = true;
        this.setConnectionState('CONNECTED');
      } else {
        this.peerConnected = false;
        this.setConnectionState('WAITING_FOR_PEER');
      }
      return;
    }

    if (type === 'room:joined') {
      const code = typeof msg.code === 'string' ? msg.code : this.roomCode ?? '';
      this.roomCode = code;
      this.callbacks.onRoomCode?.(code);
      return;
    }

    if (type === 'room:error') {
      const message =
        typeof msg.message === 'string' ? msg.message : 'Unable to pair with TV room.';
      this.callbacks.onError?.(message);
      // Do not infinite-loop on invalid room code from phone
      if (this.role === 'phone') {
        this.intentionallyClosed = true;
        this.setConnectionState('DISCONNECTED');
      }
      return;
    }

    if (type === 'peer:connected') {
      this.peerConnected = true;
      this.setConnectionState('CONNECTED');
      if (this.role === 'phone') {
        void this.startPhoneWebRtcOffer();
      }
      return;
    }

    if (type === 'peer:disconnected') {
      this.peerConnected = false;
      this.closePeerConnection();
      this.stopJpegRelay();
      this.setTransportMode('NONE');
      if (this.role === 'tv') {
        this.callbacks.onRemoteStream?.(null);
        this.setConnectionState('WAITING_FOR_PEER');
      } else {
        this.setConnectionState('WAITING_FOR_PEER');
      }
      return;
    }

    if (type === 'rtc:offer' && this.role === 'tv') {
      const sdp = msg.sdp as RTCSessionDescriptionInit | undefined;
      if (sdp) {
        void this.handleTvWebRtcOffer(sdp);
      }
      return;
    }

    if (type === 'rtc:answer' && this.role === 'phone') {
      const sdp = msg.sdp as RTCSessionDescriptionInit | undefined;
      if (sdp && this.pc) {
        this.pc
          .setRemoteDescription(new RTCSessionDescription(sdp))
          .then(() => this.flushPendingIceCandidates())
          .catch(() => {});
      }
      return;
    }

    if (type === 'rtc:ice') {
      const candidate = msg.candidate as RTCIceCandidateInit | undefined;
      if (!candidate) return;
      if (this.pc && this.pc.remoteDescription) {
        this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      } else {
        this.pendingIceCandidates.push(candidate);
      }
      return;
    }

    if (type === 'video:frame' && this.role === 'tv') {
      const dataUrl = typeof msg.dataUrl === 'string' ? msg.dataUrl : '';
      const mirrored = msg.mirrored !== false;
      if (dataUrl) {
        if (this.transportMode !== 'WEBRTC') {
          this.setTransportMode('WS_RELAY');
        }
        this.callbacks.onRemoteJpegFrame?.(dataUrl, mirrored);
      }
      return;
    }

    if (type === 'vision:frame' && this.role === 'tv') {
      const payload = msg.payload as RemoteVisionFramePayload | undefined;
      if (payload) {
        this.callbacks.onRemoteVisionFrame?.(payload);
      }
      return;
    }

    if (type === 'vision:attack' && this.role === 'tv') {
      const attack = msg.attack as AttackEvent | undefined;
      if (attack) {
        this.callbacks.onRemoteAttack?.(attack);
      }
      return;
    }

    if (type === 'remote:command' && this.role === 'tv') {
      const command = msg.command as RemoteCommand | undefined;
      if (command) {
        this.callbacks.onRemoteCommand?.(command);
      }
      return;
    }

    if (type === 'tv:hud' && this.role === 'phone') {
      const hud = msg.hud as TvHudSyncPayload | undefined;
      if (hud) {
        this.callbacks.onTvHud?.(hud);
      }
    }
  }

  private async startPhoneWebRtcOffer(): Promise<void> {
    this.closePeerConnection();
    this.stopJpegRelay();

    if (!this.peerConnected || this.role !== 'phone') return;

    // Start fallback watchdog so TV always gets live camera video even if WebRTC ICE is blocked
    this.armWebRtcWatchdog();

    if (typeof RTCPeerConnection === 'undefined' || !this.phoneStream) {
      this.startJpegRelay();
      return;
    }

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      this.pendingIceCandidates = [];

      for (const track of this.phoneStream.getVideoTracks()) {
        pc.addTrack(track, this.phoneStream);
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendJson({ type: 'rtc:ice', candidate: e.candidate.toJSON() });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          this.clearWatchdog();
          this.stopJpegRelay();
          this.setTransportMode('WEBRTC');
        } else if (
          pc.connectionState === 'failed' ||
          pc.connectionState === 'disconnected'
        ) {
          if (this.peerConnected) {
            this.startJpegRelay();
          }
        }
      };

      const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
      await pc.setLocalDescription(offer);
      this.sendJson({ type: 'rtc:offer', sdp: pc.localDescription });
    } catch {
      this.startJpegRelay();
    }
  }

  private async handleTvWebRtcOffer(sdp: RTCSessionDescriptionInit): Promise<void> {
    this.closePeerConnection();
    if (typeof RTCPeerConnection === 'undefined') return;

    try {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      this.pc = pc;
      this.pendingIceCandidates = [];

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          this.sendJson({ type: 'rtc:ice', candidate: e.candidate.toJSON() });
        }
      };

      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        this.setTransportMode('WEBRTC');
        this.callbacks.onRemoteStream?.(stream);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          this.setTransportMode('WEBRTC');
        } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.callbacks.onRemoteStream?.(null);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      await this.flushPendingIceCandidates();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendJson({ type: 'rtc:answer', sdp: pc.localDescription });
    } catch {
      // Phone will automatically switch to WebSocket JPEG fallback frames
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;
    const queued = this.pendingIceCandidates.splice(0, this.pendingIceCandidates.length);
    for (const c of queued) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // Ignore stale candidates
      }
    }
  }

  private armWebRtcWatchdog(): void {
    this.clearWatchdog();
    this.webrtcWatchdogTimer = window.setTimeout(() => {
      if (this.peerConnected && this.transportMode !== 'WEBRTC') {
        this.startJpegRelay();
      }
    }, 2400);
  }

  private clearWatchdog(): void {
    if (this.webrtcWatchdogTimer !== null) {
      window.clearTimeout(this.webrtcWatchdogTimer);
      this.webrtcWatchdogTimer = null;
    }
  }

  private startJpegRelay(): void {
    if (this.jpegRelayTimer !== null || !this.peerConnected || this.role !== 'phone') return;

    if (!this.jpegCanvas) {
      this.jpegCanvas = document.createElement('canvas');
      this.jpegCanvas.width = 480;
      this.jpegCanvas.height = 270;
      this.jpegCtx = this.jpegCanvas.getContext('2d');
    }

    this.setTransportMode('WS_RELAY');

    this.jpegRelayTimer = window.setInterval(() => {
      if (
        !this.peerConnected ||
        !this.ws ||
        this.ws.readyState !== WebSocket.OPEN ||
        this.ws.bufferedAmount > 256 * 1024
      ) {
        return;
      }
      const video = this.phoneVideoEl;
      if (!video || video.readyState < 2 || video.videoWidth === 0 || !this.jpegCanvas || !this.jpegCtx) {
        return;
      }

      const targetW = 480;
      const aspect = video.videoHeight / Math.max(1, video.videoWidth);
      const targetH = Math.max(180, Math.min(360, Math.round(targetW * aspect)));
      if (this.jpegCanvas.width !== targetW || this.jpegCanvas.height !== targetH) {
        this.jpegCanvas.width = targetW;
        this.jpegCanvas.height = targetH;
      }

      this.jpegCtx.drawImage(video, 0, 0, targetW, targetH);
      const dataUrl = this.jpegCanvas.toDataURL('image/jpeg', 0.54);
      this.sendJson({
        type: 'video:frame',
        dataUrl,
        mirrored: this.phoneMirrored,
      });
    }, 62); // ~16 FPS smooth fallback
  }

  private stopJpegRelay(): void {
    if (this.jpegRelayTimer !== null) {
      window.clearInterval(this.jpegRelayTimer);
      this.jpegRelayTimer = null;
    }
  }

  private closePeerConnection(): void {
    this.clearWatchdog();
    this.pendingIceCandidates = [];
    if (this.pc) {
      try {
        this.pc.onicecandidate = null;
        this.pc.ontrack = null;
        this.pc.onconnectionstatechange = null;
        this.pc.close();
      } catch {
        // Ignore cleanup errors
      }
      this.pc = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed || this.reconnectTimer !== null || !this.role) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionallyClosed && this.role) {
        this.openSocket();
      }
    }, 2200);
  }

  private clearTimers(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearWatchdog();
    this.stopJpegRelay();
  }

  private sendJson(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {
      // Ignore transient errors
    }
  }

  private setConnectionState(next: CompanionConnectionState): void {
    if (this.connectionState === next) return;
    this.connectionState = next;
    this.callbacks.onConnectionStateChange?.(next);
  }

  private setTransportMode(next: VideoTransportMode): void {
    if (this.transportMode === next) return;
    this.transportMode = next;
    this.callbacks.onTransportChange?.(next);
  }
}
