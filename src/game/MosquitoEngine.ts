import { DIFFICULTY_PROFILES } from '../config/defaults';
import {
  BodyLandmarkReference,
  BodyRegionAnchor,
  BodyRegionCategory,
  BodyRegionId,
  BodyTrackingFrame,
  DifficultyLevel,
  FaceAnchor,
  FaceLandingEvent,
  FaceLandingZone,
  FlightPattern,
  GameSettings,
  MosquitoEntity,
  Point2D,
  SwarmAcousticMetrics,
  TrackedHand,
} from '../types/game';
import {
  BODY_REGION_CATEGORY,
  BODY_REGION_LABELS,
  isFaceLandingZone,
} from '../vision/BodyTracker';
import { ALL_FACE_LANDING_ZONES, FACE_ZONE_LABELS } from '../vision/FaceTracker';

const ALL_PATTERNS: FlightPattern[] = [
  'WANDERING',
  'ZIGZAG',
  'CIRCULAR',
  'HOVERING',
  'SUDDEN_ESCAPE',
  'APPROACH_CAMERA',
  'RETREAT_CAMERA',
];

const CATEGORY_LANDING_TAUNTS: Record<BodyRegionCategory, string[]> = {
  FACE: ['Right on your face!', 'Prime cheek perch!', 'Don’t slap yourself!', 'Boop! Snack time!'],
  NECK: ['Ooh, cozy neck!', 'Right on your neck!', 'Ticklish spot!'],
  ARM: ['Free arm buffet!', 'Nice arm landing pad!', 'Sippin’ on your arm!'],
  HAND: ['Landed on your hand!', 'Bold perch right here!', 'Hold still!'],
  LEG: ['Sneaky leg snack!', 'Down on your leg!', 'Got your leg!'],
};

const ESCAPE_TAUNTS = ['Gotcha! Hehe!', 'Yummy snack!', 'Too slow!', 'Buzzed & fed!'];

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export class MosquitoEngine {
  private mosquitoes: MosquitoEntity[] = [];
  private idCounter = 0;
  private patternBias: Partial<Record<FlightPattern, number>> = {};
  private nextBodyLandingMs = 0;
  private lastLandingRegion: BodyRegionId | null = null;
  private prevFaceCenter: Point2D | null = null;

  public getMosquitoes(): MosquitoEntity[] {
    return this.mosquitoes;
  }

  public getLivingCount(): number {
    let count = 0;
    for (const m of this.mosquitoes) {
      if (m.alive) count++;
    }
    return count;
  }

  public getClosestDepth(): number {
    let minZ = 1.0;
    for (const m of this.mosquitoes) {
      if (m.alive && m.z < minZ) minZ = m.z;
    }
    return minZ;
  }

  /**
   * Aggregates individual Z-scaled mosquito acoustic energies across the living swarm
   * so SoundManager can reflect overall swarm density in the combined soundscape.
   */
  public getSwarmAcousticMetrics(): SwarmAcousticMetrics {
    let livingCount = 0;
    let totalAcousticEnergy = 0;
    let sumCloseness = 0;
    let peakDepthCloseness = 0;

    for (const m of this.mosquitoes) {
      if (!m.alive) continue;
      livingCount++;
      totalAcousticEnergy += m.buzzVolume;
      const closeness = this.computeDepthCloseness(m.z);
      sumCloseness += closeness;
      if (closeness > peakDepthCloseness) peakDepthCloseness = closeness;
    }

    if (livingCount === 0) {
      return {
        livingCount: 0,
        densityFactor: 0,
        totalAcousticEnergy: 0,
        averageDepthCloseness: 0,
        peakDepthCloseness: 0,
      };
    }

    const countDensity = clamp(Math.log2(livingCount + 1) / 5.2, 0, 1);
    const energyDensity = clamp(totalAcousticEnergy / 12, 0, 1);
    const densityFactor = clamp(countDensity * 0.65 + energyDensity * 0.35, 0, 1);

    return {
      livingCount,
      densityFactor,
      totalAcousticEnergy,
      averageDepthCloseness: sumCloseness / livingCount,
      peakDepthCloseness,
    };
  }

  public setPatternBias(bias: Partial<Record<FlightPattern, number>>): void {
    this.patternBias = bias;
  }

  public reset(initialCount: number, viewportW: number, viewportH: number, difficulty: DifficultyLevel): void {
    this.mosquitoes = [];
    this.nextBodyLandingMs = 0;
    this.lastLandingRegion = null;
    this.prevFaceCenter = null;
    this.addMosquitoes(initialCount, viewportW, viewportH, difficulty);
  }

  public addMosquitoes(
    count: number,
    viewportW: number,
    viewportH: number,
    difficulty: DifficultyLevel,
  ): MosquitoEntity[] {
    const safeCount = Math.max(0, Math.min(100, Math.floor(count)));
    const added: MosquitoEntity[] = [];
    const profile = DIFFICULTY_PROFILES[difficulty];

    for (let i = 0; i < safeCount; i++) {
      const m = this.createMosquito(viewportW, viewportH, profile.speedScale, profile.hitboxScale);
      this.mosquitoes.push(m);
      added.push(m);
    }
    return added;
  }

  public removeMosquitoes(count: number): number {
    let removed = 0;
    for (let i = this.mosquitoes.length - 1; i >= 0 && removed < count; i--) {
      if (this.mosquitoes[i].alive) {
        this.mosquitoes.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  public attachTaunt(tauntText: string, nowMs: number): void {
    const living = this.mosquitoes.filter((m) => m.alive && (!m.tauntExpiresAt || m.tauntExpiresAt < nowMs));
    if (living.length === 0) return;
    const chosen = living[Math.floor(Math.random() * living.length)];
    chosen.tauntText = tauntText;
    chosen.tauntExpiresAt = nowMs + 2800;
  }

  public assignActiveBiteId(mosquitoId: string, biteId: string): void {
    const m = this.mosquitoes.find((item) => item.id === mosquitoId);
    if (m) {
      m.activeBiteId = biteId;
    }
  }

  public killMosquito(id: string): MosquitoEntity | null {
    const m = this.mosquitoes.find((item) => item.id === id && item.alive);
    if (!m) return null;
    m.alive = false;
    m.health = 0;
    m.animState = 'DYING';
    m.deathTimer = 0;
    m.deathSpin = (Math.random() > 0.5 ? 1 : -1) * randRange(9, 15);
    m.tauntText = undefined;
    this.clearLandingFields(m);
    return m;
  }

  public update(
    dtSec: number,
    viewportW: number,
    viewportH: number,
    settings: GameSettings,
    effectiveDifficulty: DifficultyLevel,
    hands: TrackedHand[],
    nowMs: number,
    faceAnchor?: FaceAnchor,
    allowLanding = true,
    bodyFrame?: BodyTrackingFrame,
  ): FaceLandingEvent[] {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));
    const profile = DIFFICULTY_PROFILES[effectiveDifficulty];
    const speedFactor = profile.speedScale * settings.mosquitoSpeedMultiplier;
    const events: FaceLandingEvent[] = [];

    const biteCfg = settings.bites;
    const eligibleRegions = this.getEligibleRegions(settings, faceAnchor, bodyFrame);
    const anyLandingAllowed = allowLanding && eligibleRegions.length > 0;

    // Measure rapid head shake speed so shaking vigorously can startle landed face mosquitoes
    let headShakeSpeed = 0;
    if (faceAnchor?.detected) {
      if (this.prevFaceCenter) {
        headShakeSpeed =
          Math.hypot(
            faceAnchor.faceCenter.x - this.prevFaceCenter.x,
            faceAnchor.faceCenter.y - this.prevFaceCenter.y,
          ) / dt;
      }
      this.prevFaceCenter = { ...faceAnchor.faceCenter };
    } else {
      this.prevFaceCenter = null;
    }

    // Randomized staggered body/face landing scheduler (never lands all mosquitoes simultaneously)
    if (anyLandingAllowed) {
      const prob = clamp(biteCfg.landingProbability, 0.05, 1.0);
      if (this.nextBodyLandingMs === 0) {
        const initDelay = randRange(1600, 3200) / Math.max(0.45, prob);
        this.nextBodyLandingMs = nowMs + clamp(initDelay, 1200, 5500);
      } else if (nowMs >= this.nextBodyLandingMs) {
        // Individual probability roll scaled by user's landingProbability setting
        if (Math.random() <= Math.min(0.95, 0.25 + prob * 0.75)) {
          this.tryScheduleBodyLanding(eligibleRegions, effectiveDifficulty, faceAnchor, bodyFrame);
        }
        const baseMin =
          effectiveDifficulty === DifficultyLevel.EXTREME
            ? 1900
            : effectiveDifficulty === DifficultyLevel.HARD
              ? 2400
              : effectiveDifficulty === DifficultyLevel.EASY
                ? 4200
                : 2900;
        const baseMax =
          effectiveDifficulty === DifficultyLevel.EXTREME
            ? 3800
            : effectiveDifficulty === DifficultyLevel.HARD
              ? 4800
              : effectiveDifficulty === DifficultyLevel.EASY
                ? 7200
                : 5600;
        const probPace = 1.45 - prob * 0.85; // Higher probability = shorter interval between attempts
        this.nextBodyLandingMs = nowMs + randRange(baseMin * probPace, baseMax * probPace);
      }
    }

    const minBiteDur = clamp(biteCfg.minBitingDurationSec, 1.0, 6.0);
    const maxBiteDur = clamp(Math.max(minBiteDur + 0.2, biteCfg.maxBitingDurationSec), 1.2, 8.0);

    for (let i = this.mosquitoes.length - 1; i >= 0; i--) {
      const m = this.mosquitoes[i];

      // Handle dying animation & cleanup
      if (!m.alive) {
        m.deathTimer += dt;
        m.y += 0.55 * dt;
        m.rotation += m.deathSpin * dt;
        m.screenX = m.x * viewportW;
        m.screenY = m.y * viewportH;
        if (m.deathTimer >= 0.72) {
          m.animState = 'DEAD';
          this.mosquitoes.splice(i, 1);
        }
        continue;
      }

      // Clear expired taunt bubble
      if (m.tauntExpiresAt && nowMs > m.tauntExpiresAt) {
        m.tauntText = undefined;
        m.tauntExpiresAt = undefined;
      }

      // --- SPECIAL STATE A: LANDED & BITING ON BODY / FACE ---
      if (m.pattern === 'LANDED_ON_FACE') {
        const region = m.landingBodyRegion;
        const resolved = region
          ? this.resolveLandingTarget(region, m.landingLandmarkRef, m.landingOffset, faceAnchor, bodyFrame)
          : null;

        if (!allowLanding || !region || !resolved || !this.isRegionAllowedBySettings(region, settings)) {
          this.launchOffBody(m, effectiveDifficulty, false);
          continue;
        }

        m.landingTimer = (m.landingTimer ?? 0) + dt;
        m.landingProgress = Math.min(1, (m.landingProgress ?? 0) + dt * 4.5);
        m.bitePulsePhase = (m.bitePulsePhase ?? 0) + dt * 8.2;
        // Wings stay folded with subtle biting quiver
        m.wingPhase += dt * 7.5;

        // Smooth tight tracking glued onto the player's moving face/arm/neck/hand/leg
        const followT = Math.min(1, dt * 26);
        m.x += (resolved.point.x - m.x) * followT;
        m.y += (resolved.point.y - m.y) * followT;
        m.z += (0.14 - m.z) * Math.min(1, dt * 10);
        m.vx = 0;
        m.vy = 0;
        m.vz = 0;
        m.speed = 0;
        m.animState = 'LANDED';
        m.rotation = clamp(resolved.axisAngleRad * 0.4 + (m.landedAngleOffset ?? 0), -0.95, 0.95);
        m.depthScale = this.computeDepthScale(m.z);
        m.screenX = m.x * viewportW;
        m.screenY = m.y * viewportH;

        const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
        m.hitboxRadiusPx = baseScalePx * m.baseSize * m.depthScale * Math.max(1.0, profile.hitboxScale);

        // Real mosquitoes go quiet right after landing on skin
        m.buzzVolume = 0.04;
        m.buzzPitchHz = m.baseBuzzPitchHz * 0.88;
        m.trail = [];

        const category = BODY_REGION_CATEGORY[region];
        const label = BODY_REGION_LABELS[region];

        // Confirm bite EXACTLY ONCE per landing when piercing timer elapses
        const triggerTime = m.biteTriggerTimeSec ?? 0.65;
        if (biteCfg.enabled && !m.biteConfirmed && m.landingTimer >= triggerTime) {
          m.biteConfirmed = true;
          m.biteConfirmedAt = nowMs;
          events.push({
            type: 'BITE_CONFIRMED',
            mosquitoId: m.id,
            zone: isFaceLandingZone(region) ? region : undefined,
            region,
            category,
            zoneLabel: label,
            point: { x: m.x, y: m.y },
            landmarkRef: m.landingLandmarkRef,
            depthScale: resolved.depthScale,
          });
        }

        // Check takeoff conditions: biting timer completed OR vigorous head shake (for face bites)
        const startledByHeadShake = category === 'FACE' && headShakeSpeed > 1.9 && m.landingTimer > 0.6;
        const finishedBiting = m.landingTimer >= (m.landingDuration ?? 3.0);

        if (finishedBiting) {
          // Safety guard: if duration was very short and bite wasn't confirmed yet, confirm once before escape
          if (biteCfg.enabled && !m.biteConfirmed) {
            m.biteConfirmed = true;
            m.biteConfirmedAt = nowMs;
            events.push({
              type: 'BITE_CONFIRMED',
              mosquitoId: m.id,
              zone: isFaceLandingZone(region) ? region : undefined,
              region,
              category,
              zoneLabel: label,
              point: { x: m.x, y: m.y },
              landmarkRef: m.landingLandmarkRef,
              depthScale: resolved.depthScale,
            });
          }

          events.push({
            type: 'ESCAPED_AFTER_BITE',
            mosquitoId: m.id,
            zone: isFaceLandingZone(region) ? region : undefined,
            region,
            category,
            zoneLabel: label,
            point: { x: m.x, y: m.y },
          });
          m.tauntText = ESCAPE_TAUNTS[Math.floor(Math.random() * ESCAPE_TAUNTS.length)];
          m.tauntExpiresAt = nowMs + 1900;
          this.launchOffBody(m, effectiveDifficulty, true);
        } else if (startledByHeadShake) {
          events.push({
            type: 'TOOK_OFF',
            mosquitoId: m.id,
            zone: isFaceLandingZone(region) ? region : undefined,
            region,
            category,
            zoneLabel: label,
            point: { x: m.x, y: m.y },
          });
          this.launchOffBody(m, effectiveDifficulty, true);
        }
        continue;
      }

      // --- SPECIAL STATE B: APPROACHING A TARGET BODY / FACE LANDMARK ---
      if (m.pattern === 'APPROACH_FACE_ZONE') {
        const region = m.landingBodyRegion;
        const resolved = region
          ? this.resolveLandingTarget(region, m.landingLandmarkRef, m.landingOffset, faceAnchor, bodyFrame)
          : null;

        if (!allowLanding || !region || !resolved || !this.isRegionAllowedBySettings(region, settings)) {
          this.clearLandingFields(m);
          this.assignNextPattern(m, effectiveDifficulty);
        } else {
          m.patternPhase += dt;
          m.patternTimer -= dt;

          const targetX = resolved.point.x;
          const targetY = resolved.point.y;
          const dx = targetX - m.x;
          const dy = targetY - m.y;
          const dist = Math.hypot(dx, dy);

          // Progressively slow wings & speed as mosquito flares for touchdown
          const flareFactor = clamp(dist / 0.14, 0.28, 1.0);
          m.wingPhase += dt * (44 + flareFactor * 34);

          if (dist < 0.025 && Math.abs(m.z - 0.16) < 0.15) {
            const category = BODY_REGION_CATEGORY[region];
            const label = BODY_REGION_LABELS[region];
            const biteDuration = randRange(minBiteDur, maxBiteDur);

            m.pattern = 'LANDED_ON_FACE';
            m.animState = 'LANDED';
            m.landingTimer = 0;
            m.landingProgress = 0;
            m.bitePulsePhase = 0;
            m.landingDuration = biteDuration;
            m.biteTriggerTimeSec = Math.min(biteDuration * 0.34, randRange(0.55, 0.92));
            m.biteConfirmed = false;
            m.biteConfirmedAt = undefined;
            m.activeBiteId = undefined;
            m.landedAngleOffset = randRange(-0.26, 0.26);
            m.x = targetX;
            m.y = targetY;
            m.z = 0.15;
            m.vx = 0;
            m.vy = 0;
            m.vz = 0;
            m.speed = 0;
            m.depthScale = this.computeDepthScale(m.z);
            m.screenX = m.x * viewportW;
            m.screenY = m.y * viewportH;
            const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
            m.hitboxRadiusPx =
              baseScalePx * m.baseSize * m.depthScale * Math.max(1.0, profile.hitboxScale);
            m.buzzVolume = 0.04;
            m.trail = [];

            const taunts = CATEGORY_LANDING_TAUNTS[category];
            m.tauntText = taunts[Math.floor(Math.random() * taunts.length)];
            m.tauntExpiresAt = nowMs + 2200;

            events.push({
              type: 'LANDED',
              mosquitoId: m.id,
              zone: isFaceLandingZone(region) ? region : undefined,
              region,
              category,
              zoneLabel: label,
              point: { x: m.x, y: m.y },
              landmarkRef: m.landingLandmarkRef,
              depthScale: resolved.depthScale,
            });
            continue;
          }

          if (m.patternTimer <= 0) {
            this.clearLandingFields(m);
            this.assignNextPattern(m, effectiveDifficulty);
          } else {
            // Smooth homing descent that visibly reduces flight speed as it closes in on the skin
            const rawApproach = clamp(dist * 3.1, 0.08, 0.52) * Math.max(0.82, speedFactor * 0.9);
            const approachSpeed = rawApproach * (0.45 + flareFactor * 0.55);
            const swirlMag = Math.min(0.11, dist * 0.65);
            const swirlX = Math.cos(m.patternPhase * 8.5) * swirlMag;
            const swirlY = Math.sin(m.patternPhase * 7.8) * swirlMag;

            const dirX = dist > 0.001 ? dx / dist : 0;
            const dirY = dist > 0.001 ? dy / dist : 0;
            const desiredVx = dirX * approachSpeed + swirlX;
            const desiredVy = dirY * approachSpeed + swirlY;

            m.vx += (desiredVx - m.vx) * Math.min(1, dt * 6.8);
            m.vy += (desiredVy - m.vy) * Math.min(1, dt * 6.8);
            m.vz += ((0.15 - m.z) * 2.7 - m.vz * 2.2) * dt;

            m.x = clamp(m.x + m.vx * dt, 0.03, 0.97);
            m.y = clamp(m.y + m.vy * dt, 0.05, 0.95);
            m.z = clamp(m.z + m.vz * dt, 0.1, 0.98);
            m.speed = Math.hypot(m.vx, m.vy);
            if (m.speed > 0.02) {
              m.direction = this.lerpAngle(m.direction, Math.atan2(m.vy, m.vx), Math.min(1, dt * 12));
            }
            m.rotation = clamp(m.vx * 1.15, -0.5, 0.5);
            m.animState = 'APPROACHING_LANDING';

            m.depthScale = this.computeDepthScale(m.z);
            m.screenX = m.x * viewportW;
            m.screenY = m.y * viewportH;
            const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
            m.hitboxRadiusPx = baseScalePx * m.baseSize * m.depthScale * profile.hitboxScale;

            const acoustic = this.computeDepthAcoustics(m.z, m.baseBuzzPitchHz, m.speed, m.vz);
            m.buzzVolume = clamp(acoustic.buzzVolume * 1.1, 0.1, 1.0);
            m.buzzPitchHz = clamp(acoustic.buzzPitchHz + 34, 380, 940);

            m.trail.push({ x: m.screenX, y: m.screenY });
            if (m.trail.length > 5) m.trail.shift();
            continue;
          }
        }
      }

      // --- STANDARD AUTONOMOUS FLIGHT BEHAVIORS (UNCHANGED) ---
      const wingRate = m.animState === 'DARTING' ? 78 : m.animState === 'HOVERING' ? 58 : 66;
      m.wingPhase += dt * wingRate;

      m.patternTimer -= dt * profile.turnFrequency;
      if (m.patternTimer <= 0) {
        this.assignNextPattern(m, effectiveDifficulty);
      }

      // Hand proximity evasion impulse
      let evading = false;
      for (const hand of hands) {
        const dx = m.x - hand.palm.x;
        const dy = m.y - hand.palm.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.17 && dist > 0.001) {
          if (hand.speed > 0.45 && Math.random() < profile.escapeChance * dt * 5.2) {
            m.pattern = 'SUDDEN_ESCAPE';
            m.patternTimer = randRange(0.45, 0.9);
            const push = (0.58 + profile.speedScale * 0.25) * settings.mosquitoSpeedMultiplier;
            m.vx = (dx / dist) * push + randRange(-0.18, 0.18);
            m.vy = (dy / dist) * push + randRange(-0.18, 0.18);
            m.vz = randRange(-0.25, 0.35);
            m.animState = 'DARTING';
            evading = true;
          }
        }
      }

      if (!evading) {
        this.applyPatternSteering(m, dt, speedFactor, profile.approachAggression, faceAnchor);
      }

      const marginX = 0.08;
      const marginY = 0.11;
      if (m.x < marginX) m.vx += (marginX - m.x) * 4.8 * dt;
      if (m.x > 1 - marginX) m.vx -= (m.x - (1 - marginX)) * 4.8 * dt;
      if (m.y < marginY) m.vy += (marginY - m.y) * 4.8 * dt;
      if (m.y > 1 - marginY) m.vy -= (m.y - (1 - marginY)) * 4.8 * dt;

      if (m.z < 0.12) m.vz += (0.12 - m.z) * 3.2 * dt;
      if (m.z > 0.94) m.vz -= (m.z - 0.94) * 3.2 * dt;

      m.vx += Math.sin(m.patternPhase * 7.3) * 0.18 * dt * speedFactor;
      m.vy += Math.cos(m.patternPhase * 6.1) * 0.22 * dt * speedFactor;
      m.patternPhase += dt;

      const depthScale = this.computeDepthScale(m.z);
      const parallaxSpeed = 0.65 + depthScale * 0.52;

      const maxVel = (m.pattern === 'SUDDEN_ESCAPE' ? 0.85 : 0.48) * speedFactor;
      const currSpeed = Math.hypot(m.vx, m.vy);
      if (currSpeed > maxVel) {
        const ratio = maxVel / currSpeed;
        m.vx *= ratio;
        m.vy *= ratio;
      }
      m.vz = clamp(m.vz, -0.42 * speedFactor, 0.42 * speedFactor);

      m.x = clamp(m.x + m.vx * parallaxSpeed * dt, 0.03, 0.97);
      m.y = clamp(m.y + m.vy * parallaxSpeed * dt, 0.06, 0.94);
      m.z = clamp(m.z + m.vz * dt, 0.08, 1.0);

      m.speed = Math.hypot(m.vx, m.vy);
      if (m.speed > 0.025) {
        const targetDir = Math.atan2(m.vy, m.vx);
        m.direction = this.lerpAngle(m.direction, targetDir, Math.min(1, dt * 10));
      }
      m.rotation = clamp(m.vx * 1.15, -0.55, 0.55);

      m.depthScale = this.computeDepthScale(m.z);
      m.screenX = m.x * viewportW;
      m.screenY = m.y * viewportH;

      const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
      m.hitboxRadiusPx = baseScalePx * m.baseSize * m.depthScale * profile.hitboxScale;

      const acoustic = this.computeDepthAcoustics(m.z, m.baseBuzzPitchHz, m.speed, m.vz);
      m.buzzVolume = acoustic.buzzVolume;
      m.buzzPitchHz = acoustic.buzzPitchHz;

      m.trail.push({ x: m.screenX, y: m.screenY });
      if (m.trail.length > 6) {
        m.trail.shift();
      }
    }

    return events;
  }

  private isRegionAllowedBySettings(region: BodyRegionId, settings: GameSettings): boolean {
    const category = BODY_REGION_CATEGORY[region];
    const b = settings.bites;
    if (!b.enabled) {
      // Preserve legacy Face Landing toggle if body bites are switched off
      return category === 'FACE' && settings.enableFaceLanding && isFaceLandingZone(region);
    }
    switch (category) {
      case 'FACE':
        return b.enableFaceBites && settings.enableFaceLanding;
      case 'ARM':
        return b.enableArmBites;
      case 'NECK':
        return b.enableNeckBites;
      case 'HAND':
        return b.enableHandBites;
      case 'LEG':
        return b.enableLegBites;
    }
  }

  private getEligibleRegions(
    settings: GameSettings,
    faceAnchor?: FaceAnchor,
    bodyFrame?: BodyTrackingFrame,
  ): BodyRegionAnchor[] {
    const out: BodyRegionAnchor[] = [];
    const seen = new Set<BodyRegionId>();

    if (bodyFrame && bodyFrame.visibleRegions.length > 0) {
      for (const regionId of bodyFrame.visibleRegions) {
        const anchor = bodyFrame.regions[regionId];
        if (!anchor) continue;
        if (!this.isRegionAllowedBySettings(regionId, settings)) continue;
        seen.add(regionId);
        out.push(anchor);
      }
    }

    // Fallback to FaceAnchor zones (e.g. TV Display Mode streaming faceAnchor without Pose)
    if (faceAnchor?.detected && faceAnchor.zones) {
      for (const zk of ALL_FACE_LANDING_ZONES) {
        if (seen.has(zk)) continue;
        if (!this.isRegionAllowedBySettings(zk, settings)) continue;
        const za = faceAnchor.zones[zk];
        if (!za) continue;
        out.push({
          region: zk,
          category: 'FACE',
          label: FACE_ZONE_LABELS[zk],
          point: za.point,
          axisAngleRad: faceAnchor.headRollRad,
          scale: za.radius,
          visibility: 0.95,
          source: 'FACE',
          primaryLandmarkIndex: zk === 'NOSE' ? 1 : zk === 'FOREHEAD' ? 151 : 10,
        });
      }
    }

    return out;
  }

  private resolveLandingTarget(
    region: BodyRegionId,
    landmarkRef: BodyLandmarkReference | undefined,
    fallbackOffset: Point2D | undefined,
    faceAnchor?: FaceAnchor,
    bodyFrame?: BodyTrackingFrame,
  ): { point: Point2D; axisAngleRad: number; depthScale: number } | null {
    const bodyAnchor = bodyFrame?.regions[region];
    if (bodyAnchor) {
      let basePt: Point2D = bodyAnchor.point;
      if (
        bodyAnchor.segmentStart &&
        bodyAnchor.segmentEnd &&
        typeof landmarkRef?.segmentT === 'number'
      ) {
        const t = clamp(landmarkRef.segmentT, 0.1, 0.9);
        basePt = {
          x: bodyAnchor.segmentStart.x + (bodyAnchor.segmentEnd.x - bodyAnchor.segmentStart.x) * t,
          y: bodyAnchor.segmentStart.y + (bodyAnchor.segmentEnd.y - bodyAnchor.segmentStart.y) * t,
        };
      }

      const off = landmarkRef?.localOffset ?? fallbackOffset ?? { x: 0, y: 0 };
      const refScale = Math.max(0.02, landmarkRef?.referenceScale ?? bodyAnchor.scale);
      const scaleRatio = clamp(bodyAnchor.scale / refScale, 0.55, 1.85);
      const cosR = Math.cos(bodyAnchor.axisAngleRad);
      const sinR = Math.sin(bodyAnchor.axisAngleRad);
      const lx = off.x * scaleRatio;
      const ly = off.y * scaleRatio;

      return {
        point: {
          x: clamp(basePt.x + lx * cosR - ly * sinR, 0.03, 0.97),
          y: clamp(basePt.y + lx * sinR + ly * cosR, 0.04, 0.96),
        },
        axisAngleRad: bodyAnchor.axisAngleRad,
        depthScale: clamp(bodyAnchor.scale / 0.055, 0.65, 1.75),
      };
    }

    // FaceAnchor fallback
    if (faceAnchor?.detected) {
      let basePt: Point2D | null = null;
      if (region === 'CHIN' && faceAnchor.chin) {
        basePt = faceAnchor.chin;
      } else if (isFaceLandingZone(region) && faceAnchor.zones[region]) {
        basePt = faceAnchor.zones[region].point;
      }
      if (basePt) {
        const off = landmarkRef?.localOffset ?? fallbackOffset ?? { x: 0, y: 0 };
        const cosR = Math.cos(faceAnchor.headRollRad);
        const sinR = Math.sin(faceAnchor.headRollRad);
        return {
          point: {
            x: clamp(basePt.x + off.x * cosR - off.y * sinR, 0.03, 0.97),
            y: clamp(basePt.y + off.x * sinR + off.y * cosR, 0.05, 0.95),
          },
          axisAngleRad: faceAnchor.headRollRad,
          depthScale: clamp(faceAnchor.faceRadius / 0.14, 0.65, 1.75),
        };
      }
    }

    return null;
  }

  private tryScheduleBodyLanding(
    eligibleRegions: BodyRegionAnchor[],
    difficulty: DifficultyLevel,
    faceAnchor?: FaceAnchor,
    bodyFrame?: BodyTrackingFrame,
  ): void {
    const livingCount = this.getLivingCount();
    if (livingCount <= 0) return;

    const diffCap =
      difficulty === DifficultyLevel.EXTREME
        ? 3
        : difficulty === DifficultyLevel.EASY
          ? 1
          : 2;
    // Never allow all mosquitoes to land simultaneously when a swarm is flying
    const swarmCap = livingCount <= 2 ? 1 : Math.max(1, Math.floor(livingCount * 0.45));
    const maxConcurrent = Math.min(diffCap, swarmCap);

    const activeLanders = this.mosquitoes.filter(
      (m) =>
        m.alive && (m.pattern === 'APPROACH_FACE_ZONE' || m.pattern === 'LANDED_ON_FACE'),
    );
    if (activeLanders.length >= maxConcurrent) return;

    const occupiedRegions = new Set<BodyRegionId>();
    for (const lander of activeLanders) {
      if (lander.landingBodyRegion) occupiedRegions.add(lander.landingBodyRegion);
    }

    const freeRegions = eligibleRegions.filter((r) => !occupiedRegions.has(r.region));
    if (freeRegions.length === 0) return;

    // Encourage rich variety across face, neck, shoulders, arms, hands & legs
    const varied =
      freeRegions.length > 1 && this.lastLandingRegion
        ? freeRegions.filter((r) => r.region !== this.lastLandingRegion)
        : freeRegions;

    // Group by category first so face doesn't drown out arms/neck/hands/legs when body is visible
    const categories = Array.from(new Set(varied.map((r) => r.category)));
    const pickedCategory = categories[Math.floor(Math.random() * categories.length)];
    const catPool = varied.filter((r) => r.category === pickedCategory);
    const chosenAnchor = catPool[Math.floor(Math.random() * catPool.length)];
    if (!chosenAnchor) return;

    // Compute unique organic skin offset in anchor-local coordinates so every bite has its own exact spot
    const r = Math.max(0.024, chosenAnchor.scale);
    let localOffsetX = 0;
    let localOffsetY = 0;
    let segmentT: number | undefined;

    if (chosenAnchor.segmentStart && chosenAnchor.segmentEnd) {
      // Along-limb position (22%..78% between shoulder->elbow, elbow->wrist, hip->knee, etc.)
      segmentT = randRange(0.22, 0.78);
      // Slight lateral skin offset perpendicular to bone axis
      localOffsetX = randRange(-r * 0.22, r * 0.22);
      localOffsetY = randRange(-r * 0.34, r * 0.34);
    } else if (chosenAnchor.category === 'FACE') {
      const fR = Math.max(0.06, faceAnchor?.faceRadius ?? r * 2.8);
      switch (chosenAnchor.region) {
        case 'HEAD':
          localOffsetX = randRange(-fR * 0.42, fR * 0.42);
          localOffsetY = randRange(-fR * 0.16, fR * 0.16);
          break;
        case 'FOREHEAD':
          localOffsetX = randRange(-fR * 0.38, fR * 0.38);
          localOffsetY = randRange(-fR * 0.14, fR * 0.14);
          break;
        case 'NOSE':
          localOffsetX = randRange(-fR * 0.11, fR * 0.11);
          localOffsetY = randRange(-fR * 0.16, fR * 0.12);
          break;
        case 'CHIN':
          localOffsetX = randRange(-fR * 0.18, fR * 0.18);
          localOffsetY = randRange(-fR * 0.1, fR * 0.08);
          break;
        default:
          // Left/Right cheeks
          localOffsetX = randRange(-fR * 0.2, fR * 0.2);
          localOffsetY = randRange(-fR * 0.2, fR * 0.22);
          break;
      }
    } else {
      // Neck, shoulders, elbows, hands, knees
      localOffsetX = randRange(-r * 0.38, r * 0.38);
      localOffsetY = randRange(-r * 0.32, r * 0.32);
    }

    const landmarkRef: BodyLandmarkReference = {
      source: chosenAnchor.source,
      region: chosenAnchor.region,
      primaryIndex: chosenAnchor.primaryLandmarkIndex,
      secondaryIndex: chosenAnchor.secondaryLandmarkIndex,
      segmentT,
      localOffset: { x: localOffsetX, y: localOffsetY },
      referenceScale: chosenAnchor.scale,
    };

    const resolvedNow = this.resolveLandingTarget(
      chosenAnchor.region,
      landmarkRef,
      landmarkRef.localOffset,
      faceAnchor,
      bodyFrame,
    );
    const targetPt = resolvedNow?.point ?? chosenAnchor.point;

    const candidates = this.mosquitoes.filter(
      (m) =>
        m.alive &&
        m.pattern !== 'APPROACH_FACE_ZONE' &&
        m.pattern !== 'LANDED_ON_FACE',
    );
    if (candidates.length === 0) return;

    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - targetPt.x, a.y - targetPt.y) -
        Math.hypot(b.x - targetPt.x, b.y - targetPt.y),
    );
    const poolSize = Math.min(3, candidates.length);
    const chosen = candidates[Math.floor(Math.random() * poolSize)];

    chosen.pattern = 'APPROACH_FACE_ZONE';
    chosen.animState = 'APPROACHING_LANDING';
    chosen.patternTimer = randRange(4.2, 6.4);
    chosen.patternPhase = randRange(0, Math.PI * 2);
    chosen.landingZone = isFaceLandingZone(chosenAnchor.region) ? chosenAnchor.region : undefined;
    chosen.landingBodyRegion = chosenAnchor.region;
    chosen.landingBodyCategory = chosenAnchor.category;
    chosen.landingBodyLabel = chosenAnchor.label;
    chosen.landingLandmarkRef = landmarkRef;
    chosen.landingOffset = { x: localOffsetX, y: localOffsetY };
    chosen.landingTimer = 0;
    chosen.landingProgress = 0;
    chosen.biteConfirmed = false;
    chosen.biteConfirmedAt = undefined;
    chosen.activeBiteId = undefined;

    this.lastLandingRegion = chosenAnchor.region;
  }

  private clearLandingFields(m: MosquitoEntity): void {
    m.landingZone = undefined;
    m.landingBodyRegion = undefined;
    m.landingBodyCategory = undefined;
    m.landingBodyLabel = undefined;
    m.landingLandmarkRef = undefined;
    m.landingOffset = undefined;
    m.landingTimer = undefined;
    m.landingDuration = undefined;
    m.landingProgress = undefined;
    m.bitePulsePhase = undefined;
    m.landedAngleOffset = undefined;
    m.biteTriggerTimeSec = undefined;
    m.biteConfirmed = undefined;
    m.biteConfirmedAt = undefined;
    m.activeBiteId = undefined;
  }

  private launchOffBody(
    m: MosquitoEntity,
    difficulty: DifficultyLevel,
    burstUpward: boolean,
  ): void {
    this.clearLandingFields(m);
    if (burstUpward) {
      const escapeAngle = randRange(-Math.PI * 0.88, -Math.PI * 0.12);
      m.pattern = 'SUDDEN_ESCAPE';
      m.patternTimer = randRange(0.55, 0.95);
      m.vx = Math.cos(escapeAngle) * 0.46;
      m.vy = Math.sin(escapeAngle) * 0.46;
      m.vz = randRange(0.18, 0.34);
      m.animState = 'DARTING';
    } else {
      this.assignNextPattern(m, difficulty);
    }
  }

  private computeDepthCloseness(z: number): number {
    return clamp((1.0 - z) / 0.92, 0, 1);
  }

  private computeDepthAcoustics(
    z: number,
    baseBuzzPitchHz: number,
    speed: number,
    vz: number,
  ): { buzzVolume: number; buzzPitchHz: number } {
    const closeness = this.computeDepthCloseness(z);
    const speedEnergy = clamp(speed * 0.35, 0, 0.18);
    const buzzVolume = clamp(0.08 + Math.pow(closeness, 1.75) * 0.84 + speedEnergy * closeness, 0.06, 1.0);

    const depthPitchBoost = Math.pow(closeness, 1.15) * 150;
    const speedPitchBoost = clamp(speed * 115, 0, 75);
    const zDoppler = clamp(-vz * 65, -28, 45);
    const buzzPitchHz = clamp(baseBuzzPitchHz + depthPitchBoost + speedPitchBoost + zDoppler, 360, 920);

    return { buzzVolume, buzzPitchHz };
  }

  private createMosquito(
    viewportW: number,
    viewportH: number,
    speedScale: number,
    hitboxScale: number,
  ): MosquitoEntity {
    const x = randRange(0.12, 0.88);
    const y = randRange(0.14, 0.84);
    const z = randRange(0.16, 0.92);
    const angle = randRange(0, Math.PI * 2);
    const initSpeed = randRange(0.12, 0.28) * speedScale;
    const baseSize = randRange(0.86, 1.18);
    const depthScale = this.computeDepthScale(z);
    const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
    const baseBuzzPitchHz = randRange(420, 565);
    const initialAcoustic = this.computeDepthAcoustics(z, baseBuzzPitchHz, initSpeed, 0);

    const m: MosquitoEntity = {
      id: `mosq-${++this.idCounter}`,
      x,
      y,
      z,
      vx: Math.cos(angle) * initSpeed,
      vy: Math.sin(angle) * initSpeed,
      vz: randRange(-0.12, 0.12),
      direction: angle,
      speed: initSpeed,
      rotation: 0,
      baseSize,
      health: 1,
      alive: true,
      pattern: 'WANDERING',
      patternTimer: randRange(1.0, 2.8),
      patternPhase: randRange(0, Math.PI * 2),
      wingPhase: randRange(0, Math.PI * 2),
      animState: 'FLYING',
      deathTimer: 0,
      deathSpin: 0,
      screenX: x * viewportW,
      screenY: y * viewportH,
      depthScale,
      hitboxRadiusPx: baseScalePx * baseSize * depthScale * hitboxScale,
      baseBuzzPitchHz,
      buzzVolume: initialAcoustic.buzzVolume,
      buzzPitchHz: initialAcoustic.buzzPitchHz,
      trail: [],
    };

    this.assignNextPattern(m, DifficultyLevel.NORMAL);
    return m;
  }

  private assignNextPattern(m: MosquitoEntity, difficulty: DifficultyLevel): void {
    const weights: Record<FlightPattern, number> = {
      WANDERING: 2.6,
      ZIGZAG: difficulty === DifficultyLevel.EASY ? 0.9 : 2.1,
      CIRCULAR: 1.5,
      HOVERING: difficulty === DifficultyLevel.EXTREME ? 0.5 : 1.5,
      SUDDEN_ESCAPE: difficulty === DifficultyLevel.EASY ? 0.4 : 1.2,
      APPROACH_CAMERA: difficulty === DifficultyLevel.EXTREME ? 2.1 : 1.3,
      RETREAT_CAMERA: 1.2,
      APPROACH_FACE_ZONE: 0,
      LANDED_ON_FACE: 0,
    };

    for (const p of ALL_PATTERNS) {
      const bias = this.patternBias[p];
      if (typeof bias === 'number' && bias > 0) {
        weights[p] *= bias;
      }
    }

    let total = 0;
    for (const p of ALL_PATTERNS) total += weights[p];
    let r = Math.random() * total;
    let selected: FlightPattern = 'WANDERING';
    for (const p of ALL_PATTERNS) {
      r -= weights[p];
      if (r <= 0) {
        selected = p;
        break;
      }
    }

    m.pattern = selected;
    m.patternPhase = randRange(0, Math.PI * 2);

    switch (selected) {
      case 'HOVERING':
        m.hoverAnchor = { x: m.x, y: m.y };
        m.patternTimer = randRange(0.9, 1.9);
        m.animState = 'HOVERING';
        break;
      case 'CIRCULAR':
        m.circleCenter = {
          x: clamp(m.x + randRange(-0.12, 0.12), 0.16, 0.84),
          y: clamp(m.y + randRange(-0.12, 0.12), 0.18, 0.82),
        };
        m.circleRadius = randRange(0.06, 0.15);
        m.circleDir = Math.random() > 0.5 ? 1 : -1;
        m.patternTimer = randRange(1.8, 3.2);
        m.animState = 'FLYING';
        break;
      case 'SUDDEN_ESCAPE': {
        const dashAngle = randRange(0, Math.PI * 2);
        m.vx = Math.cos(dashAngle) * 0.55;
        m.vy = Math.sin(dashAngle) * 0.55;
        m.vz = randRange(-0.22, 0.25);
        m.patternTimer = randRange(0.55, 1.05);
        m.animState = 'DARTING';
        break;
      }
      case 'APPROACH_CAMERA':
        m.patternTimer = randRange(1.2, 2.2);
        m.animState = 'DARTING';
        break;
      case 'RETREAT_CAMERA':
        m.patternTimer = randRange(1.2, 2.2);
        m.animState = 'FLYING';
        break;
      case 'ZIGZAG':
        m.patternTimer = randRange(1.4, 2.8);
        m.animState = 'DARTING';
        break;
      default:
        m.patternTimer = randRange(1.5, 3.4);
        m.animState = 'FLYING';
        break;
    }
  }

  private applyPatternSteering(
    m: MosquitoEntity,
    dt: number,
    speedFactor: number,
    approachAggression: number,
    faceAnchor?: FaceAnchor,
  ): void {
    switch (m.pattern) {
      case 'WANDERING': {
        const turnRate = randRange(-3.2, 3.2) * dt;
        const heading = Math.atan2(m.vy, m.vx) + turnRate;
        const targetSpeed = (0.19 + Math.sin(m.patternPhase * 2.1) * 0.08) * speedFactor;
        m.vx += (Math.cos(heading) * targetSpeed - m.vx) * Math.min(1, dt * 3.2);
        m.vy += (Math.sin(heading) * targetSpeed - m.vy) * Math.min(1, dt * 3.2);
        m.vz += Math.sin(m.patternPhase * 1.4) * 0.16 * dt;
        break;
      }
      case 'ZIGZAG': {
        const freq = 6.5 * speedFactor;
        const perpAngle = m.direction + Math.PI * 0.5;
        const zigForce = Math.sin(m.patternPhase * freq) * 1.45 * speedFactor;
        m.vx += (Math.cos(perpAngle) * zigForce + Math.cos(m.direction) * 0.35 * speedFactor) * dt;
        m.vy += (Math.sin(perpAngle) * zigForce + Math.sin(m.direction) * 0.35 * speedFactor) * dt;
        m.vz += Math.cos(m.patternPhase * 3.2) * 0.25 * dt;
        break;
      }
      case 'CIRCULAR': {
        const center: Point2D = m.circleCenter ?? { x: 0.5, y: 0.5 };
        const radius = m.circleRadius ?? 0.1;
        const dir = m.circleDir ?? 1;
        const ang = Math.atan2(m.y - center.y, m.x - center.x) + dir * 2.5 * speedFactor * dt;
        const targetX = center.x + Math.cos(ang) * radius;
        const targetY = center.y + Math.sin(ang) * radius;
        m.vx += ((targetX - m.x) * 6.5 - m.vx * 1.6) * dt;
        m.vy += ((targetY - m.y) * 6.5 - m.vy * 1.6) * dt;
        m.vz += Math.sin(ang) * 0.14 * dt;
        break;
      }
      case 'HOVERING': {
        const anchor = m.hoverAnchor ?? { x: m.x, y: m.y };
        const bobX = anchor.x + Math.sin(m.patternPhase * 5.2) * 0.015;
        const bobY = anchor.y + Math.cos(m.patternPhase * 4.4) * 0.022;
        m.vx += ((bobX - m.x) * 7.5 - m.vx * 4.0) * dt;
        m.vy += ((bobY - m.y) * 7.5 - m.vy * 4.0) * dt;
        m.vz *= 0.92;
        break;
      }
      case 'SUDDEN_ESCAPE': {
        m.vx *= 0.985;
        m.vy *= 0.985;
        m.vz *= 0.96;
        break;
      }
      case 'APPROACH_CAMERA': {
        const targetPt = faceAnchor
          ? m.id.charCodeAt(m.id.length - 1) % 3 === 0
            ? faceAnchor.leftEar
            : m.id.charCodeAt(m.id.length - 1) % 3 === 1
              ? faceAnchor.rightEar
              : faceAnchor.faceCenter
          : { x: 0.5, y: 0.44 };
        m.vz -= (0.28 + approachAggression * 0.26) * speedFactor * dt;
        m.vx += ((targetPt.x - m.x) * 0.85 + Math.sin(m.patternPhase * 5.5) * 0.32) * dt;
        m.vy += ((targetPt.y - m.y) * 0.85 + Math.cos(m.patternPhase * 4.8) * 0.28) * dt;
        break;
      }
      case 'RETREAT_CAMERA': {
        m.vz += 0.34 * speedFactor * dt;
        m.vx += Math.sin(m.patternPhase * 3.8) * 0.45 * dt;
        m.vy += Math.cos(m.patternPhase * 3.2) * 0.4 * dt;
        break;
      }
    }
  }

  private computeDepthScale(z: number): number {
    const focal = 0.56;
    return focal / (focal + z - 0.28);
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }
}

export function computeAutoDifficulty(
  current: DifficultyLevel,
  kills: number,
  accuracy: number,
  currentCombo: number,
  elapsedSeconds: number,
): DifficultyLevel {
  if (elapsedSeconds < 8 && kills < 3) return current;
  const kpm = elapsedSeconds > 5 ? (kills / elapsedSeconds) * 60 : kills * 3;
  const performanceScore = kpm * 1.4 + accuracy * 0.45 + currentCombo * 4.5;

  if (performanceScore >= 85) return DifficultyLevel.EXTREME;
  if (performanceScore >= 58) return DifficultyLevel.HARD;
  if (performanceScore >= 32) return DifficultyLevel.NORMAL;
  return DifficultyLevel.EASY;
}
