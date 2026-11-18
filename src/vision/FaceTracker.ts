import { FaceDetector, FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { FaceAnchor, FaceLandingZone, FaceZoneAnchor, Point2D } from '../types/game';

const LOCAL_WASM_ROOT = '/mediapipe/wasm';
const CDN_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

const LOCAL_FACE_LANDMARKER_URL = '/models/face_landmarker.task';
const REMOTE_FACE_LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LOCAL_BLAZEFACE_URL = '/models/blaze_face_short_range.tflite';
const REMOTE_BLAZEFACE_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

// Compact 18-point facial oval contour sampled from MediaPipe's canonical 478-landmark mesh
const FACE_OVAL_INDICES = [
  10, 297, 284, 389, 454, 361, 397, 379, 377, 152, 176, 150, 172, 132, 234, 162, 54, 67,
];

export const FACE_ZONE_LABELS: Record<FaceLandingZone, string> = {
  HEAD: 'Head',
  FOREHEAD: 'Forehead',
  NOSE: 'Nose',
  LEFT_CHEEK: 'Left Cheek',
  RIGHT_CHEEK: 'Right Cheek',
};

export const ALL_FACE_LANDING_ZONES: FaceLandingZone[] = [
  'HEAD',
  'FOREHEAD',
  'NOSE',
  'LEFT_CHEEK',
  'RIGHT_CHEEK',
];

function clamp01(v: number): number {
  return Math.max(0.02, Math.min(0.98, v));
}

function buildZonesRecord(
  head: Point2D,
  forehead: Point2D,
  nose: Point2D,
  leftCheek: Point2D,
  rightCheek: Point2D,
  faceRadius: number,
): Record<FaceLandingZone, FaceZoneAnchor> {
  return {
    HEAD: {
      zone: 'HEAD',
      label: FACE_ZONE_LABELS.HEAD,
      point: head,
      radius: Math.max(0.028, faceRadius * 0.34),
    },
    FOREHEAD: {
      zone: 'FOREHEAD',
      label: FACE_ZONE_LABELS.FOREHEAD,
      point: forehead,
      radius: Math.max(0.026, faceRadius * 0.3),
    },
    NOSE: {
      zone: 'NOSE',
      label: FACE_ZONE_LABELS.NOSE,
      point: nose,
      radius: Math.max(0.02, faceRadius * 0.22),
    },
    LEFT_CHEEK: {
      zone: 'LEFT_CHEEK',
      label: FACE_ZONE_LABELS.LEFT_CHEEK,
      point: leftCheek,
      radius: Math.max(0.024, faceRadius * 0.28),
    },
    RIGHT_CHEEK: {
      zone: 'RIGHT_CHEEK',
      label: FACE_ZONE_LABELS.RIGHT_CHEEK,
      point: rightCheek,
      radius: Math.max(0.024, faceRadius * 0.28),
    },
  };
}

export function createDefaultFaceAnchor(): FaceAnchor {
  const faceCenter = { x: 0.5, y: 0.44 };
  const faceRadius = 0.14;
  return {
    faceCenter,
    faceRadius,
    headRollRad: 0,
    leftEar: { x: 0.36, y: 0.44 },
    rightEar: { x: 0.64, y: 0.44 },
    earRadius: 0.1,
    zones: buildZonesRecord(
      { x: 0.5, y: 0.24 },
      { x: 0.5, y: 0.34 },
      { x: 0.5, y: 0.45 },
      { x: 0.43, y: 0.49 },
      { x: 0.57, y: 0.49 },
      faceRadius,
    ),
    trackerKind: 'FALLBACK',
    detected: false,
    lastSeen: 0,
  };
}

/**
 * Projects a raw normalized video point (0..1) into canvas-normalized coordinates (0..1),
 * exactly matching ArenaRenderer's object-fit: cover scaling + optional horizontal mirroring.
 */
function projectVideoPointToCanvas(
  vx: number,
  vy: number,
  mirror: boolean,
  videoW: number,
  videoH: number,
  canvasW: number,
  canvasH: number,
): Point2D {
  const mx = mirror ? 1 - vx : vx;
  if (canvasW <= 0 || canvasH <= 0 || videoW <= 0 || videoH <= 0) {
    return { x: clamp01(mx), y: clamp01(vy) };
  }
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const dx = (canvasW - drawW) * 0.5;
  const dy = (canvasH - drawH) * 0.5;
  return {
    x: clamp01((dx + mx * drawW) / canvasW),
    y: clamp01((dy + vy * drawH) / canvasH),
  };
}

function lerpPoint(a: Point2D, b: Point2D, alpha: number): Point2D {
  return {
    x: a.x * (1 - alpha) + b.x * alpha,
    y: a.y * (1 - alpha) + b.y * alpha,
  };
}

function lerpAngle(a: number, b: number, alpha: number): number {
  let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * alpha;
}

/**
 * Dual-tier real-time facial anatomy tracker:
 * 1) Primary: MediaPipe FaceLandmarker (478 facial mesh landmarks) for pinpoint recognition of
 *    Head (top crown), Forehead, Nose tip, Left Cheek, Right Cheek, Ears, and live head tilt.
 * 2) Automatic fallback: MediaPipe BlazeFace (6 keypoints + roll-rotated anatomy geometry).
 * Runs throttled at ~22 Hz with responsive EMA smoothing so landed mosquitoes stick naturally
 * to moving heads while preserving 60fps hand tracking.
 */
export class FaceTracker {
  private landmarker: FaceLandmarker | null = null;
  private detector: FaceDetector | null = null;
  private initPromise: Promise<boolean> | null = null;
  private lastDetectMs = 0;
  private anchor: FaceAnchor = createDefaultFaceAnchor();

  public getAnchor(): FaceAnchor {
    return this.anchor;
  }

  public async initialize(): Promise<boolean> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        let vision;
        try {
          vision = await FilesetResolver.forVisionTasks(LOCAL_WASM_ROOT);
        } catch {
          vision = await FilesetResolver.forVisionTasks(CDN_WASM_ROOT);
        }

        // Tier 1: Try full 478-landmark FaceLandmarker first for exact nose/forehead/cheek/head tracking
        try {
          const taskBytes = await this.loadValidatedTaskBuffer();
          try {
            this.landmarker = await FaceLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetBuffer: taskBytes.slice(),
                delegate: 'GPU',
              },
              runningMode: 'VIDEO',
              numFaces: 1,
              minFaceDetectionConfidence: 0.45,
              minFacePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
            });
            return true;
          } catch {
            this.landmarker = await FaceLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetBuffer: taskBytes.slice(),
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numFaces: 1,
              minFaceDetectionConfidence: 0.45,
              minFacePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
              outputFaceBlendshapes: false,
              outputFacialTransformationMatrixes: false,
            });
            return true;
          }
        } catch (lmErr) {
          console.warn('FaceLandmarker unavailable, falling back to BlazeFace:', lmErr);
        }

        // Tier 2: Fall back cleanly to BlazeFace 6-keypoint FaceDetector
        const modelBytes = await this.loadValidatedTfliteBuffer();
        try {
          this.detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetBuffer: modelBytes.slice(),
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.45,
          });
          return true;
        } catch {
          this.detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetBuffer: modelBytes.slice(),
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.45,
          });
          return true;
        }
      } catch (err) {
        console.warn('Face tracking unavailable, using centered face anchor fallback:', err);
        this.landmarker = null;
        this.detector = null;
        return false;
      }
    })();

    return this.initPromise;
  }

  private async loadValidatedTaskBuffer(): Promise<Uint8Array> {
    for (const url of [LOCAL_FACE_LANDMARKER_URL, REMOTE_FACE_LANDMARKER_URL]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength < 1_000_000 || bytes[0] === 0x3c) continue;
        // MediaPipe .task zip bundle may begin at byte 0 or after 2-byte alignment padding
        let hasZipHeader = false;
        for (let offset = 0; offset <= 12; offset++) {
          if (
            bytes[offset] === 0x50 &&
            bytes[offset + 1] === 0x4b &&
            bytes[offset + 2] === 0x03 &&
            bytes[offset + 3] === 0x04
          ) {
            hasZipHeader = true;
            break;
          }
        }
        if (hasZipHeader) {
          return bytes;
        }
      } catch {
        // Try next candidate
      }
    }
    throw new Error('Could not load valid face_landmarker.task bundle.');
  }

  private async loadValidatedTfliteBuffer(): Promise<Uint8Array> {
    for (const url of [LOCAL_BLAZEFACE_URL, REMOTE_BLAZEFACE_URL]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (
          bytes.byteLength > 50_000 &&
          bytes[0] !== 0x3c &&
          bytes[4] === 0x54 &&
          bytes[5] === 0x46 &&
          bytes[6] === 0x4c &&
          bytes[7] === 0x33
        ) {
          return bytes;
        }
      } catch {
        // Try next candidate
      }
    }
    throw new Error('Could not load valid blaze_face_short_range.tflite model.');
  }

  public update(
    video: HTMLVideoElement,
    nowMs: number,
    mirror: boolean,
    canvasW = 0,
    canvasH = 0,
  ): FaceAnchor {
    if (
      (!this.landmarker && !this.detector) ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      if (nowMs - this.anchor.lastSeen > 1200) {
        this.anchor.detected = false;
      }
      return this.anchor;
    }

    // Throttle to ~22 Hz (~45ms) so landed mosquitoes stay glued to a moving nose/cheek/forehead/head
    if (nowMs - this.lastDetectMs < 45) {
      return this.anchor;
    }
    this.lastDetectMs = nowMs;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cw = canvasW > 0 ? canvasW : vw;
    const ch = canvasH > 0 ? canvasH : vh;

    if (this.landmarker) {
      return this.updateFromLandmarker(video, nowMs, mirror, vw, vh, cw, ch);
    }
    return this.updateFromBlazeFace(video, nowMs, mirror, vw, vh, cw, ch);
  }

  private updateFromLandmarker(
    video: HTMLVideoElement,
    nowMs: number,
    mirror: boolean,
    vw: number,
    vh: number,
    cw: number,
    ch: number,
  ): FaceAnchor {
    let result;
    try {
      result = this.landmarker!.detectForVideo(video, nowMs);
    } catch {
      return this.anchor;
    }

    const lms = result?.faceLandmarks?.[0];
    if (!lms || lms.length < 460) {
      if (nowMs - this.anchor.lastSeen > 1200) {
        this.anchor.detected = false;
      }
      return this.anchor;
    }

    const pt = (idx: number): Point2D =>
      projectVideoPointToCanvas(lms[idx].x, lms[idx].y, mirror, vw, vh, cw, ch);

    const avgPts = (indices: number[]): Point2D => {
      let sx = 0;
      let sy = 0;
      for (const idx of indices) {
        const p = pt(idx);
        sx += p.x;
        sy += p.y;
      }
      return { x: sx / indices.length, y: sy / indices.length };
    };

    const hairlineTop = pt(10);
    const chinBottom = pt(152);
    const forehead = avgPts([151, 10, 9]);
    const nose = avgPts([1, 4]);

    // Project top of the head / crown slightly above the hairline along the chin -> hairline axis
    const upAxisX = hairlineTop.x - chinBottom.x;
    const upAxisY = hairlineTop.y - chinBottom.y;
    const headCrown: Point2D = {
      x: clamp01(hairlineTop.x + upAxisX * 0.14),
      y: clamp01(hairlineTop.y + upAxisY * 0.14),
    };

    // Anatomical cheek midpoints (fleshy mid-cheek below eyes, outside nose wings)
    const cheekA = avgPts([50, 205, 118, 123]);
    const cheekB = avgPts([280, 425, 347, 352]);
    const leftCheek = cheekA.x <= cheekB.x ? cheekA : cheekB;
    const rightCheek = cheekA.x <= cheekB.x ? cheekB : cheekA;

    // Ear tragions (outer temporal bounds)
    const earA = pt(234);
    const earB = pt(454);
    const leftEar = earA.x <= earB.x ? earA : earB;
    const rightEar = earA.x <= earB.x ? earB : earA;

    // Head roll angle from outer eye corners (33 & 263) ordered left-to-right on screen
    const eyeCornerA = pt(33);
    const eyeCornerB = pt(263);
    const screenLeftEye = eyeCornerA.x <= eyeCornerB.x ? eyeCornerA : eyeCornerB;
    const screenRightEye = eyeCornerA.x <= eyeCornerB.x ? eyeCornerB : eyeCornerA;
    const headRollRad = Math.atan2(
      screenRightEye.y - screenLeftEye.y,
      Math.max(0.001, screenRightEye.x - screenLeftEye.x),
    );

    const faceCenter = {
      x: (leftEar.x + rightEar.x + nose.x) / 3,
      y: (hairlineTop.y + chinBottom.y) * 0.5,
    };
    const faceSpanX = Math.hypot(rightEar.x - leftEar.x, rightEar.y - leftEar.y);
    const faceSpanY = Math.hypot(chinBottom.x - hairlineTop.x, chinBottom.y - hairlineTop.y);
    const faceRadius = Math.max(0.075, Math.min(0.3, (faceSpanX + faceSpanY) * 0.34));
    const earRadius = Math.max(0.07, faceRadius * 0.78);

    const headOutline = FACE_OVAL_INDICES.map((idx) => pt(idx));

    return this.commitSmoothedAnchor({
      faceCenter,
      faceRadius,
      headRollRad,
      leftEar,
      rightEar,
      earRadius,
      head: headCrown,
      forehead,
      nose,
      leftCheek,
      rightCheek,
      headOutline,
      trackerKind: 'FACE_LANDMARKER',
      nowMs,
    });
  }

  private updateFromBlazeFace(
    video: HTMLVideoElement,
    nowMs: number,
    mirror: boolean,
    vw: number,
    vh: number,
    cw: number,
    ch: number,
  ): FaceAnchor {
    let result;
    try {
      result = this.detector!.detectForVideo(video, nowMs);
    } catch {
      return this.anchor;
    }

    const face = result?.detections?.[0];
    if (!face || !face.boundingBox) {
      if (nowMs - this.anchor.lastSeen > 1200) {
        this.anchor.detected = false;
      }
      return this.anchor;
    }

    const bb = face.boundingBox;
    const proj = (vx: number, vy: number) =>
      projectVideoPointToCanvas(vx, vy, mirror, vw, vh, cw, ch);

    const rawCenterX = (bb.originX + bb.width * 0.5) / vw;
    const rawCenterY = (bb.originY + bb.height * 0.5) / vh;
    const topLeft = proj(bb.originX / vw, bb.originY / vh);
    const botRight = proj((bb.originX + bb.width) / vw, (bb.originY + bb.height) / vh);
    const faceW = Math.abs(botRight.x - topLeft.x);
    const faceH = Math.abs(botRight.y - topLeft.y);
    const faceCenter = proj(rawCenterX, rawCenterY);
    const faceRadius = Math.max(0.075, Math.min(0.3, (faceW + faceH) * 0.34));
    const earRadius = Math.max(0.07, faceRadius * 0.78);

    let leftEye = { x: faceCenter.x - faceW * 0.2, y: faceCenter.y - faceH * 0.14 };
    let rightEye = { x: faceCenter.x + faceW * 0.2, y: faceCenter.y - faceH * 0.14 };
    let nose = { x: faceCenter.x, y: faceCenter.y + faceH * 0.04 };
    let mouth = { x: faceCenter.x, y: faceCenter.y + faceH * 0.24 };
    let earA = { x: faceCenter.x - faceW * 0.52, y: faceCenter.y };
    let earB = { x: faceCenter.x + faceW * 0.52, y: faceCenter.y };

    if (face.keypoints && face.keypoints.length >= 6) {
      const k0 = proj(face.keypoints[0].x, face.keypoints[0].y);
      const k1 = proj(face.keypoints[1].x, face.keypoints[1].y);
      leftEye = k0.x <= k1.x ? k0 : k1;
      rightEye = k0.x <= k1.x ? k1 : k0;
      nose = proj(face.keypoints[2].x, face.keypoints[2].y);
      mouth = proj(face.keypoints[3].x, face.keypoints[3].y);
      earA = proj(face.keypoints[4].x, face.keypoints[4].y);
      earB = proj(face.keypoints[5].x, face.keypoints[5].y);
    }

    const leftEar = earA.x <= earB.x ? earA : earB;
    const rightEar = earA.x <= earB.x ? earB : earA;

    const headRollRad = Math.atan2(
      rightEye.y - leftEye.y,
      Math.max(0.001, rightEye.x - leftEye.x),
    );

    const eyeMid = { x: (leftEye.x + rightEye.x) * 0.5, y: (leftEye.y + rightEye.y) * 0.5 };
    // Perpendicular "head up" direction vector aligned with actual head tilt
    const upX = Math.sin(headRollRad);
    const upY = -Math.cos(headRollRad);
    const forehead: Point2D = {
      x: clamp01(eyeMid.x + upX * faceH * 0.27),
      y: clamp01(eyeMid.y + upY * faceH * 0.27),
    };
    const headCrown: Point2D = {
      x: clamp01(eyeMid.x + upX * faceH * 0.58),
      y: clamp01(eyeMid.y + upY * faceH * 0.58),
    };

    const leftCheek: Point2D = {
      x: clamp01(leftEye.x * 0.45 + leftEar.x * 0.3 + nose.x * 0.15 + mouth.x * 0.1),
      y: clamp01(nose.y * 0.55 + mouth.y * 0.25 + leftEye.y * 0.2),
    };
    const rightCheek: Point2D = {
      x: clamp01(rightEye.x * 0.45 + rightEar.x * 0.3 + nose.x * 0.15 + mouth.x * 0.1),
      y: clamp01(nose.y * 0.55 + mouth.y * 0.25 + rightEye.y * 0.2),
    };

    return this.commitSmoothedAnchor({
      faceCenter,
      faceRadius,
      headRollRad,
      leftEar,
      rightEar,
      earRadius,
      head: headCrown,
      forehead,
      nose,
      leftCheek,
      rightCheek,
      headOutline: undefined,
      trackerKind: 'BLAZEFACE',
      nowMs,
    });
  }

  private commitSmoothedAnchor(next: {
    faceCenter: Point2D;
    faceRadius: number;
    headRollRad: number;
    leftEar: Point2D;
    rightEar: Point2D;
    earRadius: number;
    head: Point2D;
    forehead: Point2D;
    nose: Point2D;
    leftCheek: Point2D;
    rightCheek: Point2D;
    headOutline?: Point2D[];
    trackerKind: 'FACE_LANDMARKER' | 'BLAZEFACE';
    nowMs: number;
  }): FaceAnchor {
    const prev = this.anchor;
    const alpha = prev.detected ? 0.56 : 1.0;

    const smoothedRadius = prev.faceRadius * (1 - alpha) + next.faceRadius * alpha;
    const headPt = lerpPoint(prev.zones.HEAD.point, next.head, alpha);
    const foreheadPt = lerpPoint(prev.zones.FOREHEAD.point, next.forehead, alpha);
    const nosePt = lerpPoint(prev.zones.NOSE.point, next.nose, alpha);
    const leftCheekPt = lerpPoint(prev.zones.LEFT_CHEEK.point, next.leftCheek, alpha);
    const rightCheekPt = lerpPoint(prev.zones.RIGHT_CHEEK.point, next.rightCheek, alpha);

    let smoothedOutline = next.headOutline;
    if (
      next.headOutline &&
      prev.detected &&
      prev.headOutline &&
      prev.headOutline.length === next.headOutline.length
    ) {
      smoothedOutline = next.headOutline.map((p, i) =>
        lerpPoint(prev.headOutline![i], p, alpha),
      );
    }

    this.anchor = {
      faceCenter: lerpPoint(prev.faceCenter, next.faceCenter, alpha),
      faceRadius: smoothedRadius,
      headRollRad: lerpAngle(prev.headRollRad, next.headRollRad, alpha),
      leftEar: lerpPoint(prev.leftEar, next.leftEar, alpha),
      rightEar: lerpPoint(prev.rightEar, next.rightEar, alpha),
      earRadius: prev.earRadius * (1 - alpha) + next.earRadius * alpha,
      zones: buildZonesRecord(
        headPt,
        foreheadPt,
        nosePt,
        leftCheekPt,
        rightCheekPt,
        smoothedRadius,
      ),
      headOutline: smoothedOutline,
      trackerKind: next.trackerKind,
      detected: true,
      lastSeen: next.nowMs,
    };

    return this.anchor;
  }

  public dispose(): void {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
    }
    if (this.detector) {
      this.detector.close();
      this.detector = null;
    }
  }
}
