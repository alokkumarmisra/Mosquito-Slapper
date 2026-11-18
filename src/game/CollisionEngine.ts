import {
  AttackEvent,
  GameSettings,
  HitResolution,
  MosquitoEntity,
  Point2D,
} from '../types/game';

/**
 * Shortest distance from point (px, py) to line segment (ax, ay)-(bx, by).
 */
function pointToSegmentDistance(
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

  if (lenSq <= 1e-6) {
    return Math.hypot(px - ax, py - ay);
  }

  let t = (wx * vx + wy * vy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;

  const projX = ax + t * vx;
  const projY = ay + t * vy;
  return Math.hypot(px - projX, py - projY);
}

/**
 * Deterministic geometric collision engine.
 * Never fakes hits: kills ONLY mosquitoes whose depth-scaled hitboxes physically
 * intersect the clap impact zone or single-hand swept slap capsule.
 */
export class CollisionEngine {
  public evaluateAttack(
    attack: AttackEvent,
    mosquitoes: MosquitoEntity[],
    viewportW: number,
    viewportH: number,
    settings: GameSettings,
    previousCombo: number,
  ): HitResolution {
    const attackRadiusPx = attack.radius * viewportW;
    const hitList: MosquitoEntity[] = [];

    if (attack.kind === 'CLAP') {
      const cx = attack.position.x * viewportW;
      const cy = attack.position.y * viewportH;

      for (const m of mosquitoes) {
        if (!m.alive) continue;
        const dist = Math.hypot(m.screenX - cx, m.screenY - cy);
        if (dist <= attackRadiusPx + m.hitboxRadiusPx) {
          hitList.push(m);
        }
      }
    } else {
      // Single-hand SLAP: swept capsule across trajectory segments
      const pts: Point2D[] =
        attack.trajectory.length >= 2
          ? attack.trajectory
          : [
              {
                x: attack.position.x - attack.direction.x * 0.05,
                y: attack.position.y - attack.direction.y * 0.05,
              },
              attack.position,
            ];

      for (const m of mosquitoes) {
        if (!m.alive) continue;
        let minDist = Infinity;
        for (let i = 0; i < pts.length - 1; i++) {
          const ax = pts[i].x * viewportW;
          const ay = pts[i].y * viewportH;
          const bx = pts[i + 1].x * viewportW;
          const by = pts[i + 1].y * viewportH;
          const d = pointToSegmentDistance(m.screenX, m.screenY, ax, ay, bx, by);
          if (d < minDist) minDist = d;
        }
        const directPosDist = Math.hypot(
          m.screenX - attack.position.x * viewportW,
          m.screenY - attack.position.y * viewportH,
        );
        const matchesLandedRegion =
          (attack.faceZone && m.landingZone === attack.faceZone) ||
          (attack.bodyRegion && m.landingBodyRegion === attack.bodyRegion);
        const sameRegionBonus =
          matchesLandedRegion &&
          (m.animState === 'LANDED' || m.animState === 'APPROACHING_LANDING')
            ? 1.35
            : 1.0;

        if (
          minDist <= attackRadiusPx + m.hitboxRadiusPx ||
          directPosDist <= attackRadiusPx * sameRegionBonus + m.hitboxRadiusPx
        ) {
          hitList.push(m);
        }
      }
    }

    if (hitList.length === 0) {
      return {
        attack,
        killedMosquitoes: [],
        pointsAwarded: 0,
        multiKillBonus: 0,
        comboBonus: 0,
        isMiss: true,
      };
    }

    const { rewards } = settings;
    const killCount = hitList.length;
    const basePoints = killCount * rewards.normalKill;

    let multiKillBonus = 0;
    if (killCount === 2) {
      multiKillBonus = rewards.doubleKillBonus;
    } else if (killCount >= 3) {
      multiKillBonus = rewards.tripleKillBonus + (killCount - 3) * rewards.doubleKillBonus;
    }

    // Check 5-kill and 10-kill consecutive combo milestones crossed by this hit
    let comboBonus = 0;
    const newCombo = previousCombo + killCount;
    for (let step = previousCombo + 1; step <= newCombo; step++) {
      if (step > 0 && step % 10 === 0) {
        comboBonus += rewards.tenComboBonus;
      } else if (step > 0 && step % 5 === 0) {
        comboBonus += rewards.fiveComboBonus;
      }
    }

    return {
      attack,
      killedMosquitoes: hitList,
      pointsAwarded: basePoints + multiKillBonus + comboBonus,
      multiKillBonus,
      comboBonus,
      isMiss: false,
    };
  }
}
