import { FilesetResolver, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { HandPose, HandSide, Point3D, TrackedHand, VisionEngineMode } from '../types/game';
import { LocalVisionFallback } from './LocalVisionFallback';

const LOCAL_WASM_ROOT = '/mediapipe/wasm';
const CDN_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const LOCAL_MODEL_URL = '/models/hand_landmarker.task';
const REMOTE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private localFallback: LocalVisionFallback;
  private mode: VisionEngineMode = 'INITIALIZING';
  private lastVideoTime = -1;
  private previousBySide: Map<HandSide, TrackedHand> = new Map();
  private initPromise: Promise<VisionEngineMode> | null = null;

  constructor() {
    this.localFallback = new LocalVisionFallback();
  }

  public getMode(): VisionEngineMode {
    return this.mode;
  }

  public async initialize(sensitivity = 0.65): Promise<VisionEngineMode> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        let vision;
        try {
          vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_ROOT);
        } catch {
          vision = await FilesetResolver.forVisionTasks(CDN_WASM_ROOT);
        }

        const modelBytes = await this.loadValidatedModelBuffer();
        const confidence = this.sensitivityToConfidence(sensitivity);

        try {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetBuffer: modelBytes.slice(),
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: confidence,
            minHandPresenceConfidence: confidence,
            minTrackingConfidence: Math.max(0.25, confidence - 0.08),
          });
          this.mode = 'MEDIAPIPE_GPU';
          return this.mode;
        } catch {
          this.landmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetBuffer: modelBytes.slice(),
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: confidence,
            minHandPresenceConfidence: confidence,
            minTrackingConfidence: Math.max(0.25, confidence - 0.08),
          });
          this.mode = 'MEDIAPIPE_CPU';
          return this.mode;
        }
      } catch (err) {
        console.warn('MediaPipe HandLandmarker unavailable, using local optical hand tracker:', err);
        this.landmarker = null;
        this.mode = 'LOCAL_OPTICAL';
        return this.mode;
      }
    })();

    return this.initPromise;
  }

  /**
   * Fetches the .task model bundle and validates its ZIP archive magic bytes ("PK")
   * so an accidental HTML/SPA fallback response is never fed into MediaPipe's zip reader.
   */
  private async loadValidatedModelBuffer(): Promise<Uint8Array> {
    const candidates = [LOCAL_MODEL_URL, REMOTE_MODEL_URL];

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;

        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if (contentType.includes('text/html')) continue;

        const buffer = await res.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        // MediaPipe .task bundles are ZIP archives (sometimes padded by a few alignment bytes before PK\x03\x04)
        if (bytes.byteLength > 100_000 && this.hasZipHeader(bytes)) {
          return bytes;
        }
      } catch {
        // Try next candidate URL
      }
    }

    throw new Error('Could not load a valid MediaPipe hand_landmarker.task zip archive.');
  }

  private hasZipHeader(bytes: Uint8Array): boolean {
    // Reject HTML documents immediately ('<' = 0x3C)
    if (bytes[0] === 0x3c) return false;
    const scanLimit = Math.min(bytes.byteLength - 4, 64);
    for (let i = 0; i <= scanLimit; i++) {
      if (
        bytes[i] === 0x50 &&
        bytes[i + 1] === 0x4b &&
        bytes[i + 2] === 0x03 &&
        bytes[i + 3] === 0x04
      ) {
        return true;
      }
    }
    return false;
  }

  private sensitivityToConfidence(sensitivity: number): number {
    // Higher sensitivity (0.9) => lower min confidence (0.28); lower sensitivity (0.25) => higher min confidence (0.72)
    return Math.min(0.78, Math.max(0.24, 0.92 - sensitivity * 0.68));
  }

  public updateSensitivity(sensitivity: number): void {
    if (!this.landmarker) return;
    const confidence = this.sensitivityToConfidence(sensitivity);
    try {
      this.landmarker.setOptions({
        minHandDetectionConfidence: confidence,
        minHandPresenceConfidence: confidence,
        minTrackingConfidence: Math.max(0.22, confidence - 0.08),
      });
    } catch {
      // Ignore runtime option errors
    }
  }

  public detectFrame(
    video: HTMLVideoElement,
    timestampMs: number,
    mirror: boolean,
    sensitivity: number,
    canvasW = 0,
    canvasH = 0,
  ): TrackedHand[] {
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return [];
    }

    if (!this.landmarker) {
      if (this.mode === 'LOCAL_OPTICAL') {
        return this.localFallback.detect(video, timestampMs, mirror, sensitivity);
      }
      return [];
    }

    // Avoid redundant inference when video frame hasn't advanced
    if (video.currentTime === this.lastVideoTime) {
      return Array.from(this.previousBySide.values()).filter(
        (h) => timestampMs - h.lastSeen < 180,
      );
    }
    this.lastVideoTime = video.currentTime;

    let result;
    try {
      result = this.landmarker.detectForVideo(video, timestampMs);
    } catch {
      return [];
    }

    if (!result?.landmarks || result.landmarks.length === 0) {
      // Prune stale tracks cleanly
      for (const [side, h] of this.previousBySide.entries()) {
        if (timestampMs - h.lastSeen > 120) {
          this.previousBySide.delete(side);
        }
      }
      return [];
    }

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = canvasW > 0 ? canvasW : vw;
    const ch = canvasH > 0 ? canvasH : vh;
    const coverScale = Math.max(cw / vw, ch / vh);
    const drawW = vw * coverScale;
    const drawH = vh * coverScale;
    const offsetX = (cw - drawW) * 0.5;
    const offsetY = (ch - drawH) * 0.5;

    const detectedSides = new Set<HandSide>();
    const hands: TrackedHand[] = [];

    for (let i = 0; i < result.landmarks.length; i++) {
      const rawLandmarks = result.landmarks[i];
      const rawHandedness = result.handednesses?.[i]?.[0];
      const score = rawHandedness?.score ?? 0.85;

      // Mirror and project coordinates through object-fit: cover so overlay aligns with rendered video
      const landmarks: Point3D[] = rawLandmarks.map((lm: NormalizedLandmark) => {
        const mx = mirror ? 1 - lm.x : lm.x;
        return {
          x: (mx * drawW + offsetX) / cw,
          y: (lm.y * drawH + offsetY) / ch,
          z: lm.z,
        };
      });

      // Palm center from wrist + 4 MCP knuckle landmarks (0, 5, 9, 13, 17)
      const palmIndices = [0, 5, 9, 13, 17];
      let px = 0;
      let py = 0;
      for (const idx of palmIndices) {
        px += landmarks[idx].x;
        py += landmarks[idx].y;
      }
      px /= palmIndices.length;
      py /= palmIndices.length;

      // Estimate palm radius from wrist-to-middle-MCP span
      const wrist = landmarks[0];
      const midMcp = landmarks[9];
      const indexMcp = landmarks[5];
      const pinkyMcp = landmarks[17];
      const palmLen = Math.hypot(midMcp.x - wrist.x, midMcp.y - wrist.y);
      const palmWidth = Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y);
      const palmRadius = Math.max(0.032, (palmLen + palmWidth) * 0.42);

      // Classify handedness (flip label in mirrored view so player's physical left hand reads "Left")
      let side: HandSide = rawHandedness?.categoryName === 'Left' ? 'Left' : 'Right';
      if (mirror) {
        side = side === 'Left' ? 'Right' : 'Left';
      }
      if (detectedSides.has(side)) {
        side = side === 'Left' ? 'Right' : 'Left';
      }
      detectedSides.add(side);

      const pose = this.classifyPose(landmarks);
      const prev = this.previousBySide.get(side);

      let vx = 0;
      let vy = 0;
      let smoothedX = px;
      let smoothedY = py;
      let history = prev ? [...prev.history] : [];

      if (prev && timestampMs > prev.lastSeen && timestampMs - prev.lastSeen < 250) {
        const dt = Math.max(0.008, (timestampMs - prev.lastSeen) / 1000);
        // Light exponential smoothing keeps fast slaps snappy while removing landmark jitter
        const instantSpeed = Math.hypot(px - prev.palm.x, py - prev.palm.y) / dt;
        const alpha = instantSpeed > 0.8 ? 0.84 : 0.62;
        smoothedX = prev.palm.x * (1 - alpha) + px * alpha;
        smoothedY = prev.palm.y * (1 - alpha) + py * alpha;

        const rawVx = (smoothedX - prev.palm.x) / dt;
        const rawVy = (smoothedY - prev.palm.y) / dt;
        vx = prev.vx * 0.25 + rawVx * 0.75;
        vy = prev.vy * 0.25 + rawVy * 0.75;
      }

      history.push({ x: smoothedX, y: smoothedY, time: timestampMs });
      history = history.filter((pt) => timestampMs - pt.time <= 160).slice(-12);

      const speed = Math.hypot(vx, vy);
      const tracked: TrackedHand = {
        id: `mp-${side}`,
        side,
        palm: { x: smoothedX, y: smoothedY },
        palmRadius,
        landmarks,
        pose,
        vx,
        vy,
        speed,
        direction: Math.atan2(vy, vx),
        history,
        confidence: score,
        lastSeen: timestampMs,
      };

      this.previousBySide.set(side, tracked);
      hands.push(tracked);
    }

    for (const side of Array.from(this.previousBySide.keys())) {
      if (!detectedSides.has(side)) {
        const stale = this.previousBySide.get(side);
        if (stale && timestampMs - stale.lastSeen > 120) {
          this.previousBySide.delete(side);
        }
      }
    }

    return hands;
  }

  private classifyPose(lm: Point3D[]): HandPose {
    const wrist = lm[0];
    // Compare finger tips (8, 12, 16, 20) vs PIP joints (6, 10, 14, 18) distance to wrist
    const pairs: Array<[number, number]> = [
      [8, 6],
      [12, 10],
      [16, 14],
      [20, 18],
    ];
    let extendedCount = 0;
    let curledCount = 0;

    for (const [tipIdx, pipIdx] of pairs) {
      const tipDist = Math.hypot(lm[tipIdx].x - wrist.x, lm[tipIdx].y - wrist.y);
      const pipDist = Math.hypot(lm[pipIdx].x - wrist.x, lm[pipIdx].y - wrist.y);
      if (tipDist > pipDist * 1.15) extendedCount++;
      else if (tipDist < pipDist * 0.96) curledCount++;
    }

    if (extendedCount >= 3) return 'OPEN_PALM';
    if (curledCount >= 3) return 'CLOSED_FIST';
    return 'NEUTRAL';
  }

  public reset(): void {
    this.previousBySide.clear();
    this.localFallback.reset();
    this.lastVideoTime = -1;
  }

  public dispose(): void {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    this.previousBySide.clear();
  }
}
