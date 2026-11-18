import {
  AttackEvent,
  BodyRegionId,
  BodyTrackingFrame,
  FaceAnchor,
  FaceLandingZone,
  GameSettings,
  GestureState,
  HandSide,
  MosquitoEntity,
  Point2D,
  TrackedHand,
} from '../types/game';
import { isFaceLandingZone } from './BodyTracker';
import { ALL_FACE_LANDING_ZONES } from './FaceTracker';

export interface GestureFrameOutput {
  state: GestureState;
  attack: AttackEvent | null;
  clapReadiness: number; // 0..1 visual indicator of palms closing in
  slapReadiness: number; // 0..1 visual indicator of fast single-hand swing
  palmDistance: number | null;
}

function pointToSegmentDist2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lenSq = vx * vx + vy * vy;
  if (lenSq <= 1e-6) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / lenSq));
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

/**
 * Deterministic 6-state Gesture Recognition State Machine:
 *   IDLE -> HAND_DETECTED -> ATTACK_PREPARATION -> ATTACK_IN_PROGRESS
 *        -> ATTACK_CONFIRMED -> ATTACK_COOLDOWN
 *
 * Strictly filters normal hand motion so everyday hand positioning never fires attacks,
 * while also detecting direct face/head smacks when the player hits their own forehead,
 * cheeks, nose, or head to kill a mosquito perched there.
 */
export class GestureStateMachine {
  private state: GestureState = GestureState.IDLE;
  private cooldownUntil = 0;
  private confirmedUntil = 0;

  // Clap tracking state
  private prevPalmDistance: number | null = null;
  private prevClapSampleTime = 0;
  private peakSeparationDistance = 0;
  private clapPrepTimestamp = 0;
  private clapLockedUntilReopen = false;

  // Single-hand slap tracking per hand
  private slapStreakFrames: Record<HandSide, number> = { Left: 0, Right: 0 };
  private slapStartPoint: Record<HandSide, Point2D | null> = { Left: null, Right: null };
  private slapPeakSpeed: Record<HandSide, number> = { Left: 0, Right: 0 };

  // Tracks which hand was already resting motionless over a facial zone or perched mosquito
  private prevFaceZoneOverlap: Set<string> = new Set();
  private prevLandedMosqOverlap: Set<string> = new Set();
  private attackCounter = 0;

  public getState(): GestureState {
    return this.state;
  }

  public reset(): void {
    this.state = GestureState.IDLE;
    this.cooldownUntil = 0;
    this.confirmedUntil = 0;
    this.prevPalmDistance = null;
    this.prevClapSampleTime = 0;
    this.peakSeparationDistance = 0;
    this.clapPrepTimestamp = 0;
    this.clapLockedUntilReopen = false;
    this.slapStreakFrames = { Left: 0, Right: 0 };
    this.slapStartPoint = { Left: null, Right: null };
    this.slapPeakSpeed = { Left: 0, Right: 0 };
    this.prevFaceZoneOverlap.clear();
    this.prevLandedMosqOverlap.clear();
  }

  public update(
    hands: TrackedHand[],
    nowMs: number,
    settings: GameSettings,
    viewportWidth: number,
    mosquitoes?: MosquitoEntity[],
    faceAnchor?: FaceAnchor,
    bodyFrame?: BodyTrackingFrame,
  ): GestureFrameOutput {
    // Resolution- and DPR-independent hit radius (consistent feel from 320px phones to 4K TVs)
    const normalizedHitRadius = settings.hitDetectionRadius / Math.max(1080, Math.min(1440, viewportWidth || 1280));

    // 1. Cooldown phase prevents duplicate attacks from a single motion
    if (nowMs < this.cooldownUntil) {
      // Keep tracking palm reopening & face-zone overlap during cooldown
      const palmDist = this.measurePalmDistance(hands);
      if (palmDist !== null && palmDist > settings.clapProximityThreshold * 1.45) {
        this.clapLockedUntilReopen = false;
        this.peakSeparationDistance = palmDist;
      }
      this.prevPalmDistance = palmDist;
      this.prevClapSampleTime = nowMs;
      this.syncFaceOverlapState(hands, mosquitoes, faceAnchor, normalizedHitRadius);
      this.state = nowMs < this.confirmedUntil ? GestureState.ATTACK_CONFIRMED : GestureState.ATTACK_COOLDOWN;
      return {
        state: this.state,
        attack: null,
        clapReadiness: 0,
        slapReadiness: 0,
        palmDistance: palmDist,
      };
    }

    // 2. No hands visible => IDLE
    if (hands.length === 0) {
      this.state = GestureState.IDLE;
      this.prevPalmDistance = null;
      this.peakSeparationDistance = 0;
      this.clapLockedUntilReopen = false;
      this.slapStreakFrames.Left = 0;
      this.slapStreakFrames.Right = 0;
      this.prevFaceZoneOverlap.clear();
      this.prevLandedMosqOverlap.clear();
      return {
        state: this.state,
        attack: null,
        clapReadiness: 0,
        slapReadiness: 0,
        palmDistance: null,
      };
    }

    // 3. Direct FACE / BODY SMACK check:
    // When a mosquito is perched/biting anywhere on the player's face, neck, arms, hands, or legs,
    // swatting or patting that spot kills it immediately on contact.
    const hasTrackedBody = Boolean(faceAnchor?.detected || (bodyFrame && bodyFrame.visibleRegions.length > 0));
    if (mosquitoes && mosquitoes.length > 0 && hasTrackedBody) {
      const bodySmack = this.evaluateFaceZoneSmack(
        hands,
        mosquitoes,
        faceAnchor,
        nowMs,
        settings,
        viewportWidth,
        bodyFrame,
      );
      if (bodySmack) {
        return {
          state: GestureState.ATTACK_CONFIRMED,
          attack: bodySmack,
          clapReadiness: 0,
          slapReadiness: 1,
          palmDistance: this.measurePalmDistance(hands),
        };
      }
    } else {
      this.syncFaceOverlapState(hands, mosquitoes, faceAnchor, normalizedHitRadius);
    }

    // 4. Evaluate TWO-HAND CLAP gesture first (higher priority than single-hand slap)
    let clapReadiness = 0;
    const palmDistance = this.measurePalmDistance(hands);

    if (hands.length >= 2 && palmDistance !== null) {
      const h1 = hands[0];
      const h2 = hands[1];

      // Unlock clap once palms have separated meaningfully again
      if (palmDistance > settings.clapProximityThreshold * 1.45) {
        this.clapLockedUntilReopen = false;
      }

      if (palmDistance > this.peakSeparationDistance) {
        this.peakSeparationDistance = palmDistance;
      }

      // Compute closing velocity (positive means hands approaching each other)
      let closingSpeed = 0;
      if (this.prevPalmDistance !== null && nowMs > this.prevClapSampleTime) {
        const dt = Math.max(0.01, (nowMs - this.prevClapSampleTime) / 1000);
        closingSpeed = (this.prevPalmDistance - palmDistance) / dt;
      }

      // Check hands are actually moving toward each other along the line connecting them
      const dx = h2.palm.x - h1.palm.x;
      const dy = h2.palm.y - h1.palm.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      const nx = dx / dist;
      const ny = dy / dist;
      const h1TowardH2 = h1.vx * nx + h1.vy * ny;
      const h2TowardH1 = -(h2.vx * nx + h2.vy * ny);
      const approachVel = Math.max(closingSpeed, h1TowardH2 + h2TowardH1);

      const hasValidOpening = this.peakSeparationDistance >= settings.clapProximityThreshold * 1.55;
      const distanceDrop = this.peakSeparationDistance - palmDistance;

      if (!this.clapLockedUntilReopen && hasValidOpening) {
        if (approachVel > settings.clapClosingSpeedThreshold * 0.45 && distanceDrop > 0.03) {
          this.clapPrepTimestamp = nowMs;
          clapReadiness = Math.min(
            1,
            Math.max(
              0,
              (this.peakSeparationDistance - palmDistance) /
                Math.max(0.05, this.peakSeparationDistance - settings.clapProximityThreshold),
            ),
          );
        }

        const withinClapPrepWindow = nowMs - this.clapPrepTimestamp < 420;
        const fastClosing = approachVel >= settings.clapClosingSpeedThreshold;
        const distanceDroppedEnough = distanceDrop >= Math.max(0.075, settings.clapProximityThreshold * 0.58);

        if (
          palmDistance <= settings.clapProximityThreshold &&
          distanceDroppedEnough &&
          (fastClosing || withinClapPrepWindow)
        ) {
          // Confirmed CLAP attack at midpoint between both palms
          const midpoint: Point2D = {
            x: (h1.palm.x + h2.palm.x) * 0.5,
            y: (h1.palm.y + h2.palm.y) * 0.5,
          };
          const clapRadius = Math.max(
            normalizedHitRadius * 1.18,
            (h1.palmRadius + h2.palmRadius) * 0.72,
          );

          const attack: AttackEvent = {
            id: `atk-clap-${++this.attackCounter}`,
            kind: 'CLAP',
            timestamp: nowMs,
            position: midpoint,
            direction: { x: nx, y: ny },
            radius: clapRadius,
            trajectory: [h1.palm, midpoint, h2.palm],
            palmDistance,
            handSide: 'Both',
          };

          this.triggerConfirmedCooldown(nowMs, settings.attackCooldownMs);
          this.clapLockedUntilReopen = true;
          this.peakSeparationDistance = palmDistance;
          this.prevPalmDistance = palmDistance;
          this.prevClapSampleTime = nowMs;
          this.slapStreakFrames.Left = 0;
          this.slapStreakFrames.Right = 0;

          return {
            state: GestureState.ATTACK_CONFIRMED,
            attack,
            clapReadiness: 1,
            slapReadiness: 0,
            palmDistance,
          };
        }
      }

      this.prevPalmDistance = palmDistance;
      this.prevClapSampleTime = nowMs;
    } else {
      this.prevPalmDistance = null;
      this.peakSeparationDistance = 0;
    }

    // 5. Evaluate SINGLE-HAND RAPID SLAP gesture (works for left or right hand)
    // Suppress single-hand slap if both hands are actively closing into a clap
    let bestSlapReadiness = 0;
    if (clapReadiness < 0.55) {
      const slapThresh = settings.slapVelocityThreshold;

      for (const hand of hands) {
        const side = hand.side;
        const speedRatio = hand.speed / Math.max(0.3, slapThresh);
        bestSlapReadiness = Math.max(bestSlapReadiness, Math.min(1, speedRatio));

        if (hand.speed >= slapThresh) {
          if (this.slapStreakFrames[side] === 0) {
            const oldest = hand.history[Math.max(0, hand.history.length - 4)] ?? hand.palm;
            this.slapStartPoint[side] = { x: oldest.x, y: oldest.y };
            this.slapPeakSpeed[side] = hand.speed;
          } else {
            this.slapPeakSpeed[side] = Math.max(this.slapPeakSpeed[side], hand.speed);
          }
          this.slapStreakFrames[side] += 1;

          // Require at least 2 consecutive rapid frames AND meaningful swept displacement so jitter never fires
          const startPt = this.slapStartPoint[side] ?? hand.palm;
          const displacement = Math.hypot(hand.palm.x - startPt.x, hand.palm.y - startPt.y);

          if (this.slapStreakFrames[side] >= 2 && displacement >= 0.065) {
            const recentPath: Point2D[] = hand.history
              .filter((pt) => nowMs - pt.time <= 135)
              .map((pt) => ({ x: pt.x, y: pt.y }));

            if (recentPath.length < 2) {
              recentPath.unshift(startPt);
              recentPath.push({ ...hand.palm });
            }

            const dirLen = Math.max(0.0001, Math.hypot(hand.vx, hand.vy));
            const attack: AttackEvent = {
              id: `atk-slap-${++this.attackCounter}`,
              kind: 'SLAP',
              timestamp: nowMs,
              position: { ...hand.palm },
              direction: { x: hand.vx / dirLen, y: hand.vy / dirLen },
              radius: Math.max(normalizedHitRadius * 0.92, hand.palmRadius * 0.9),
              trajectory: recentPath,
              handSide: side,
            };

            this.triggerConfirmedCooldown(nowMs, settings.attackCooldownMs);
            this.slapStreakFrames.Left = 0;
            this.slapStreakFrames.Right = 0;
            this.slapStartPoint.Left = null;
            this.slapStartPoint.Right = null;

            return {
              state: GestureState.ATTACK_CONFIRMED,
              attack,
              clapReadiness: 0,
              slapReadiness: 1,
              palmDistance,
            };
          }
        } else {
          // Decay streak when hand slows down
          this.slapStreakFrames[side] = 0;
          this.slapStartPoint[side] = null;
          this.slapPeakSpeed[side] = 0;
        }
      }
    }

    // 6. Assign intermediate FSM state based on motion energy
    if (clapReadiness >= 0.65 || bestSlapReadiness >= 0.85) {
      this.state = GestureState.ATTACK_IN_PROGRESS;
    } else if (clapReadiness >= 0.25 || bestSlapReadiness >= 0.45) {
      this.state = GestureState.ATTACK_PREPARATION;
    } else {
      this.state = GestureState.HAND_DETECTED;
    }

    return {
      state: this.state,
      attack: null,
      clapReadiness,
      slapReadiness: bestSlapReadiness,
      palmDistance,
    };
  }

  /**
   * Detects when the player directly hits/pats the spot on their forehead, cheek, nose, or head
   * where a mosquito is perched (or touching down). Works for both Standalone and TV Display modes.
   */
  public evaluateFaceZoneSmack(
    hands: TrackedHand[],
    mosquitoes: MosquitoEntity[],
    faceAnchor: FaceAnchor | undefined,
    nowMs: number,
    settings: GameSettings,
    viewportWidth: number,
    bodyFrame?: BodyTrackingFrame,
  ): AttackEvent | null {
    const normalizedHitRadius = settings.hitDetectionRadius / Math.max(1080, Math.min(1440, viewportWidth || 1280));
    const hasTrackedBody = Boolean(faceAnchor?.detected || (bodyFrame && bodyFrame.visibleRegions.length > 0));

    if (nowMs < this.cooldownUntil || hands.length === 0 || !hasTrackedBody) {
      this.syncFaceOverlapState(hands, mosquitoes, faceAnchor, normalizedHitRadius);
      return null;
    }

    const perched = mosquitoes.filter((m) => {
      if (!m.alive) return false;
      const targetRegion = m.landingBodyRegion ?? m.landingZone;
      if (!targetRegion) return false;
      if (m.animState === 'LANDED') return true;
      if (m.animState === 'APPROACHING_LANDING') {
        const bodyPt = bodyFrame?.regions[targetRegion]?.point;
        const facePt =
          isFaceLandingZone(targetRegion) && faceAnchor?.zones
            ? faceAnchor.zones[targetRegion]?.point
            : undefined;
        const anchorPt = bodyPt ?? facePt;
        if (anchorPt && Math.hypot(m.x - anchorPt.x, m.y - anchorPt.y) < 0.085) {
          return true;
        }
      }
      return false;
    });

    if (perched.length === 0) {
      this.syncFaceOverlapState(hands, mosquitoes, faceAnchor, normalizedHitRadius);
      return null;
    }

    const nextZoneOverlap = new Set<string>();
    const nextMosqOverlap = new Set<string>();
    let triggeredAttack: AttackEvent | null = null;

    for (const hand of hands) {
      const contactPoints = this.getHandContactPoints(hand);
      const recentTrail = hand.history
        .filter((pt) => nowMs - pt.time <= 110)
        .map((pt) => ({ x: pt.x, y: pt.y }));

      if (faceAnchor?.detected && faceAnchor.zones) {
        for (const zk of ALL_FACE_LANDING_ZONES) {
          const za = faceAnchor.zones[zk];
          if (!za) continue;
          const zoneRadius = Math.max(za.radius * 1.15, hand.palmRadius * 0.95, 0.055);
          if (this.minContactDistance(contactPoints, recentTrail, za.point.x, za.point.y) <= zoneRadius) {
            nextZoneOverlap.add(`${hand.side}:${zk}`);
          }
        }
      }

      if (triggeredAttack) continue;

      for (const m of perched) {
        const regionKey = (m.landingBodyRegion ?? m.landingZone) as BodyRegionId;
        // Do not let the bitten hand accidentally auto-slap itself without brisk motion
        const isSameHand =
          (regionKey === 'LEFT_HAND' && hand.side === 'Left') ||
          (regionKey === 'RIGHT_HAND' && hand.side === 'Right');
        if (isSameHand && hand.speed < 0.65) continue;

        const faceZoneKey: FaceLandingZone | undefined = isFaceLandingZone(regionKey)
          ? regionKey
          : undefined;
        const faceZoneAnchor = faceZoneKey && faceAnchor?.zones ? faceAnchor.zones[faceZoneKey] : undefined;
        const bodyRegionAnchor = bodyFrame?.regions[regionKey];
        const mosqKey = `${hand.side}:${m.id}`;
        const zoneOverlapKey = `${hand.side}:${regionKey}`;

        const smackRadius = Math.max(
          hand.palmRadius * 1.25,
          normalizedHitRadius * 1.05,
          faceZoneAnchor ? faceZoneAnchor.radius * 1.15 : bodyRegionAnchor ? bodyRegionAnchor.scale * 1.2 : 0.06,
          0.064,
        );

        const distToMosq = this.minContactDistance(contactPoints, recentTrail, m.x, m.y);
        const isTouchingMosq = distToMosq <= smackRadius;

        if (isTouchingMosq) {
          nextMosqOverlap.add(mosqKey);

          const wasAlreadyOnMosq = this.prevLandedMosqOverlap.has(mosqKey);
          const wasAlreadyRestingOnZone = this.prevFaceZoneOverlap.has(zoneOverlapKey);

          const freshArrival = !wasAlreadyOnMosq && (!wasAlreadyRestingOnZone || hand.speed >= 0.14);
          const activeTapOrSlap = hand.speed >= 0.28;

          if (freshArrival || activeTapOrSlap) {
            const dirLen = Math.max(0.0001, Math.hypot(hand.vx, hand.vy));
            const trajectory: Point2D[] =
              recentTrail.length >= 2
                ? [...recentTrail, { x: m.x, y: m.y }]
                : [
                    { x: hand.palm.x, y: hand.palm.y },
                    { x: m.x, y: m.y },
                  ];

            triggeredAttack = {
              id: `atk-bodyslap-${++this.attackCounter}`,
              kind: 'SLAP',
              timestamp: nowMs,
              position: { x: m.x, y: m.y },
              direction: { x: hand.vx / dirLen, y: hand.vy / dirLen },
              radius: Math.max(normalizedHitRadius * 1.08, smackRadius * 0.95),
              trajectory,
              handSide: hand.side,
              faceZone: faceZoneKey,
              bodyRegion: regionKey,
            };

            this.triggerConfirmedCooldown(nowMs, Math.min(260, settings.attackCooldownMs));
            this.slapStreakFrames.Left = 0;
            this.slapStreakFrames.Right = 0;
            this.slapStartPoint.Left = null;
            this.slapStartPoint.Right = null;
            break;
          }
        }
      }
    }

    this.prevFaceZoneOverlap = nextZoneOverlap;
    this.prevLandedMosqOverlap = nextMosqOverlap;
    return triggeredAttack;
  }

  private syncFaceOverlapState(
    hands: TrackedHand[],
    mosquitoes: MosquitoEntity[] | undefined,
    faceAnchor: FaceAnchor | undefined,
    normalizedHitRadius: number,
  ): void {
    const nextZones = new Set<string>();
    const nextMosqs = new Set<string>();

    if (hands.length > 0 && faceAnchor?.detected && faceAnchor.zones) {
      for (const hand of hands) {
        const contactPoints = this.getHandContactPoints(hand);
        for (const zk of ALL_FACE_LANDING_ZONES) {
          const za = faceAnchor.zones[zk];
          if (!za) continue;
          const zoneRadius = Math.max(za.radius * 1.15, hand.palmRadius * 0.95, 0.055);
          if (this.minContactDistance(contactPoints, [], za.point.x, za.point.y) <= zoneRadius) {
            nextZones.add(`${hand.side}:${zk}`);
          }
        }
        if (mosquitoes) {
          for (const m of mosquitoes) {
            if (!m.alive || m.animState !== 'LANDED') continue;
            const r = Math.max(hand.palmRadius * 1.25, normalizedHitRadius * 1.05, 0.064);
            if (this.minContactDistance(contactPoints, [], m.x, m.y) <= r) {
              nextMosqs.add(`${hand.side}:${m.id}`);
            }
          }
        }
      }
    }

    this.prevFaceZoneOverlap = nextZones;
    this.prevLandedMosqOverlap = nextMosqs;
  }

  private getHandContactPoints(hand: TrackedHand): Point2D[] {
    const pts: Point2D[] = [hand.palm];
    const lms = hand.landmarks;
    if (lms && lms.length >= 21) {
      // Upper palm / flat finger-pad center (hits forehead, cheeks, and top of head naturally)
      pts.push({
        x: (lms[9].x + lms[12].x) * 0.5,
        y: (lms[9].y + lms[12].y) * 0.5,
      });
      pts.push({
        x: (lms[5].x + lms[8].x) * 0.5,
        y: (lms[5].y + lms[8].y) * 0.5,
      });
      // Primary fingertips (index 8, middle 12, ring 16, pinky 20)
      pts.push({ x: lms[8].x, y: lms[8].y });
      pts.push({ x: lms[12].x, y: lms[12].y });
      pts.push({ x: lms[16].x, y: lms[16].y });
      pts.push({ x: lms[20].x, y: lms[20].y });
    }
    return pts;
  }

  private minContactDistance(
    contactPoints: Point2D[],
    recentTrail: Point2D[],
    tx: number,
    ty: number,
  ): number {
    let minDist = Infinity;
    for (const pt of contactPoints) {
      const d = Math.hypot(pt.x - tx, pt.y - ty);
      if (d < minDist) minDist = d;
    }
    for (let i = 0; i < recentTrail.length - 1; i++) {
      const d = pointToSegmentDist2D(
        tx,
        ty,
        recentTrail[i].x,
        recentTrail[i].y,
        recentTrail[i + 1].x,
        recentTrail[i + 1].y,
      );
      if (d < minDist) minDist = d;
    }
    return minDist;
  }

  /**
   * Explicit helper for optional Practice Mode (mouse/touch fallback when user has no physical webcam).
   * Uses the exact same AttackEvent & CollisionEngine pipeline.
   */
  public createPracticeAttack(
    kind: 'CLAP' | 'SLAP',
    trajectory: Point2D[],
    nowMs: number,
    settings: GameSettings,
    viewportWidth: number,
  ): AttackEvent | null {
    if (nowMs < this.cooldownUntil) return null;
    if (trajectory.length === 0) return null;

    const last = trajectory[trajectory.length - 1];
    const first = trajectory[0];
    const dx = last.x - first.x;
    const dy = last.y - first.y;
    const len = Math.max(0.001, Math.hypot(dx, dy));
    const normalizedHitRadius = settings.hitDetectionRadius / Math.max(1080, Math.min(1440, viewportWidth || 1280));

    const attack: AttackEvent = {
      id: `atk-prac-${++this.attackCounter}`,
      kind,
      timestamp: nowMs,
      position: { ...last },
      direction: { x: dx / len, y: dy / len },
      radius: kind === 'CLAP' ? normalizedHitRadius * 1.15 : normalizedHitRadius * 0.92,
      trajectory,
      handSide: kind === 'CLAP' ? 'Both' : 'Right',
    };

    this.triggerConfirmedCooldown(nowMs, Math.min(260, settings.attackCooldownMs));
    return attack;
  }

  private triggerConfirmedCooldown(nowMs: number, cooldownMs: number): void {
    this.state = GestureState.ATTACK_CONFIRMED;
    this.confirmedUntil = nowMs + 110;
    this.cooldownUntil = nowMs + Math.max(160, cooldownMs);
  }

  private measurePalmDistance(hands: TrackedHand[]): number | null {
    if (hands.length < 2) return null;
    return Math.hypot(hands[0].palm.x - hands[1].palm.x, hands[0].palm.y - hands[1].palm.y);
  }
}
