import {
  BiteNotification,
  BiteRecord,
  BiteSimulationSettings,
  BiteStatistics,
  BiteVisualStyle,
  BodyLandmarkReference,
  BodyRegionCategory,
  BodyRegionId,
  BodyTrackingFrame,
  FaceAnchor,
  Point2D,
  TrackedHand,
} from '../types/game';
import { BODY_REGION_CATEGORY, BODY_REGION_LABELS } from '../vision/BodyTracker';

export const BITE_VISUAL_STYLES: BiteVisualStyle[] = [
  'SMALL_RED_CIRCLE',
  'RAISED_BUMP',
  'SWOLLEN_PATCH',
  'PULSATING_MARK',
  'ITCHING_MARK',
];

export const BITE_STYLE_LABELS: Record<BiteVisualStyle, string> = {
  SMALL_RED_CIRCLE: 'Small Red Bite',
  RAISED_BUMP: 'Raised Bump',
  SWOLLEN_PATCH: 'Swollen Patch',
  PULSATING_MARK: 'Pulsating Bite',
  ITCHING_MARK: 'Itching Bite',
};

export function createEmptyBiteStatistics(): BiteStatistics {
  return {
    totalBites: 0,
    activeBiteMarks: 0,
    faceBites: 0,
    armBites: 0,
    neckBites: 0,
    handBites: 0,
    legBites: 0,
    bitesPerMosquito: {},
    bitesByRegion: {},
    mostBittenRegion: null,
    mostBittenRegionLabel: 'None yet',
    mostBittenRegionCount: 0,
    bitingKills: 0,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Manages exact landmark-relative mosquito bite locations, smooth movement tracking,
 * virtual swelling visual lifecycles, bite counters, and chronological bite history.
 * All coordinates are stored in normalized webcam space (0..1) so marks remain anchored
 * across player movement, distance changes, and screen resolution changes.
 */
export class BiteLocationManager {
  private bites: BiteRecord[] = [];
  private idSeq = 0;
  private notifSeq = 0;
  private lastStyleIndex = -1;
  private bitingKills = 0;

  public getActiveBites(): BiteRecord[] {
    return this.bites.filter((b) => b.animationState !== 'HEALED');
  }

  public getAllBites(): BiteRecord[] {
    return this.bites;
  }

  public getStatistics(): BiteStatistics {
    const stats = createEmptyBiteStatistics();
    stats.totalBites = this.bites.length;
    stats.bitingKills = this.bitingKills;

    let topRegion: BodyRegionId | null = null;
    let topCount = 0;

    for (const b of this.bites) {
      if (b.animationState !== 'HEALED') {
        stats.activeBiteMarks++;
      }

      switch (b.category) {
        case 'FACE':
          stats.faceBites++;
          break;
        case 'ARM':
          stats.armBites++;
          break;
        case 'NECK':
          stats.neckBites++;
          break;
        case 'HAND':
          stats.handBites++;
          break;
        case 'LEG':
          stats.legBites++;
          break;
      }

      stats.bitesPerMosquito[b.mosquitoId] = (stats.bitesPerMosquito[b.mosquitoId] ?? 0) + 1;
      const nextRegionCount = (stats.bitesByRegion[b.region] ?? 0) + 1;
      stats.bitesByRegion[b.region] = nextRegionCount;

      if (nextRegionCount > topCount) {
        topCount = nextRegionCount;
        topRegion = b.region;
      }
    }

    stats.mostBittenRegion = topRegion;
    stats.mostBittenRegionCount = topCount;
    stats.mostBittenRegionLabel = topRegion ? BODY_REGION_LABELS[topRegion] : 'None yet';

    return stats;
  }

  /**
   * Registers a single confirmed bite event and returns the created record,
   * formatted real-time bite notification, and refreshed statistics snapshot.
   */
  public registerBite(params: {
    mosquitoId: string;
    region: BodyRegionId;
    point: Point2D;
    landmarkRef: BodyLandmarkReference;
    nowMs: number;
    biteSettings: BiteSimulationSettings;
    depthScale?: number;
  }): {
    record: BiteRecord;
    notification: BiteNotification;
    stats: BiteStatistics;
  } {
    const { mosquitoId, region, point, landmarkRef, nowMs, biteSettings } = params;
    const category: BodyRegionCategory = BODY_REGION_CATEGORY[region];
    const regionLabel = BODY_REGION_LABELS[region];

    const prevCountOnRegion = this.bites.filter((b) => b.region === region).length;
    const prevCountOnCategory = this.bites.filter((b) => b.category === category).length;

    const style = this.pickNextStyle();
    const visibilityDurationMs = clamp(biteSettings.biteVisibilityDurationSec, 5, 60) * 1000;

    // Slight organic variety in base swelling size & intensity per bite
    const styleSizeMultiplier =
      style === 'SMALL_RED_CIRCLE'
        ? 0.78
        : style === 'SWOLLEN_PATCH'
          ? 1.28
          : style === 'RAISED_BUMP'
            ? 0.96
            : style === 'PULSATING_MARK'
              ? 1.08
              : 1.02;

    const record: BiteRecord = {
      id: `bite-${++this.idSeq}`,
      mosquitoId,
      region,
      regionLabel,
      category,
      landmarkRef: {
        ...landmarkRef,
        localOffset: { ...landmarkRef.localOffset },
      },
      normalizedX: clamp(point.x, 0.02, 0.98),
      normalizedY: clamp(point.y, 0.02, 0.98),
      timestamp: Date.now(),
      createdAtPerfMs: nowMs,
      swellingSize: styleSizeMultiplier * randRange(0.92, 1.14),
      swellingIntensity: randRange(0.78, 1.18),
      visualStyle: style,
      animationState: 'APPEARING',
      healingStatus: 'FRESH',
      opacity: 0.05,
      depthScale: clamp(params.depthScale ?? 1.0, 0.55, 1.8),
      visibilityDurationMs,
      attachedVisible: true,
      killedDuringBite: false,
    };

    // Newest first for immediate display in Bite History Panel
    this.bites.unshift(record);
    if (this.bites.length > 120) {
      this.bites.length = 120;
    }

    const upperLabel = regionLabel.toUpperCase();
    const message =
      prevCountOnRegion > 0 || prevCountOnCategory >= 2
        ? `OUCH! Another bite on your ${upperLabel}!`
        : `OUCH! Mosquito bit your ${upperLabel}!`;

    const notification: BiteNotification = {
      id: `bnotif-${++this.notifSeq}`,
      message,
      regionLabel,
      category,
      createdAt: nowMs,
      kind: 'BITE',
    };

    return {
      record,
      notification,
      stats: this.getStatistics(),
    };
  }

  /**
   * Marks that a biting mosquito was killed at this bite location without removing the swelling mark.
   */
  public markKilledDuringBite(biteId?: string): BiteStatistics {
    this.bitingKills += 1;
    if (biteId) {
      const target = this.bites.find((b) => b.id === biteId);
      if (target) {
        target.killedDuringBite = true;
      }
    }
    return this.getStatistics();
  }

  /**
   * Updates all active bite marks every frame:
   * - Re-projects each bite from its face/pose/hand landmark reference in normalized coords.
   * - Applies smooth interpolation to eliminate jitter as the player moves.
   * - Advances appearance, active swelling, and healing fade-out animations.
   */
  public update(
    dtSec: number,
    nowMs: number,
    faceAnchor: FaceAnchor,
    bodyFrame: BodyTrackingFrame,
    hands: TrackedHand[],
    biteSettings: BiteSimulationSettings,
  ): void {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));
    const smoothAlpha = Math.min(1, dt * 19);
    const scaleAlpha = Math.min(1, dt * 10);
    const configuredDurationMs = clamp(biteSettings.biteVisibilityDurationSec, 5, 60) * 1000;

    for (const bite of this.bites) {
      if (bite.animationState === 'HEALED') continue;

      const ageMs = Math.max(0, nowMs - bite.createdAtPerfMs);
      const totalDurationMs = Math.max(3000, configuredDurationMs);
      bite.visibilityDurationMs = totalDurationMs;

      // 1. Resolve live landmark-relative normalized target position
      const resolved = this.resolveLandmarkPosition(bite.landmarkRef, faceAnchor, bodyFrame, hands);
      if (resolved) {
        bite.attachedVisible = true;
        bite.normalizedX += (resolved.x - bite.normalizedX) * smoothAlpha;
        bite.normalizedY += (resolved.y - bite.normalizedY) * smoothAlpha;
        bite.depthScale += (resolved.depthScale - bite.depthScale) * scaleAlpha;
      } else {
        // Hide temporarily if the body part stepped completely out of camera view
        bite.attachedVisible = false;
      }

      // 2. Advance bite visual lifecycle (smooth pop-in -> inflamed active -> healing fade-out)
      const appearMs = 420;
      const healStartMs = totalDurationMs * 0.72;

      if (ageMs >= totalDurationMs) {
        bite.animationState = 'HEALED';
        bite.healingStatus = 'HEALED';
        bite.opacity = 0;
      } else if (ageMs < appearMs) {
        bite.animationState = 'APPEARING';
        bite.healingStatus = 'FRESH';
        const t = clamp(ageMs / appearMs, 0, 1);
        // Smooth ease-out cubic appear
        bite.opacity = 1 - Math.pow(1 - t, 3);
      } else if (ageMs < healStartMs) {
        bite.animationState = 'ACTIVE';
        bite.healingStatus = 'INFLAMED';
        bite.opacity = 1;
      } else {
        bite.animationState = 'HEALING';
        bite.healingStatus = 'FADING';
        const fadeProgress = clamp((ageMs - healStartMs) / Math.max(500, totalDurationMs - healStartMs), 0, 1);
        bite.opacity = Math.pow(1 - fadeProgress, 1.4);
      }
    }
  }

  /**
   * Immediately clears all active visible bite marks from the webcam overlay
   * (triggered by the Reset Bite Marks button).
   */
  public clearActiveBiteMarks(): BiteStatistics {
    for (const bite of this.bites) {
      if (bite.animationState !== 'HEALED') {
        bite.animationState = 'HEALED';
        bite.healingStatus = 'HEALED';
        bite.opacity = 0;
        bite.attachedVisible = false;
      }
    }
    return this.getStatistics();
  }

  /**
   * Full session reset (clears bite marks, history, and counters on New Game / Reset).
   */
  public resetSession(): BiteStatistics {
    this.bites = [];
    this.bitingKills = 0;
    return this.getStatistics();
  }

  private resolveLandmarkPosition(
    ref: BodyLandmarkReference,
    faceAnchor: FaceAnchor,
    bodyFrame: BodyTrackingFrame,
    hands: TrackedHand[],
  ): { x: number; y: number; depthScale: number } | null {
    const regionAnchor = bodyFrame.regions[ref.region];
    const baseScale = Math.max(0.02, ref.referenceScale || 0.06);

    if (regionAnchor) {
      let basePt: Point2D = regionAnchor.point;
      if (
        regionAnchor.segmentStart &&
        regionAnchor.segmentEnd &&
        typeof ref.segmentT === 'number'
      ) {
        const t = clamp(ref.segmentT, 0.08, 0.92);
        basePt = {
          x: regionAnchor.segmentStart.x + (regionAnchor.segmentEnd.x - regionAnchor.segmentStart.x) * t,
          y: regionAnchor.segmentStart.y + (regionAnchor.segmentEnd.y - regionAnchor.segmentStart.y) * t,
        };
      }

      const scaleRatio = clamp(regionAnchor.scale / baseScale, 0.55, 1.85);
      const cosA = Math.cos(regionAnchor.axisAngleRad);
      const sinA = Math.sin(regionAnchor.axisAngleRad);
      const lx = ref.localOffset.x * scaleRatio;
      const ly = ref.localOffset.y * scaleRatio;

      return {
        x: clamp(basePt.x + lx * cosA - ly * sinA, 0.015, 0.985),
        y: clamp(basePt.y + lx * sinA + ly * cosA, 0.015, 0.985),
        depthScale: clamp(regionAnchor.scale / 0.055, 0.65, 1.75),
      };
    }

    // Direct fallback for face regions if faceAnchor is still active
    if (ref.source === 'FACE' && faceAnchor.detected) {
      let basePt: Point2D | null = null;
      if (ref.region === 'CHIN' && faceAnchor.chin) {
        basePt = faceAnchor.chin;
      } else if (ref.region in faceAnchor.zones) {
        basePt = faceAnchor.zones[ref.region as keyof typeof faceAnchor.zones]?.point ?? null;
      }
      if (basePt) {
        const currentScale = Math.max(0.03, faceAnchor.faceRadius * 0.34);
        const scaleRatio = clamp(currentScale / baseScale, 0.55, 1.85);
        const cosA = Math.cos(faceAnchor.headRollRad);
        const sinA = Math.sin(faceAnchor.headRollRad);
        const lx = ref.localOffset.x * scaleRatio;
        const ly = ref.localOffset.y * scaleRatio;
        return {
          x: clamp(basePt.x + lx * cosA - ly * sinA, 0.015, 0.985),
          y: clamp(basePt.y + lx * sinA + ly * cosA, 0.015, 0.985),
          depthScale: clamp(faceAnchor.faceRadius / 0.14, 0.65, 1.75),
        };
      }
    }

    // Direct fallback for hands if HandTracker sees the hand
    if (ref.source === 'HAND') {
      const side = ref.region === 'LEFT_HAND' ? 'Left' : 'Right';
      const hand = hands.find((h) => h.side === side);
      if (hand) {
        const scaleRatio = clamp(hand.palmRadius / baseScale, 0.55, 1.85);
        return {
          x: clamp(hand.palm.x + ref.localOffset.x * scaleRatio, 0.015, 0.985),
          y: clamp(hand.palm.y + ref.localOffset.y * scaleRatio, 0.015, 0.985),
          depthScale: clamp(hand.palmRadius / 0.055, 0.65, 1.7),
        };
      }
    }

    return null;
  }

  private pickNextStyle(): BiteVisualStyle {
    let next = Math.floor(Math.random() * BITE_VISUAL_STYLES.length);
    if (next === this.lastStyleIndex) {
      next = (next + 1 + Math.floor(Math.random() * (BITE_VISUAL_STYLES.length - 1))) % BITE_VISUAL_STYLES.length;
    }
    this.lastStyleIndex = next;
    return BITE_VISUAL_STYLES[next];
  }
}
