import { HandPose, HandSide, Point3D, TrackedHand } from '../types/game';

/**
 * Pure local zero-network computer vision hand tracker.
 * Runs directly on live webcam ImageData using YCbCr skin-tone segmentation
 * combined with temporal frame-differencing motion clustering to detect up to
 * two physical hands when MediaPipe's external .task file is unreachable offline.
 */
export class LocalVisionFallback {
  private readonly sampleW = 96;
  private readonly sampleH = 54;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private prevLuma: Uint8Array | null = null;
  private prevHands: Map<HandSide, TrackedHand> = new Map();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.sampleW;
    this.canvas.height = this.sampleH;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to create local vision canvas context');
    }
    this.ctx = ctx;
  }

  public detect(
    video: HTMLVideoElement,
    timestampMs: number,
    mirror: boolean,
    sensitivity: number,
  ): TrackedHand[] {
    if (video.readyState < 2 || video.videoWidth === 0) return [];

    const { sampleW: w, sampleH: h } = this;
    this.ctx.save();
    if (mirror) {
      this.ctx.translate(w, 0);
      this.ctx.scale(-1, 1);
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    this.ctx.restore();

    const frame = this.ctx.getImageData(0, 0, w, h).data;
    const currLuma = new Uint8Array(w * h);

    // Split frame into left & right motion+skin clusters (simple 2-cluster k-means seed)
    const activePoints: Array<{ x: number; y: number; weight: number }> = [];
    const motionThreshold = Math.max(12, Math.round(38 - sensitivity * 24));

    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        const idx = y * w + x;
        const p = idx * 4;
        const r = frame[p];
        const g = frame[p + 1];
        const b = frame[p + 2];
        const luma = (0.299 * r + 0.587 * g + 0.114 * b) | 0;
        currLuma[idx] = luma;

        if (!this.prevLuma) continue;
        const diff = Math.abs(luma - this.prevLuma[idx]);
        if (diff < motionThreshold) continue;

        // YCbCr skin likelihood check (broad lighting range)
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
        const isSkin = cb >= 72 && cb <= 132 && cr >= 128 && cr <= 180;
        const weight = isSkin ? diff * 2.2 : diff * 0.55;

        if (weight > motionThreshold * 1.15) {
          activePoints.push({ x: x / w, y: y / h, weight });
        }
      }
    }

    this.prevLuma = currLuma;

    const results: TrackedHand[] = [];
    if (activePoints.length < 18) {
      // Retain fading memory briefly so slow hands don't drop abruptly
      for (const [side, hand] of this.prevHands.entries()) {
        if (timestampMs - hand.lastSeen < 140) {
          results.push({ ...hand, vx: hand.vx * 0.5, vy: hand.vy * 0.5, speed: hand.speed * 0.5 });
        } else {
          this.prevHands.delete(side);
        }
      }
      return results;
    }

    // Two-centroid split along horizontal spread if wide enough
    let minX = 1;
    let maxX = 0;
    for (const pt of activePoints) {
      if (pt.x < minX) minX = pt.x;
      if (pt.x > maxX) maxX = pt.x;
    }

    const clusters: Array<Array<{ x: number; y: number; weight: number }>> = [];
    if (maxX - minX > 0.28 && activePoints.length >= 44) {
      const splitX = (minX + maxX) * 0.5;
      const leftPts = activePoints.filter((pt) => pt.x <= splitX);
      const rightPts = activePoints.filter((pt) => pt.x > splitX);
      if (leftPts.length >= 16) clusters.push(leftPts);
      if (rightPts.length >= 16) clusters.push(rightPts);
    } else {
      clusters.push(activePoints);
    }

    for (const pts of clusters) {
      let sumW = 0;
      let cx = 0;
      let cy = 0;
      for (const pt of pts) {
        sumW += pt.weight;
        cx += pt.x * pt.weight;
        cy += pt.y * pt.weight;
      }
      cx /= sumW;
      cy /= sumW;

      let spread = 0;
      for (const pt of pts) {
        spread += Math.hypot(pt.x - cx, pt.y - cy) * pt.weight;
      }
      const radius = Math.min(0.11, Math.max(0.035, (spread / sumW) * 1.15));
      const side: HandSide = cx < 0.5 ? 'Left' : 'Right';
      const prev = this.prevHands.get(side);

      let vx = 0;
      let vy = 0;
      let history = prev ? [...prev.history] : [];

      if (prev && timestampMs > prev.lastSeen) {
        const dt = Math.max(0.008, (timestampMs - prev.lastSeen) / 1000);
        const alpha = 0.55;
        cx = prev.palm.x * (1 - alpha) + cx * alpha;
        cy = prev.palm.y * (1 - alpha) + cy * alpha;
        vx = (cx - prev.palm.x) / dt;
        vy = (cy - prev.palm.y) / dt;
      }

      history.push({ x: cx, y: cy, time: timestampMs });
      history = history.filter((p) => timestampMs - p.time <= 180).slice(-10);

      const speed = Math.hypot(vx, vy);
      const pose: HandPose = radius > 0.052 ? 'OPEN_PALM' : 'CLOSED_FIST';
      const landmarks = this.synthesizeLandmarks(cx, cy, radius, pose);

      const tracked: TrackedHand = {
        id: `local-${side}`,
        side,
        palm: { x: cx, y: cy },
        palmRadius: radius,
        landmarks,
        pose,
        vx,
        vy,
        speed,
        direction: Math.atan2(vy, vx),
        history,
        confidence: Math.min(0.95, pts.length / 90),
        lastSeen: timestampMs,
      };

      this.prevHands.set(side, tracked);
      results.push(tracked);
    }

    return results;
  }

  private synthesizeLandmarks(cx: number, cy: number, r: number, pose: HandPose): Point3D[] {
    const ext = pose === 'OPEN_PALM' ? 1.45 : 0.62;
    const pts: Point3D[] = [{ x: cx, y: cy + r * 0.8, z: 0 }];
    const angles = [-2.2, -1.85, -1.55, -1.25, -0.95];
    for (const a of angles) {
      for (let seg = 1; seg <= 4; seg++) {
        const dist = r * (0.35 + seg * 0.25 * ext);
        pts.push({
          x: cx + Math.cos(a) * dist,
          y: cy + Math.sin(a) * dist,
          z: 0,
        });
      }
    }
    return pts;
  }

  public reset(): void {
    this.prevLuma = null;
    this.prevHands.clear();
  }
}
