import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  BodyRegionAnchor,
  BodyRegionCategory,
  BodyRegionId,
  BodyTrackingFrame,
  FaceAnchor,
  FaceLandingZone,
  Point2D,
  PoseLandmarkPoint,
  TrackedHand,
} from '../types/game';

const LOCAL_WASM_ROOT = '/mediapipe/wasm';
const CDN_WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

const LOCAL_POSE_LANDMARKER_URL = '/models/pose_landmarker_lite.task';
const REMOTE_POSE_LANDMARKER_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const BODY_REGION_LABELS: Record<BodyRegionId, string> = {
  HEAD: 'Head',
  FOREHEAD: 'Forehead',
  LEFT_CHEEK: 'Left Cheek',
  RIGHT_CHEEK: 'Right Cheek',
  NOSE: 'Nose',
  CHIN: 'Chin',
  NECK: 'Neck',
  LEFT_SHOULDER: 'Left Shoulder',
  RIGHT_SHOULDER: 'Right Shoulder',
  LEFT_UPPER_ARM: 'Left Upper Arm',
  RIGHT_UPPER_ARM: 'Right Upper Arm',
  LEFT_ELBOW: 'Left Elbow',
  RIGHT_ELBOW: 'Right Elbow',
  LEFT_FOREARM: 'Left Forearm',
  RIGHT_FOREARM: 'Right Forearm',
  LEFT_HAND: 'Left Hand',
  RIGHT_HAND: 'Right Hand',
  LEFT_THIGH: 'Left Thigh',
  RIGHT_THIGH: 'Right Thigh',
  LEFT_KNEE: 'Left Knee',
  RIGHT_KNEE: 'Right Knee',
  LEFT_SHIN: 'Left Lower Leg',
  RIGHT_SHIN: 'Right Lower Leg',
};

export const BODY_REGION_CATEGORY: Record<BodyRegionId, BodyRegionCategory> = {
  HEAD: 'FACE',
  FOREHEAD: 'FACE',
  LEFT_CHEEK: 'FACE',
  RIGHT_CHEEK: 'FACE',
  NOSE: 'FACE',
  CHIN: 'FACE',
  NECK: 'NECK',
  LEFT_SHOULDER: 'ARM',
  RIGHT_SHOULDER: 'ARM',
  LEFT_UPPER_ARM: 'ARM',
  RIGHT_UPPER_ARM: 'ARM',
  LEFT_ELBOW: 'ARM',
  RIGHT_ELBOW: 'ARM',
  LEFT_FOREARM: 'ARM',
  RIGHT_FOREARM: 'ARM',
  LEFT_HAND: 'HAND',
  RIGHT_HAND: 'HAND',
  LEFT_THIGH: 'LEG',
  RIGHT_THIGH: 'LEG',
  LEFT_KNEE: 'LEG',
  RIGHT_KNEE: 'LEG',
  LEFT_SHIN: 'LEG',
  RIGHT_SHIN: 'LEG',
};

export function isFaceLandingZone(region: BodyRegionId): region is FaceLandingZone {
  return (
    region === 'HEAD' ||
    region === 'FOREHEAD' ||
    region === 'NOSE' ||
    region === 'LEFT_CHEEK' ||
    region === 'RIGHT_CHEEK'
  );
}

export function createEmptyBodyTrackingFrame(): BodyTrackingFrame {
  return {
    regions: {},
    visibleRegions: [],
    poseLandmarks: [],
    poseDetected: false,
    segmentationActive: false,
    bodyScale: 0.28,
    lastSeen: 0,
  };
}

function clamp01(v: number): number {
  return Math.max(0.015, Math.min(0.985, v));
}

function isInFrame(p: Point2D, margin = 0.03): boolean {
  return p.x >= margin && p.x <= 1 - margin && p.y >= margin && p.y <= 1 - margin;
}

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
    return { x: mx, y: vy };
  }
  const scale = Math.max(canvasW / videoW, canvasH / videoH);
  const drawW = videoW * scale;
  const drawH = videoH * scale;
  const dx = (canvasW - drawW) * 0.5;
  const dy = (canvasH - drawH) * 0.5;
  return {
    x: (dx + mx * drawW) / canvasW,
    y: (dy + vy * drawH) / canvasH,
  };
}

function lerp(a: number, b: number, alpha: number): number {
  return a * (1 - alpha) + b * alpha;
}

/**
 * Local MediaPipe PoseLandmarker + FaceAnchor + HandTracker body landmark integrator.
 * Detects forehead, cheeks, nose, chin, neck, shoulders, upper arms, elbows, forearms,
 * hands, and visible legs in canvas-normalized webcam coordinates (0..1), using optional
 * person segmentation masks to verify body regions against the background.
 */
export class BodyTracker {
  private poseLandmarker: PoseLandmarker | null = null;
  private initPromise: Promise<boolean> | null = null;
  private lastDetectMs = 0;
  private smoothedPose: PoseLandmarkPoint[] = [];
  private smoothedRawPose: Array<{ x: number; y: number }> = [];
  private segmentationAvailable = false;
  private lastSegmentationScores: number[] = [];
  private lastPoseSeenMs = 0;
  private frame: BodyTrackingFrame = createEmptyBodyTrackingFrame();

  public getFrame(): BodyTrackingFrame {
    return this.frame;
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

        const taskBytes = await this.loadValidatedTaskBuffer();

        // Try GPU with segmentation masks -> CPU with segmentation masks -> CPU without masks
        const configs: Array<{ delegate: 'GPU' | 'CPU'; seg: boolean }> = [
          { delegate: 'GPU', seg: true },
          { delegate: 'CPU', seg: true },
          { delegate: 'CPU', seg: false },
        ];

        for (const cfg of configs) {
          try {
            this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetBuffer: taskBytes.slice(),
                delegate: cfg.delegate,
              },
              runningMode: 'VIDEO',
              numPoses: 1,
              minPoseDetectionConfidence: 0.45,
              minPosePresenceConfidence: 0.45,
              minTrackingConfidence: 0.45,
              outputSegmentationMasks: cfg.seg,
            });
            this.segmentationAvailable = cfg.seg;
            return true;
          } catch {
            // Try next fallback configuration
          }
        }
        return false;
      } catch (err) {
        console.warn('PoseLandmarker unavailable, continuing with face & hand body anchors:', err);
        this.poseLandmarker = null;
        return false;
      }
    })();

    return this.initPromise;
  }

  private async loadValidatedTaskBuffer(): Promise<Uint8Array> {
    for (const url of [LOCAL_POSE_LANDMARKER_URL, REMOTE_POSE_LANDMARKER_URL]) {
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength < 1_000_000 || bytes[0] === 0x3c) continue;
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
        // Try next URL
      }
    }
    throw new Error('Could not load valid pose_landmarker_lite.task bundle.');
  }

  public update(
    video: HTMLVideoElement | null,
    nowMs: number,
    mirror: boolean,
    faceAnchor: FaceAnchor,
    hands: TrackedHand[],
    canvasW = 0,
    canvasH = 0,
  ): BodyTrackingFrame {
    const canRunPose =
      Boolean(this.poseLandmarker) &&
      Boolean(video) &&
      video!.readyState >= 2 &&
      video!.videoWidth > 0 &&
      video!.videoHeight > 0;

    // Run MediaPipe PoseLandmarker throttled at ~19 Hz (~52ms) to sustain 60fps gameplay
    if (canRunPose && video && nowMs - this.lastDetectMs >= 52) {
      this.lastDetectMs = nowMs;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cw = canvasW > 0 ? canvasW : vw;
      const ch = canvasH > 0 ? canvasH : vh;

      try {
        const result = this.poseLandmarker!.detectForVideo(video, nowMs);
        const lms = result?.landmarks?.[0];
        const segMask = result?.segmentationMasks?.[0];

        if (lms && lms.length >= 29) {
          const hadPose = this.smoothedPose.length === lms.length && nowMs - this.lastPoseSeenMs < 700;
          const alpha = hadPose ? 0.5 : 1.0;

          const nextPose: PoseLandmarkPoint[] = new Array(lms.length);
          const nextRaw: Array<{ x: number; y: number }> = new Array(lms.length);

          for (let i = 0; i < lms.length; i++) {
            const raw = lms[i];
            const projected = projectVideoPointToCanvas(raw.x, raw.y, mirror, vw, vh, cw, ch);
            const vis = typeof raw.visibility === 'number' ? raw.visibility : 0.7;
            if (hadPose) {
              const prev = this.smoothedPose[i];
              nextPose[i] = {
                x: lerp(prev.x, projected.x, alpha),
                y: lerp(prev.y, projected.y, alpha),
                z: lerp(prev.z, raw.z ?? 0, alpha),
                visibility: lerp(prev.visibility, vis, 0.55),
              };
            } else {
              nextPose[i] = {
                x: projected.x,
                y: projected.y,
                z: raw.z ?? 0,
                visibility: vis,
              };
            }
            nextRaw[i] = { x: raw.x, y: raw.y };
          }

          this.smoothedPose = nextPose;
          this.smoothedRawPose = nextRaw;
          this.lastPoseSeenMs = nowMs;

          // Sample person foreground segmentation confidence per landmark to reject background noise
          if (segMask) {
            try {
              this.lastSegmentationScores = this.sampleSegmentationAtLandmarks(segMask, nextRaw);
            } finally {
              segMask.close();
            }
          } else {
            this.lastSegmentationScores = [];
          }
        } else if (segMask) {
          segMask.close();
        }
      } catch {
        // Keep last smoothed pose briefly on transient inference errors
      }
    }

    const poseFresh = this.smoothedPose.length >= 29 && nowMs - this.lastPoseSeenMs < 950;
    const regions: Partial<Record<BodyRegionId, BodyRegionAnchor>> = {};
    const pose = poseFresh ? this.smoothedPose : [];

    // Estimate overall body scale from shoulder distance or face radius for player-distance adaptation
    let bodyScale = faceAnchor.detected ? Math.max(0.16, faceAnchor.faceRadius * 2.35) : 0.28;
    if (poseFresh && pose[11].visibility >= 0.45 && pose[12].visibility >= 0.45) {
      const shoulderSpan = Math.hypot(pose[12].x - pose[11].x, pose[12].y - pose[11].y);
      if (shoulderSpan > 0.08 && shoulderSpan < 0.95) {
        bodyScale = shoulderSpan;
      }
    }

    // 1. FACE REGIONS (from FaceLandmarker / BlazeFace for pinpoint facial accuracy)
    if (faceAnchor.detected && faceAnchor.zones) {
      const fScale = Math.max(0.055, faceAnchor.faceRadius);
      const roll = faceAnchor.headRollRad;

      const addFaceRegion = (
        region: BodyRegionId,
        point: Point2D,
        primaryIdx: number,
        radiusFactor: number,
      ) => {
        if (!isInFrame(point, 0.02)) return;
        regions[region] = {
          region,
          category: 'FACE',
          label: BODY_REGION_LABELS[region],
          point: { x: clamp01(point.x), y: clamp01(point.y) },
          axisAngleRad: roll,
          scale: Math.max(0.022, fScale * radiusFactor),
          visibility: 0.98,
          source: 'FACE',
          primaryLandmarkIndex: primaryIdx,
        };
      };

      addFaceRegion('HEAD', faceAnchor.zones.HEAD.point, 10, 0.42);
      addFaceRegion('FOREHEAD', faceAnchor.zones.FOREHEAD.point, 151, 0.36);
      addFaceRegion('NOSE', faceAnchor.zones.NOSE.point, 1, 0.24);
      addFaceRegion('LEFT_CHEEK', faceAnchor.zones.LEFT_CHEEK.point, 205, 0.32);
      addFaceRegion('RIGHT_CHEEK', faceAnchor.zones.RIGHT_CHEEK.point, 425, 0.32);

      const chinPt = faceAnchor.chin ?? {
        x: clamp01(faceAnchor.faceCenter.x - Math.sin(roll) * fScale * 0.78),
        y: clamp01(faceAnchor.faceCenter.y + Math.cos(roll) * fScale * 0.78),
      };
      addFaceRegion('CHIN', chinPt, 152, 0.28);
    }

    // Helper checking pose landmark visibility + frame bounds + segmentation foreground probability
    const isPosePointVisible = (idx: number, minVis = 0.48): boolean => {
      if (!poseFresh || idx >= pose.length) return false;
      const lm = pose[idx];
      if (lm.visibility < minVis) return false;
      if (!isInFrame(lm, 0.025)) return false;
      if (this.lastSegmentationScores.length > idx) {
        // Segmentation score >= 0.22 confirms landmark belongs to foreground person rather than background
        if (this.lastSegmentationScores[idx] < 0.22) return false;
      }
      return true;
    };

    const getSegWeight = (idx: number): number => {
      if (this.lastSegmentationScores.length > idx) {
        return Math.max(0.25, this.lastSegmentationScores[idx]);
      }
      return 0.85;
    };

    // 2. NECK REGION (from Pose shoulders + Face chin, or close-up chin fallback)
    const leftShoulderVis = isPosePointVisible(11, 0.42);
    const rightShoulderVis = isPosePointVisible(12, 0.42);
    if (leftShoulderVis && rightShoulderVis) {
      const sL = pose[11];
      const sR = pose[12];
      const midShoulder = { x: (sL.x + sR.x) * 0.5, y: (sL.y + sR.y) * 0.5 };
      const topRef =
        faceAnchor.detected && faceAnchor.chin
          ? faceAnchor.chin
          : isPosePointVisible(0, 0.4)
            ? pose[0]
            : { x: midShoulder.x, y: midShoulder.y - bodyScale * 0.4 };
      const neckPt = {
        x: clamp01(midShoulder.x * 0.62 + topRef.x * 0.38),
        y: clamp01(midShoulder.y * 0.58 + topRef.y * 0.42),
      };
      if (isInFrame(neckPt, 0.025)) {
        const shoulderAngle = Math.atan2(sR.y - sL.y, sR.x - sL.x);
        regions.NECK = {
          region: 'NECK',
          category: 'NECK',
          label: BODY_REGION_LABELS.NECK,
          point: neckPt,
          axisAngleRad: Math.abs(shoulderAngle) > Math.PI * 0.5 ? shoulderAngle - Math.PI : shoulderAngle,
          scale: Math.max(0.035, bodyScale * 0.22),
          visibility: Math.min(sL.visibility, sR.visibility),
          source: 'POSE',
          primaryLandmarkIndex: 11,
          secondaryLandmarkIndex: 12,
          segmentStart: { x: sL.x, y: sL.y },
          segmentEnd: { x: sR.x, y: sR.y },
        };
      }
    } else if (faceAnchor.detected && faceAnchor.chin) {
      // Close-up camera framing where shoulders are below frame edge: infer upper neck below chin
      const roll = faceAnchor.headRollRad;
      const neckPt = {
        x: faceAnchor.chin.x - Math.sin(roll) * faceAnchor.faceRadius * 0.34,
        y: faceAnchor.chin.y + Math.cos(roll) * faceAnchor.faceRadius * 0.34,
      };
      if (isInFrame(neckPt, 0.035)) {
        regions.NECK = {
          region: 'NECK',
          category: 'NECK',
          label: BODY_REGION_LABELS.NECK,
          point: { x: clamp01(neckPt.x), y: clamp01(neckPt.y) },
          axisAngleRad: roll,
          scale: Math.max(0.032, faceAnchor.faceRadius * 0.36),
          visibility: 0.78,
          source: 'FACE',
          primaryLandmarkIndex: 152,
        };
      }
    }

    // Helper for pose single-joint anchors (shoulders, elbows, knees)
    const addPoseJoint = (
      region: BodyRegionId,
      idx: number,
      neighborIdx: number,
      scaleFactor: number,
      minVis = 0.48,
    ) => {
      if (!isPosePointVisible(idx, minVis)) return;
      const p = pose[idx];
      const n = pose[neighborIdx];
      const angle =
        n && n.visibility >= 0.3
          ? Math.atan2(n.y - p.y, n.x - p.x)
          : 0;
      regions[region] = {
        region,
        category: BODY_REGION_CATEGORY[region],
        label: BODY_REGION_LABELS[region],
        point: { x: clamp01(p.x), y: clamp01(p.y) },
        axisAngleRad: angle,
        scale: Math.max(0.028, bodyScale * scaleFactor),
        visibility: p.visibility * getSegWeight(idx),
        source: 'POSE',
        primaryLandmarkIndex: idx,
        secondaryLandmarkIndex: neighborIdx,
      };
    };

    // Helper for pose limb-segment anchors (upper arms, forearms, thighs, lower legs)
    const addPoseSegment = (
      region: BodyRegionId,
      startIdx: number,
      endIdx: number,
      scaleFactor: number,
      minVis = 0.48,
    ) => {
      if (!isPosePointVisible(startIdx, minVis) || !isPosePointVisible(endIdx, minVis)) return;
      const a = pose[startIdx];
      const b = pose[endIdx];
      const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      if (segLen < 0.03 || !isInFrame(mid, 0.025)) return;

      regions[region] = {
        region,
        category: BODY_REGION_CATEGORY[region],
        label: BODY_REGION_LABELS[region],
        point: { x: clamp01(mid.x), y: clamp01(mid.y) },
        axisAngleRad: Math.atan2(b.y - a.y, b.x - a.x),
        scale: Math.max(0.026, Math.min(bodyScale * scaleFactor, segLen * 0.45)),
        visibility: Math.min(a.visibility, b.visibility) * Math.min(getSegWeight(startIdx), getSegWeight(endIdx)),
        source: 'POSE',
        primaryLandmarkIndex: startIdx,
        secondaryLandmarkIndex: endIdx,
        segmentStart: { x: a.x, y: a.y },
        segmentEnd: { x: b.x, y: b.y },
      };
    };

    // 3. SHOULDERS, UPPER ARMS, ELBOWS, FOREARMS
    // MediaPipe Pose: 11=Left Shoulder, 12=Right Shoulder, 13=Left Elbow, 14=Right Elbow, 15=Left Wrist, 16=Right Wrist
    addPoseJoint('LEFT_SHOULDER', 11, 13, 0.22, 0.45);
    addPoseJoint('RIGHT_SHOULDER', 12, 14, 0.22, 0.45);
    addPoseSegment('LEFT_UPPER_ARM', 11, 13, 0.2, 0.46);
    addPoseSegment('RIGHT_UPPER_ARM', 12, 14, 0.2, 0.46);
    addPoseJoint('LEFT_ELBOW', 13, 15, 0.17, 0.48);
    addPoseJoint('RIGHT_ELBOW', 14, 16, 0.17, 0.48);
    addPoseSegment('LEFT_FOREARM', 13, 15, 0.18, 0.46);
    addPoseSegment('RIGHT_FOREARM', 14, 16, 0.18, 0.46);

    // 4. HANDS (prefer high-precision HandTracker palms, fall back to Pose wrist/index landmarks)
    const addHandRegion = (side: 'Left' | 'Right', region: 'LEFT_HAND' | 'RIGHT_HAND', wristIdx: number, fingerIdx: number) => {
      const tracked = hands.find((h) => h.side === side);
      if (tracked && isInFrame(tracked.palm, 0.03)) {
        const wrist = tracked.landmarks[0];
        const midMcp = tracked.landmarks[9];
        const handAngle =
          wrist && midMcp ? Math.atan2(midMcp.y - wrist.y, midMcp.x - wrist.x) : 0;
        regions[region] = {
          region,
          category: 'HAND',
          label: BODY_REGION_LABELS[region],
          point: { x: clamp01(tracked.palm.x), y: clamp01(tracked.palm.y) },
          axisAngleRad: handAngle,
          scale: Math.max(0.03, tracked.palmRadius),
          visibility: Math.max(0.75, tracked.confidence),
          source: 'HAND',
          primaryLandmarkIndex: 9,
        };
        return;
      }

      if (isPosePointVisible(wristIdx, 0.5)) {
        const w = pose[wristIdx];
        const f = pose[fingerIdx];
        const pt =
          f && f.visibility >= 0.4
            ? { x: w.x * 0.45 + f.x * 0.55, y: w.y * 0.45 + f.y * 0.55 }
            : { x: w.x, y: w.y };
        if (isInFrame(pt, 0.03)) {
          regions[region] = {
            region,
            category: 'HAND',
            label: BODY_REGION_LABELS[region],
            point: { x: clamp01(pt.x), y: clamp01(pt.y) },
            axisAngleRad: f ? Math.atan2(f.y - w.y, f.x - w.x) : 0,
            scale: Math.max(0.028, bodyScale * 0.16),
            visibility: w.visibility * getSegWeight(wristIdx),
            source: 'POSE',
            primaryLandmarkIndex: wristIdx,
            secondaryLandmarkIndex: fingerIdx,
          };
        }
      }
    };

    addHandRegion('Left', 'LEFT_HAND', 15, 19);
    addHandRegion('Right', 'RIGHT_HAND', 16, 20);

    // 5. VISIBLE LEGS (strict visibility + frame-bounds check so legs only activate when camera shows them!)
    // MediaPipe Pose: 23=Left Hip, 24=Right Hip, 25=Left Knee, 26=Right Knee, 27=Left Ankle, 28=Right Ankle
    addPoseSegment('LEFT_THIGH', 23, 25, 0.24, 0.55);
    addPoseSegment('RIGHT_THIGH', 24, 26, 0.24, 0.55);
    addPoseJoint('LEFT_KNEE', 25, 27, 0.2, 0.58);
    addPoseJoint('RIGHT_KNEE', 26, 28, 0.2, 0.58);
    addPoseSegment('LEFT_SHIN', 25, 27, 0.2, 0.55);
    addPoseSegment('RIGHT_SHIN', 26, 28, 0.2, 0.55);

    const visibleRegions = Object.keys(regions) as BodyRegionId[];

    this.frame = {
      regions,
      visibleRegions,
      poseLandmarks: pose,
      poseDetected: poseFresh,
      segmentationActive: this.segmentationAvailable && this.lastSegmentationScores.length > 0,
      bodyScale,
      lastSeen: visibleRegions.length > 0 ? nowMs : this.frame.lastSeen,
    };

    return this.frame;
  }

  private sampleSegmentationAtLandmarks(
    mask: {
      width: number;
      height: number;
      hasFloat32Array: () => boolean;
      hasUint8Array: () => boolean;
      getAsFloat32Array: () => Float32Array;
      getAsUint8Array: () => Uint8Array;
    },
    rawLandmarks: Array<{ x: number; y: number }>,
  ): number[] {
    const mw = mask.width;
    const mh = mask.height;
    if (mw <= 0 || mh <= 0) return [];

    let floatBuf: Float32Array | null = null;
    let uintBuf: Uint8Array | null = null;
    try {
      if (mask.hasFloat32Array()) {
        floatBuf = mask.getAsFloat32Array();
      } else if (mask.hasUint8Array()) {
        uintBuf = mask.getAsUint8Array();
      } else {
        floatBuf = mask.getAsFloat32Array();
      }
    } catch {
      return [];
    }

    const samplePx = (ix: number, iy: number): number => {
      const cx = Math.max(0, Math.min(mw - 1, ix));
      const cy = Math.max(0, Math.min(mh - 1, iy));
      const idx = cy * mw + cx;
      if (floatBuf) return floatBuf[idx] ?? 0;
      if (uintBuf) return (uintBuf[idx] ?? 0) / 255;
      return 0.8;
    };

    const scores = new Array<number>(rawLandmarks.length);
    for (let i = 0; i < rawLandmarks.length; i++) {
      const lm = rawLandmarks[i];
      const px = Math.round(lm.x * (mw - 1));
      const py = Math.round(lm.y * (mh - 1));
      // 3x3 max-blended sample prevents thin limbs/wrists from dropping below foreground threshold
      let maxVal = 0;
      let sumVal = 0;
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const v = samplePx(px + ox, py + oy);
          if (v > maxVal) maxVal = v;
          sumVal += v;
          count++;
        }
      }
      scores[i] = maxVal * 0.65 + (sumVal / Math.max(1, count)) * 0.35;
    }
    return scores;
  }

  public dispose(): void {
    if (this.poseLandmarker) {
      this.poseLandmarker.close();
      this.poseLandmarker = null;
    }
    this.smoothedPose = [];
    this.smoothedRawPose = [];
    this.lastSegmentationScores = [];
    this.frame = createEmptyBodyTrackingFrame();
  }
}
