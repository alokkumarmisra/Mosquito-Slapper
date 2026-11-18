import { DIFFICULTY_PROFILES } from '../config/defaults';
import {
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

const ZONE_LANDING_TAUNTS: Record<FaceLandingZone, string[]> = {
  HEAD: ['King of your head!', 'Nice hair landing pad!', 'Up top, human!'],
  FOREHEAD: ['Cozy forehead!', 'Right between the brows!', 'Prime forehead real estate!'],
  NOSE: ['Boop! On your nose!', 'Don’t cross your eyes!', 'Nose snack time!'],
  LEFT_CHEEK: ['Sweet cheek perch!', 'Don’t slap yourself!', 'Cheeky landing!'],
  RIGHT_CHEEK: ['Comfy right cheek!', 'Free cheek buffet!', 'Too close to swat!'],
};

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
  private nextFaceLandingMs = 0;
  private lastLandingZone: FaceLandingZone | null = null;
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

    // Logarithmic + linear blend so 1, 5, 10, 20, and 40+ mosquitoes produce distinct density tiers
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
    this.nextFaceLandingMs = 0;
    this.lastLandingZone = null;
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

  public killMosquito(id: string): MosquitoEntity | null {
    const m = this.mosquitoes.find((item) => item.id === id && item.alive);
    if (!m) return null;
    m.alive = false;
    m.health = 0;
    m.animState = 'DYING';
    m.deathTimer = 0;
    m.deathSpin = (Math.random() > 0.5 ? 1 : -1) * randRange(9, 15);
    m.tauntText = undefined;
    m.landingZone = undefined;
    m.landingOffset = undefined;
    m.landingTimer = undefined;
    m.landingDuration = undefined;
    m.landingProgress = undefined;
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
    allowFaceLanding = true,
  ): FaceLandingEvent[] {
    const dt = Math.min(0.05, Math.max(0.001, dtSec));
    const profile = DIFFICULTY_PROFILES[effectiveDifficulty];
    const speedFactor = profile.speedScale * settings.mosquitoSpeedMultiplier;
    const events: FaceLandingEvent[] = [];

    const faceVisible = Boolean(faceAnchor?.detected && faceAnchor.zones);
    const faceLandingAllowed = Boolean(allowFaceLanding && settings.enableFaceLanding && faceVisible);

    // Measure rapid head shake speed so shaking your head vigorously can startle landed mosquitoes
    let headShakeSpeed = 0;
    if (faceVisible && faceAnchor) {
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

    // Periodic random face-landing scheduler: picks a random head/forehead/nose/cheek zone
    if (faceLandingAllowed && faceAnchor) {
      if (this.nextFaceLandingMs === 0) {
        this.nextFaceLandingMs = nowMs + randRange(2200, 3800);
      } else if (nowMs >= this.nextFaceLandingMs) {
        this.tryScheduleFaceLanding(faceAnchor, effectiveDifficulty);
        const intervalMin =
          effectiveDifficulty === DifficultyLevel.EXTREME
            ? 2400
            : effectiveDifficulty === DifficultyLevel.HARD
              ? 3000
              : effectiveDifficulty === DifficultyLevel.EASY
                ? 4800
                : 3500;
        const intervalMax =
          effectiveDifficulty === DifficultyLevel.EXTREME
            ? 4600
            : effectiveDifficulty === DifficultyLevel.HARD
              ? 5600
              : effectiveDifficulty === DifficultyLevel.EASY
                ? 8200
                : 6600;
        this.nextFaceLandingMs = nowMs + randRange(intervalMin, intervalMax);
      }
    }

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

      // --- SPECIAL STATE A: LANDED ON PERSON'S FACE (Head / Forehead / Nose / Cheek) ---
      if (m.pattern === 'LANDED_ON_FACE') {
        const zoneKey = m.landingZone;
        const zone = zoneKey && faceAnchor?.zones ? faceAnchor.zones[zoneKey] : undefined;

        if (!faceLandingAllowed || !faceAnchor || !zone || !zoneKey) {
          this.launchOffFace(m, effectiveDifficulty, false);
          continue;
        }

        m.landingTimer = (m.landingTimer ?? 0) + dt;
        m.landingProgress = Math.min(1, (m.landingProgress ?? 0) + dt * 4.2);
        m.bitePulsePhase = (m.bitePulsePhase ?? 0) + dt * 6.8;
        // Wings stay mostly folded while perched with occasional tiny twitch
        m.wingPhase += dt * 7;

        // Rotate tiny organic perch offset along live head roll so bug stays anatomically anchored
        const off = m.landingOffset ?? { x: 0, y: 0 };
        const cosR = Math.cos(faceAnchor.headRollRad);
        const sinR = Math.sin(faceAnchor.headRollRad);
        const targetX = clamp(zone.point.x + off.x * cosR - off.y * sinR, 0.03, 0.97);
        const targetY = clamp(zone.point.y + off.x * sinR + off.y * cosR, 0.05, 0.95);

        // Tight responsive tracking onto the person's moving head/nose/forehead/cheek
        const followT = Math.min(1, dt * 26);
        m.x += (targetX - m.x) * followT;
        m.y += (targetY - m.y) * followT;
        m.z += (0.14 - m.z) * Math.min(1, dt * 10);
        m.vx = 0;
        m.vy = 0;
        m.vz = 0;
        m.speed = 0;
        m.animState = 'LANDED';
        m.rotation = clamp(faceAnchor.headRollRad + (m.landedAngleOffset ?? 0), -0.85, 0.85);
        m.depthScale = this.computeDepthScale(m.z);
        m.screenX = m.x * viewportW;
        m.screenY = m.y * viewportH;

        const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
        // Slightly generous hitbox while perched so swatting it off your face feels crisp & fair
        m.hitboxRadiusPx = baseScalePx * m.baseSize * m.depthScale * Math.max(1.0, profile.hitboxScale);

        // Real mosquitoes go eerily quiet the instant they land on skin!
        m.buzzVolume = 0.04;
        m.buzzPitchHz = m.baseBuzzPitchHz * 0.88;
        m.trail = [];

        // Check takeoff conditions: timer expired or player vigorously shakes head
        const startledByHeadShake = headShakeSpeed > 1.85 && m.landingTimer > 0.65;
        const finishedPerching = m.landingTimer >= (m.landingDuration ?? 4.2);

        if (finishedPerching || startledByHeadShake) {
          events.push({
            type: 'TOOK_OFF',
            mosquitoId: m.id,
            zone: zoneKey,
            zoneLabel: zone.label,
            point: { x: m.x, y: m.y },
          });
          if (finishedPerching) {
            m.tauntText = 'Gotcha! Hehe!';
            m.tauntExpiresAt = nowMs + 1900;
          }
          this.launchOffFace(m, effectiveDifficulty, true);
        }
        continue;
      }

      // --- SPECIAL STATE B: DESCENDING TOWARD A RECOGNIZED FACE ZONE ---
      if (m.pattern === 'APPROACH_FACE_ZONE') {
        const zoneKey = m.landingZone;
        const zone = zoneKey && faceAnchor?.zones ? faceAnchor.zones[zoneKey] : undefined;

        if (!faceLandingAllowed || !faceAnchor || !zone || !zoneKey) {
          this.clearLandingFields(m);
          this.assignNextPattern(m, effectiveDifficulty);
        } else {
          m.wingPhase += dt * 76;
          m.patternPhase += dt;
          m.patternTimer -= dt;

          const off = m.landingOffset ?? { x: 0, y: 0 };
          const cosR = Math.cos(faceAnchor.headRollRad);
          const sinR = Math.sin(faceAnchor.headRollRad);
          const targetX = clamp(zone.point.x + off.x * cosR - off.y * sinR, 0.04, 0.96);
          const targetY = clamp(zone.point.y + off.x * sinR + off.y * cosR, 0.06, 0.94);
          const dx = targetX - m.x;
          const dy = targetY - m.y;
          const dist = Math.hypot(dx, dy);

          // Touchdown when close enough to the facial landmark!
          if (dist < 0.026 && Math.abs(m.z - 0.16) < 0.14) {
            m.pattern = 'LANDED_ON_FACE';
            m.animState = 'LANDED';
            m.landingTimer = 0;
            m.landingProgress = 0;
            m.bitePulsePhase = 0;
            m.landingDuration = randRange(3.2, 5.6);
            m.landedAngleOffset = randRange(-0.24, 0.24);
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

            const taunts = ZONE_LANDING_TAUNTS[zoneKey];
            m.tauntText = taunts[Math.floor(Math.random() * taunts.length)];
            m.tauntExpiresAt = nowMs + 2400;

            events.push({
              type: 'LANDED',
              mosquitoId: m.id,
              zone: zoneKey,
              zoneLabel: zone.label,
              point: { x: m.x, y: m.y },
            });
            continue;
          }

          if (m.patternTimer <= 0) {
            // Took too long chasing a rapidly moving face — break off cleanly
            this.clearLandingFields(m);
            this.assignNextPattern(m, effectiveDifficulty);
          } else {
            // Smooth homing descent with subtle spiral buzz so the approach feels lifelike
            const approachSpeed = clamp(dist * 3.4, 0.14, 0.56) * Math.max(0.85, speedFactor * 0.92);
            const swirlMag = Math.min(0.14, dist * 0.75);
            const swirlX = Math.cos(m.patternPhase * 9.0) * swirlMag;
            const swirlY = Math.sin(m.patternPhase * 8.2) * swirlMag;

            const dirX = dist > 0.001 ? dx / dist : 0;
            const dirY = dist > 0.001 ? dy / dist : 0;
            const desiredVx = dirX * approachSpeed + swirlX;
            const desiredVy = dirY * approachSpeed + swirlY;

            m.vx += (desiredVx - m.vx) * Math.min(1, dt * 6.5);
            m.vy += (desiredVy - m.vy) * Math.min(1, dt * 6.5);
            m.vz += ((0.15 - m.z) * 2.6 - m.vz * 2.2) * dt;

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
            m.buzzVolume = clamp(acoustic.buzzVolume * 1.12, 0.1, 1.0);
            m.buzzPitchHz = clamp(acoustic.buzzPitchHz + 38, 380, 940);

            m.trail.push({ x: m.screenX, y: m.screenY });
            if (m.trail.length > 5) m.trail.shift();
            continue;
          }
        }
      }

      // Wing beat animation (faster when darting/escaping)
      const wingRate = m.animState === 'DARTING' ? 78 : m.animState === 'HOVERING' ? 58 : 66;
      m.wingPhase += dt * wingRate;

      // Switch movement pattern unpredictably
      m.patternTimer -= dt * profile.turnFrequency;
      if (m.patternTimer <= 0) {
        this.assignNextPattern(m, effectiveDifficulty);
      }

      // Hand proximity evasion impulse (scaled by difficulty so Hard/Extreme feel clever)
      let evading = false;
      for (const hand of hands) {
        const dx = m.x - hand.palm.x;
        const dy = m.y - hand.palm.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 0.17 && dist > 0.001) {
          // Only trigger sudden escape if hand is closing in or moving briskly
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

      // Apply independent flight steering forces per pattern
      if (!evading) {
        this.applyPatternSteering(m, dt, speedFactor, profile.approachAggression, faceAnchor);
      }

      // Soft repulsion from screen edges so mosquitoes curve organically rather than bouncing linearly
      const marginX = 0.08;
      const marginY = 0.11;
      if (m.x < marginX) m.vx += (marginX - m.x) * 4.8 * dt;
      if (m.x > 1 - marginX) m.vx -= (m.x - (1 - marginX)) * 4.8 * dt;
      if (m.y < marginY) m.vy += (marginY - m.y) * 4.8 * dt;
      if (m.y > 1 - marginY) m.vy -= (m.y - (1 - marginY)) * 4.8 * dt;

      // Soft Z bounds [0.09 (close foreground) .. 0.98 (rear)]
      if (m.z < 0.12) m.vz += (0.12 - m.z) * 3.2 * dt;
      if (m.z > 0.94) m.vz -= (m.z - 0.94) * 3.2 * dt;

      // Organic micro-jitter (characteristic mosquito bobbing)
      m.vx += Math.sin(m.patternPhase * 7.3) * 0.18 * dt * speedFactor;
      m.vy += Math.cos(m.patternPhase * 6.1) * 0.22 * dt * speedFactor;
      m.patternPhase += dt;

      // Depth-based perspective speed multiplier (closer mosquitoes sweep across screen faster for realism!)
      const depthScale = this.computeDepthScale(m.z);
      const parallaxSpeed = 0.65 + depthScale * 0.52;

      // Speed clamping
      const maxVel = (m.pattern === 'SUDDEN_ESCAPE' ? 0.85 : 0.48) * speedFactor;
      const currSpeed = Math.hypot(m.vx, m.vy);
      if (currSpeed > maxVel) {
        const ratio = maxVel / currSpeed;
        m.vx *= ratio;
        m.vy *= ratio;
      }
      m.vz = clamp(m.vz, -0.42 * speedFactor, 0.42 * speedFactor);

      // Integrate 3D position
      m.x = clamp(m.x + m.vx * parallaxSpeed * dt, 0.03, 0.97);
      m.y = clamp(m.y + m.vy * parallaxSpeed * dt, 0.06, 0.94);
      m.z = clamp(m.z + m.vz * dt, 0.08, 1.0);

      m.speed = Math.hypot(m.vx, m.vy);
      if (m.speed > 0.025) {
        const targetDir = Math.atan2(m.vy, m.vx);
        m.direction = this.lerpAngle(m.direction, targetDir, Math.min(1, dt * 10));
      }
      // Subtle body bank tilt into turns
      m.rotation = clamp(m.vx * 1.15, -0.55, 0.55);

      // Compute 3D perspective screen projection + hitbox
      m.depthScale = this.computeDepthScale(m.z);
      m.screenX = m.x * viewportW;
      m.screenY = m.y * viewportH;

      const baseScalePx = Math.max(18, Math.min(viewportW, viewportH) * 0.036);
      m.hitboxRadiusPx = baseScalePx * m.baseSize * m.depthScale * profile.hitboxScale;

      // Dynamically scale each mosquito's buzz volume & pitch by its Z-depth (closer Z = louder & higher pitch)
      const acoustic = this.computeDepthAcoustics(m.z, m.baseBuzzPitchHz, m.speed, m.vz);
      m.buzzVolume = acoustic.buzzVolume;
      m.buzzPitchHz = acoustic.buzzPitchHz;

      // Maintain short motion-blur trail when flying quickly
      m.trail.push({ x: m.screenX, y: m.screenY });
      if (m.trail.length > 6) {
        m.trail.shift();
      }
    }

    return events;
  }

  private tryScheduleFaceLanding(faceAnchor: FaceAnchor, difficulty: DifficultyLevel): void {
    const maxConcurrent =
      difficulty === DifficultyLevel.EXTREME
        ? 3
        : difficulty === DifficultyLevel.EASY
          ? 1
          : 2;

    const activeLanders = this.mosquitoes.filter(
      (m) =>
        m.alive && (m.pattern === 'APPROACH_FACE_ZONE' || m.pattern === 'LANDED_ON_FACE'),
    );
    if (activeLanders.length >= maxConcurrent) return;

    const occupiedZones = new Set<FaceLandingZone>();
    for (const lander of activeLanders) {
      if (lander.landingZone) occupiedZones.add(lander.landingZone);
    }

    const freeZones = ALL_FACE_LANDING_ZONES.filter((z) => !occupiedZones.has(z));
    if (freeZones.length === 0) return;

    // Prefer variety across head, forehead, nose, left cheek & right cheek
    const variedZones =
      freeZones.length > 1 && this.lastLandingZone
        ? freeZones.filter((z) => z !== this.lastLandingZone)
        : freeZones;
    let chosenZone = variedZones[Math.floor(Math.random() * variedZones.length)];
    let zoneAnchor = faceAnchor.zones[chosenZone];
    if (!zoneAnchor) return;

    const r = Math.max(0.06, faceAnchor.faceRadius);
    let localOffsetX = 0;
    let localOffsetY = 0;

    if (Math.random() < 0.34) {
      // Free-roam anywhere on the recognized head/face oval (crown, temples, brow, cheeks, nose, jaw)
      const angle = randRange(0, Math.PI * 2);
      const radial = Math.sqrt(Math.random());
      const rx = r * 0.78;
      const ry = r * 1.05;
      // Shift oval center slightly upward so top of head & forehead get rich coverage alongside lower face
      const headLocalX = Math.cos(angle) * rx * radial;
      const headLocalY = Math.sin(angle) * ry * radial - r * 0.14;
      const cosR = Math.cos(faceAnchor.headRollRad);
      const sinR = Math.sin(faceAnchor.headRollRad);
      const worldX = clamp(faceAnchor.faceCenter.x + headLocalX * cosR - headLocalY * sinR, 0.05, 0.95);
      const worldY = clamp(faceAnchor.faceCenter.y + headLocalX * sinR + headLocalY * cosR, 0.06, 0.94);

      // Classify this random face/head spot to its closest recognized facial region
      let nearestZone: FaceLandingZone = chosenZone;
      let nearestDist = Infinity;
      for (const zk of ALL_FACE_LANDING_ZONES) {
        const za = faceAnchor.zones[zk];
        if (!za) continue;
        const d = Math.hypot(worldX - za.point.x, worldY - za.point.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestZone = zk;
        }
      }
      chosenZone = nearestZone;
      zoneAnchor = faceAnchor.zones[chosenZone] ?? zoneAnchor;

      // Store offset in head-local coordinates relative to the nearest zone so it follows head tilt
      const dxW = worldX - zoneAnchor.point.x;
      const dyW = worldY - zoneAnchor.point.y;
      localOffsetX = dxW * cosR + dyW * sinR;
      localOffsetY = -dxW * sinR + dyW * cosR;
    } else {
      // Wide organic anatomical patch across the selected facial feature so bugs don't sit on one rigid dot
      switch (chosenZone) {
        case 'HEAD':
          localOffsetX = randRange(-r * 0.56, r * 0.56);
          localOffsetY = randRange(-r * 0.22, r * 0.22);
          break;
        case 'FOREHEAD':
          localOffsetX = randRange(-r * 0.48, r * 0.48);
          localOffsetY = randRange(-r * 0.18, r * 0.18);
          break;
        case 'NOSE':
          localOffsetX = randRange(-r * 0.16, r * 0.16);
          localOffsetY = randRange(-r * 0.24, r * 0.18);
          break;
        case 'LEFT_CHEEK':
        case 'RIGHT_CHEEK':
          localOffsetX = randRange(-r * 0.26, r * 0.26);
          localOffsetY = randRange(-r * 0.26, r * 0.30);
          break;
      }
    }

    const candidates = this.mosquitoes.filter(
      (m) =>
        m.alive &&
        m.pattern !== 'APPROACH_FACE_ZONE' &&
        m.pattern !== 'LANDED_ON_FACE',
    );
    if (candidates.length === 0) return;

    // Pick among the closest 3 living flying mosquitoes for a natural swoop onto the face/head
    candidates.sort(
      (a, b) =>
        Math.hypot(a.x - zoneAnchor.point.x, a.y - zoneAnchor.point.y) -
        Math.hypot(b.x - zoneAnchor.point.x, b.y - zoneAnchor.point.y),
    );
    const poolSize = Math.min(3, candidates.length);
    const chosen = candidates[Math.floor(Math.random() * poolSize)];

    chosen.pattern = 'APPROACH_FACE_ZONE';
    chosen.animState = 'APPROACHING_LANDING';
    chosen.patternTimer = randRange(4.0, 6.2);
    chosen.patternPhase = randRange(0, Math.PI * 2);
    chosen.landingZone = chosenZone;
    chosen.landingOffset = {
      x: localOffsetX,
      y: localOffsetY,
    };
    chosen.landingTimer = 0;
    chosen.landingProgress = 0;

    this.lastLandingZone = chosenZone;
  }

  private clearLandingFields(m: MosquitoEntity): void {
    m.landingZone = undefined;
    m.landingOffset = undefined;
    m.landingTimer = undefined;
    m.landingDuration = undefined;
    m.landingProgress = undefined;
    m.bitePulsePhase = undefined;
    m.landedAngleOffset = undefined;
  }

  private launchOffFace(
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
    // z = 0.08 (foreground near player) -> 1.0; z = 1.0 (far rear) -> 0.0
    return clamp((1.0 - z) / 0.92, 0, 1);
  }

  private computeDepthAcoustics(
    z: number,
    baseBuzzPitchHz: number,
    speed: number,
    vz: number,
  ): { buzzVolume: number; buzzPitchHz: number } {
    const closeness = this.computeDepthCloseness(z);
    // Nonlinear depth loudness curve: quiet in rear (~0.08), loud & intense in foreground (1.0)
    const speedEnergy = clamp(speed * 0.35, 0, 0.18);
    const buzzVolume = clamp(0.08 + Math.pow(closeness, 1.75) * 0.84 + speedEnergy * closeness, 0.06, 1.0);

    // Higher wingbeat pitch as Z gets closer (+150 Hz depth rise) + speed & Z-approach Doppler shift
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

    // Blend in AI-suggested swarm strategy pattern bias
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
        // Swoop toward foreground lens and the player's detected ears/face for thrilling spatial ear buzz!
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
        // Pull back toward rear layer
        m.vz += 0.34 * speedFactor * dt;
        m.vx += Math.sin(m.patternPhase * 3.8) * 0.45 * dt;
        m.vy += Math.cos(m.patternPhase * 3.2) * 0.4 * dt;
        break;
      }
    }
  }

  private computeDepthScale(z: number): number {
    // Perspective projection: z = 0.08 -> ~1.95x foreground giant; z = 1.0 -> ~0.58x distant rear
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
