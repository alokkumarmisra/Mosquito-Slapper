import {
  FaceAnchor,
  FaceLandingZone,
  GestureState,
  MosquitoEntity,
  Point2D,
  TrackedHand,
  VisualEffect,
} from '../types/game';
import { ALL_FACE_LANDING_ZONES, FACE_ZONE_LABELS } from '../vision/FaceTracker';

const HAND_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export interface RenderFrameParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  video: HTMLVideoElement | null;
  remoteVideoImage?: HTMLImageElement | null;
  remoteVideoMirrored?: boolean;
  backdropImage: HTMLImageElement | null;
  mirrorCamera: boolean;
  practiceMode: boolean;
  mosquitoes: MosquitoEntity[];
  hands: TrackedHand[];
  faceAnchor?: FaceAnchor;
  effects: VisualEffect[];
  showLandmarks: boolean;
  showHandPointer: boolean;
  showFaceZones?: boolean;
  showHitboxes: boolean;
  gestureState: GestureState;
  clapReadiness: number;
  practiceCursor: Point2D | null;
  nowMs: number;
}

/**
 * 6-Layer AR Renderer:
 *   Layer 1: Webcam Feed (or Remote Phone Camera Feed / Practice Backdrop)
 *   Layer 1.5: Depth-Projected Articulated Mosquito Cast Shadows
 *   Layer 2: Rear Mosquitoes (z > 0.66)
 *   Layer 3: Middle Mosquitoes (0.33 < z <= 0.66)
 *   Layer 4: Foreground Mosquitoes (z <= 0.33)
 *   Layer 5: Hand Tracking Skeleton, Pointers, Attack Sweeps & Comic Impact FX
 *   (Layer 6: HTML/CSS Game HUD sits above the canvas)
 */
export class ArenaRenderer {
  /** Unified resolution scale factor (1.0 at 720p short-axis baseline, adapts smoothly from 320p phones to 4K TVs) */
  private getResScale(width: number, height: number): number {
    return Math.max(0.62, Math.min(2.6, Math.min(width, height) / 720));
  }

  public render(params: RenderFrameParams): void {
    const {
      ctx,
      width,
      height,
      video,
      remoteVideoImage,
      remoteVideoMirrored,
      backdropImage,
      mirrorCamera,
      practiceMode,
      mosquitoes,
      hands,
      faceAnchor,
      effects,
      showLandmarks,
      showHandPointer,
      showFaceZones = true,
      showHitboxes,
      gestureState,
      clapReadiness,
      practiceCursor,
      nowMs,
    } = params;

    const resScale = this.getResScale(width, height);
    ctx.clearRect(0, 0, width, height);

    // LAYER 1: Background camera feed (local webcam, remote phone camera, or practice backdrop)
    this.drawBackground(
      ctx,
      width,
      height,
      video,
      remoteVideoImage ?? null,
      remoteVideoMirrored ?? mirrorCamera,
      backdropImage,
      mirrorCamera,
      practiceMode,
      resScale,
    );

    // LAYER 1.2: Subtle recognized face-zone AR anchors (Head, Forehead, Nose, Left & Right Cheeks)
    if (showFaceZones && !practiceMode && faceAnchor?.detected && faceAnchor.zones) {
      this.drawFaceZonesOverlay(ctx, width, height, faceAnchor, mosquitoes, nowMs, resScale);
    }

    // Bucket mosquitoes into explicit rear / middle / foreground depth layers
    const rear: MosquitoEntity[] = [];
    const middle: MosquitoEntity[] = [];
    const foreground: MosquitoEntity[] = [];

    for (const m of mosquitoes) {
      if (m.z > 0.66) rear.push(m);
      else if (m.z > 0.33) middle.push(m);
      else foreground.push(m);
    }

    // Sort each layer back-to-front by Z so closer bugs draw cleanly over farther bugs
    rear.sort((a, b) => b.z - a.z);
    middle.sort((a, b) => b.z - a.z);
    foreground.sort((a, b) => b.z - a.z);

    // LAYER 1.5: Depth-projected articulated cast shadows onto the background scene
    for (const m of rear) {
      this.drawMosquitoShadow(ctx, m, width, height, resScale);
    }
    for (const m of middle) {
      this.drawMosquitoShadow(ctx, m, width, height, resScale);
    }
    for (const m of foreground) {
      this.drawMosquitoShadow(ctx, m, width, height, resScale);
    }

    // LAYER 2: Rear mosquito layer
    for (const m of rear) {
      this.drawMosquito(ctx, m, 'rear', showHitboxes, nowMs, resScale);
    }

    // LAYER 3: Middle mosquito layer
    for (const m of middle) {
      this.drawMosquito(ctx, m, 'middle', showHitboxes, nowMs, resScale);
    }

    // LAYER 4: Foreground mosquito layer (appears right between player & webcam)
    for (const m of foreground) {
      this.drawMosquito(ctx, m, 'foreground', showHitboxes, nowMs, resScale);
    }

    // LAYER 5: Hand tracking overlays, clap convergence arc, slap sweeps, & comic FX
    this.drawEffects(ctx, width, height, effects, nowMs, resScale);
    this.drawHandsOverlay(
      ctx,
      width,
      height,
      hands,
      showLandmarks,
      showHandPointer,
      gestureState,
      clapReadiness,
      practiceMode,
      practiceCursor,
      resScale,
    );
  }

  private drawBackground(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    video: HTMLVideoElement | null,
    remoteVideoImage: HTMLImageElement | null,
    remoteVideoMirrored: boolean,
    backdropImage: HTMLImageElement | null,
    mirrorCamera: boolean,
    practiceMode: boolean,
    resScale: number,
  ): void {
    const hasLiveVideo = !practiceMode && video && video.readyState >= 2 && video.videoWidth > 0;
    const hasRemoteRelay =
      !practiceMode &&
      !hasLiveVideo &&
      remoteVideoImage &&
      remoteVideoImage.complete &&
      remoteVideoImage.naturalWidth > 0;

    if (hasLiveVideo && video) {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(width / vw, height / vh);
      const drawW = vw * scale;
      const drawH = vh * scale;
      const dx = (width - drawW) * 0.5;
      const dy = (height - drawH) * 0.5;

      ctx.save();
      if (mirrorCamera) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(video, dx, dy, drawW, drawH);
      ctx.restore();
    } else if (hasRemoteRelay && remoteVideoImage) {
      const iw = remoteVideoImage.naturalWidth;
      const ih = remoteVideoImage.naturalHeight;
      const scale = Math.max(width / iw, height / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const dx = (width - drawW) * 0.5;
      const dy = (height - drawH) * 0.5;

      ctx.save();
      if (remoteVideoMirrored) {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(remoteVideoImage, dx, dy, drawW, drawH);
      ctx.restore();
    } else if (backdropImage && backdropImage.complete && backdropImage.naturalWidth > 0) {
      const iw = backdropImage.naturalWidth;
      const ih = backdropImage.naturalHeight;
      const scale = Math.max(width / iw, height / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const dx = (width - drawW) * 0.5;
      const dy = (height - drawH) * 0.5;
      ctx.drawImage(backdropImage, dx, dy, drawW, drawH);
      // Subtle atmospheric warmth vignette
      ctx.fillStyle = 'rgba(14, 19, 16, 0.22)';
      ctx.fillRect(0, 0, width, height);
    } else {
      const grad = ctx.createRadialGradient(
        width * 0.5,
        height * 0.45,
        width * 0.08,
        width * 0.5,
        height * 0.5,
        width * 0.72,
      );
      grad.addColorStop(0, '#1C2620');
      grad.addColorStop(1, '#0E1310');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);
    }

    // Subtle edge scrims scaled proportionally to viewport height for HUD/dock legibility on every screen
    const scrimH = Math.min(height * 0.16, 110 * resScale);
    const topScrim = ctx.createLinearGradient(0, 0, 0, scrimH);
    topScrim.addColorStop(0, 'rgba(10, 14, 11, 0.76)');
    topScrim.addColorStop(1, 'rgba(10, 14, 11, 0)');
    ctx.fillStyle = topScrim;
    ctx.fillRect(0, 0, width, scrimH);

    const botScrim = ctx.createLinearGradient(0, height - scrimH, 0, height);
    botScrim.addColorStop(0, 'rgba(10, 14, 11, 0)');
    botScrim.addColorStop(1, 'rgba(10, 14, 11, 0.78)');
    ctx.fillStyle = botScrim;
    ctx.fillRect(0, height - scrimH, width, scrimH);
  }

  /**
   * Subtle, low-occlusion AR markers for the recognized person's Head, Forehead, Nose,
   * Left Cheek, and Right Cheek. Highlights a zone warmly when a mosquito is descending
   * onto or currently perched on that landmark.
   */
  private drawFaceZonesOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    faceAnchor: FaceAnchor,
    mosquitoes: MosquitoEntity[],
    nowMs: number,
    resScale: number,
  ): void {
    const targetedZones = new Set<FaceLandingZone>();
    const landedZones = new Set<FaceLandingZone>();
    for (const m of mosquitoes) {
      if (!m.alive || !m.landingZone) continue;
      if (m.animState === 'LANDED') landedZones.add(m.landingZone);
      else if (m.animState === 'APPROACHING_LANDING') targetedZones.add(m.landingZone);
    }

    ctx.save();

    // 1. Delicate head contour outline (when FaceLandmarker 18-point oval is available)
    if (faceAnchor.headOutline && faceAnchor.headOutline.length >= 6) {
      ctx.strokeStyle =
        landedZones.size > 0
          ? 'rgba(255, 107, 53, 0.28)'
          : 'rgba(200, 245, 66, 0.18)';
      ctx.lineWidth = 1.25 * resScale;
      ctx.setLineDash([5 * resScale, 6 * resScale]);
      ctx.beginPath();
      for (let i = 0; i < faceAnchor.headOutline.length; i++) {
        const p = faceAnchor.headOutline[i];
        if (i === 0) ctx.moveTo(p.x * width, p.y * height);
        else ctx.lineTo(p.x * width, p.y * height);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.0085);

    // 2. Individual anatomical zone markers (Head, Forehead, Nose, Left Cheek, Right Cheek)
    for (const zoneKey of ALL_FACE_LANDING_ZONES) {
      const z = faceAnchor.zones[zoneKey];
      if (!z) continue;
      const zx = z.point.x * width;
      const zy = z.point.y * height;
      const isLanded = landedZones.has(zoneKey);
      const isTargeted = targetedZones.has(zoneKey);

      const r = Math.max(9 * resScale, Math.min(24 * resScale, z.radius * width * 0.42));

      if (isLanded || isTargeted) {
        // Active alert ring around the targeted / landed facial feature
        ctx.strokeStyle = isLanded
          ? `rgba(255, 107, 53, ${0.65 + pulse * 0.35})`
          : `rgba(200, 245, 66, ${0.5 + pulse * 0.35})`;
        ctx.lineWidth = (isLanded ? 2.2 : 1.6) * resScale;
        ctx.beginPath();
        ctx.arc(zx, zy, r + (isLanded ? pulse * 6 : pulse * 4) * resScale, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Minimalist crosshair node
      ctx.strokeStyle = isLanded
        ? 'rgba(255, 107, 53, 0.9)'
        : isTargeted
          ? 'rgba(200, 245, 66, 0.85)'
          : 'rgba(200, 245, 66, 0.42)';
      ctx.lineWidth = 1.25 * resScale;
      const tick = (isLanded ? 6 : 4) * resScale;
      const gap = 3 * resScale;
      ctx.beginPath();
      ctx.moveTo(zx - tick - gap, zy);
      ctx.lineTo(zx - gap, zy);
      ctx.moveTo(zx + gap, zy);
      ctx.lineTo(zx + tick + gap, zy);
      ctx.moveTo(zx, zy - tick - gap);
      ctx.lineTo(zx, zy - gap);
      ctx.moveTo(zx, zy + gap);
      ctx.lineTo(zx, zy + tick + gap);
      ctx.stroke();

      ctx.fillStyle = isLanded
        ? '#FF6B35'
        : isTargeted
          ? '#C8F542'
          : 'rgba(200, 245, 66, 0.55)';
      ctx.beginPath();
      ctx.arc(zx, zy, (isLanded ? 2.8 : 2.0) * resScale, 0, Math.PI * 2);
      ctx.fill();

      // Clean unboxed anatomical micro-label
      const shortLabel =
        zoneKey === 'LEFT_CHEEK'
          ? 'L Cheek'
          : zoneKey === 'RIGHT_CHEEK'
            ? 'R Cheek'
            : FACE_ZONE_LABELS[zoneKey];
      const displayLabel = isLanded ? `HIT ${shortLabel.toUpperCase()}!` : shortLabel;
      const fontPx = Math.round((isLanded ? 11 : 9.8) * resScale);

      ctx.font = `${isLanded ? '700' : '500'} ${fontPx}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 2.8 * resScale;
      ctx.strokeStyle = 'rgba(11, 15, 12, 0.82)';
      const labelY = zoneKey === 'HEAD' ? zy - 18 * resScale : zy + 10 * resScale;
      ctx.strokeText(displayLabel, zx, labelY);
      ctx.fillStyle = isLanded
        ? '#FF8A5C'
        : isTargeted
          ? '#C8F542'
          : 'rgba(244, 247, 242, 0.68)';
      ctx.fillText(displayLabel, zx, labelY);
    }

    ctx.restore();
  }

  /**
   * Projects an articulated mosquito silhouette shadow onto the background plane behind it.
   * Uses Z-depth to control shadow separation distance, scale, and softness (penumbra vs umbra)
   * so the player can instantly perceive each mosquito's 3D height & depth in front of the camera.
   * When perched (LANDED) on the player's face, pulls into a tight grounded skin-contact shadow!
   */
  private drawMosquitoShadow(
    ctx: CanvasRenderingContext2D,
    m: MosquitoEntity,
    viewportW: number,
    viewportH: number,
    resScale: number,
  ): void {
    const lifeFade = !m.alive ? Math.max(0, 1 - m.deathTimer / 0.72) : 1;
    if (lifeFade <= 0.02) return;

    const isLanded = m.alive && m.animState === 'LANDED';
    const settle = isLanded ? (m.landingProgress ?? 1) : 0;

    // 0 = rear near background wall (tight, crisp shadow); 1 = foreground near camera (wide, offset, softer shadow)
    const elevation = Math.max(0, Math.min(1, (1.0 - m.z) / 0.92)) * (1 - settle * 0.92);
    const resScaleX = viewportW / 1280;
    const resScaleY = viewportH / 720;

    // Natural overhead-left room light + camera perspective parallax offset (collapses tight under legs when landed!)
    const offsetX =
      (isLanded ? 3.5 : 8 + elevation * 38 + (m.x - 0.5) * elevation * 34) * resScaleX;
    const offsetY =
      (isLanded ? 7.5 : 12 + elevation * 52 + (m.y - 0.35) * elevation * 22) * resScaleY;

    const sx = m.screenX + offsetX;
    const sy = m.screenY + offsetY;
    const facingLeft = Math.cos(m.direction) < 0;
    const baseScale = m.baseSize * m.depthScale * resScale * (isLanded ? 0.94 : 0.9 + elevation * 0.24);

    // Tighter & darker when landed on skin or close to backdrop; softer & broader when floating near camera
    const penumbraAlpha = (isLanded ? 0.34 : 0.28 - elevation * 0.08) * lifeFade;
    const umbraAlpha = (isLanded ? 0.52 : 0.44 - elevation * 0.16) * lifeFade;

    ctx.save();
    ctx.translate(sx, sy);

    // 1. Soft feathered ambient radial penumbra (ensures shadow reads cleanly over bright & dark camera frames)
    const haloRadius = (26 + elevation * 18) * baseScale;
    const grad = ctx.createRadialGradient(0, 0, haloRadius * 0.12, 0, 0, haloRadius);
    grad.addColorStop(0, `rgba(4, 8, 6, ${penumbraAlpha})`);
    grad.addColorStop(0.55, `rgba(4, 8, 6, ${penumbraAlpha * 0.42})`);
    grad.addColorStop(1, 'rgba(4, 8, 6, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, haloRadius * 1.15, haloRadius * 0.72, m.rotation * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // 2. Articulated mosquito cast silhouette (synchronized rotation, facing, & wingbeat)
    ctx.rotate(m.rotation);
    if (facingLeft) {
      ctx.scale(-1, 1);
    }

    const wingFlapA = Math.sin(m.wingPhase) * 0.72;
    const wingFlapB = Math.sin(m.wingPhase + 1.1) * 0.55;

    // Outer soft shadow blur pass (scales slightly larger with elevation to mimic penumbra spread)
    this.traceMosquitoShadowSilhouette(
      ctx,
      baseScale * (1.06 + elevation * 0.16),
      wingFlapA,
      wingFlapB,
      `rgba(4, 8, 6, ${umbraAlpha * 0.42})`,
    );

    // Inner sharper umbra core silhouette
    this.traceMosquitoShadowSilhouette(
      ctx,
      baseScale * 0.96,
      wingFlapA,
      wingFlapB,
      `rgba(4, 8, 6, ${umbraAlpha})`,
    );

    ctx.restore();
  }

  private traceMosquitoShadowSilhouette(
    ctx: CanvasRenderingContext2D,
    scale: number,
    wingFlapA: number,
    wingFlapB: number,
    fillStyle: string,
  ): void {
    ctx.save();
    ctx.scale(scale, scale * 0.78);
    ctx.fillStyle = fillStyle;
    ctx.strokeStyle = fillStyle;

    // Back wing shadow
    ctx.save();
    ctx.translate(-2, -4);
    ctx.rotate(-0.65 + wingFlapB);
    ctx.beginPath();
    ctx.ellipse(-10, -8, 17, 5.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Front wing shadow
    ctx.save();
    ctx.translate(1, -5);
    ctx.rotate(-0.35 - wingFlapA);
    ctx.beginPath();
    ctx.ellipse(-8, -10, 19, 6.2, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Abdomen + thorax + head silhouette
    ctx.save();
    ctx.rotate(0.22);
    ctx.beginPath();
    ctx.ellipse(-15, 2, 13.5, 5.2, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.ellipse(0, 0, 8.2, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(10.5, -1.5, 5.5, 0, Math.PI * 2);
    ctx.fill();

    // Proboscis & slender leg shadows
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15, -0.5);
    ctx.lineTo(27.5, 3.2);
    ctx.moveTo(5, 3);
    ctx.lineTo(15, 16);
    ctx.moveTo(0, 4);
    ctx.lineTo(-4, 20);
    ctx.moveTo(-6, 4);
    ctx.lineTo(-22, 17);
    ctx.stroke();

    ctx.restore();
  }

  private drawMosquito(
    ctx: CanvasRenderingContext2D,
    m: MosquitoEntity,
    layer: 'rear' | 'middle' | 'foreground',
    showHitboxes: boolean,
    nowMs = 0,
    resScale = 1,
  ): void {
    const isLanded = m.alive && m.animState === 'LANDED';
    const scale = m.baseSize * m.depthScale * resScale * (isLanded ? 0.96 : 1.08);
    const facingLeft = Math.cos(m.direction) < 0;
    const alpha = !m.alive
      ? Math.max(0, 1 - m.deathTimer / 0.72)
      : layer === 'rear'
        ? 0.78
        : layer === 'middle'
          ? 0.94
          : 1.0;

    // Velocity-based motion blur ghost trail on fast darts (not when landed)
    if (m.alive && !isLanded && m.speed > 0.24 && m.trail.length >= 3) {
      ctx.save();
      for (let i = 0; i < m.trail.length - 1; i++) {
        const pt = m.trail[i];
        const t = (i + 1) / m.trail.length;
        ctx.fillStyle =
          layer === 'foreground'
            ? `rgba(200, 245, 66, ${t * 0.14})`
            : `rgba(24, 28, 25, ${t * 0.18})`;
        ctx.beginPath();
        ctx.ellipse(pt.x, pt.y, 10 * scale * t, 5 * scale * t, m.rotation, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(m.screenX, m.screenY);
    ctx.globalAlpha = alpha;

    // Subtle pulsing alert halo around a mosquito perched on your head/nose/forehead/cheek
    if (isLanded) {
      const pulse = 0.5 + 0.5 * Math.sin(nowMs * 0.011);
      ctx.save();
      ctx.strokeStyle = `rgba(255, 107, 53, ${0.42 + pulse * 0.45})`;
      ctx.lineWidth = 2 * resScale;
      ctx.beginPath();
      ctx.arc(0, 0, (24 + pulse * 10) * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Optional hitbox visualization (when enabled in settings)
    if (showHitboxes && m.alive) {
      ctx.save();
      ctx.strokeStyle =
        layer === 'foreground'
          ? 'rgba(200, 245, 66, 0.7)'
          : layer === 'middle'
            ? 'rgba(255, 165, 66, 0.55)'
            : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, m.hitboxRadiusPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Apply body bank tilt & facing flip (plus subtle proboscis dip when perched & nibbling)
    const nibbleDip = isLanded ? Math.sin(m.bitePulsePhase ?? 0) * 0.12 + 0.14 : 0;
    ctx.rotate(m.rotation + (facingLeft ? -nibbleDip : nibbleDip));
    if (facingLeft) {
      ctx.scale(-1, 1);
    }
    ctx.scale(scale, scale);

    // Dying squash deformation
    if (!m.alive) {
      ctx.scale(1.3, 0.55);
    }

    // Wings buzz rapidly in flight; fold neatly back with occasional tiny twitch while landed
    const wingFlapA = isLanded ? -0.45 + Math.sin(m.wingPhase) * 0.07 : Math.sin(m.wingPhase) * 0.72;
    const wingFlapB = isLanded ? 0.52 + Math.sin(m.wingPhase + 0.8) * 0.05 : Math.sin(m.wingPhase + 1.1) * 0.55;

    // 1. Articulated legs (planted tripod stance when landed vs dangling in flight)
    ctx.strokeStyle = '#181C19';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const legSwing = isLanded ? 0 : Math.sin(m.wingPhase * 0.18) * 2.2;

    const legRoots = isLanded
      ? [
          { rx: 6, ry: 3, mx: 15, my: 9, ex: 22, ey: 14 },
          { rx: 0, ry: 4, mx: 1, my: 11, ex: -1, ey: 16 },
          { rx: -7, ry: 4, mx: -17, my: 9, ex: -26, ey: 14 },
        ]
      : [
          { rx: 5, ry: 3, mx: 13, my: 11 + legSwing, ex: 18, ey: 19 },
          { rx: 0, ry: 4, mx: -2, my: 14 - legSwing, ex: -6, ey: 24 },
          { rx: -6, ry: 4, mx: -16, my: 12 + legSwing, ex: -25, ey: 20 },
        ];
    for (const leg of legRoots) {
      ctx.beginPath();
      ctx.moveTo(leg.rx, leg.ry);
      ctx.lineTo(leg.mx, leg.my);
      ctx.lineTo(leg.ex, leg.ey);
      ctx.stroke();
    }

    // 2. Back translucent buzzing wing
    ctx.save();
    ctx.translate(-2, -4);
    ctx.rotate(-0.65 + wingFlapB);
    ctx.fillStyle = 'rgba(232, 246, 255, 0.52)';
    ctx.strokeStyle = 'rgba(40, 52, 46, 0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(-10, -8, 17, 5.5, -0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 3. Striped elongated abdomen (distinctive tiger mosquito silhouette)
    ctx.save();
    ctx.rotate(0.22);
    ctx.fillStyle = '#252B26';
    ctx.strokeStyle = '#0B0E0C';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.ellipse(-15, 2, 13.5, 5.2, 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Crisp pale-yellow arcade stripes on abdomen so it pops over ANY webcam background!
    ctx.strokeStyle = '#D9F97A';
    ctx.lineWidth = 2.0;
    for (const sx of [-22, -17, -12, -7]) {
      ctx.beginPath();
      ctx.moveTo(sx, -2.5);
      ctx.lineTo(sx - 1, 6.2);
      ctx.stroke();
    }
    ctx.restore();

    // 4. Thorax
    ctx.fillStyle = '#2E3730';
    ctx.strokeStyle = '#0B0E0C';
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.2, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Subtle chartreuse dorsal highlight
    ctx.fillStyle = '#B7E637';
    ctx.beginPath();
    ctx.ellipse(0, -2.2, 4.8, 2.2, -0.1, 0, Math.PI * 2);
    ctx.fill();

    // 5. Front buzzing wing with speed-blur arc
    ctx.save();
    ctx.translate(1, -5);
    ctx.rotate(-0.35 - wingFlapA);
    ctx.fillStyle = 'rgba(244, 252, 255, 0.72)';
    ctx.strokeStyle = 'rgba(20, 26, 22, 0.65)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(-8, -10, 19, 6.2, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Wing vein
    ctx.strokeStyle = 'rgba(200, 245, 66, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(2, -5);
    ctx.lineTo(-22, -12);
    ctx.stroke();
    ctx.restore();

    // 6. Head & cheeky cartoon eyes + aviator brow
    ctx.fillStyle = '#1E2420';
    ctx.strokeStyle = '#0B0E0C';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(10.5, -1.5, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Expressive eye (X-eyes when dying!)
    if (!m.alive) {
      ctx.strokeStyle = '#FF6B35';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(10, -4.5);
      ctx.lineTo(14.5, 0);
      ctx.moveTo(14.5, -4.5);
      ctx.lineTo(10, 0);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#FFFDF5';
      ctx.beginPath();
      ctx.arc(12.2, -2.4, 2.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0E1310';
      ctx.beginPath();
      ctx.arc(13.2, -2.2, 1.35, 0, Math.PI * 2);
      ctx.fill();
      // Mischievous angled eyebrow
      ctx.strokeStyle = '#FF6B35';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(9.4, -6.2);
      ctx.lineTo(14.6, -4.4);
      ctx.stroke();
    }

    // 7. Needle proboscis (the iconic mosquito stinger!)
    ctx.strokeStyle = '#FF6B35';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(15.5, -0.5);
    ctx.lineTo(28.5, 3.5);
    ctx.stroke();

    // Tiny antennae
    ctx.strokeStyle = '#D9F97A';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(13, -6);
    ctx.quadraticCurveTo(17, -12, 21, -10);
    ctx.moveTo(11, -6.5);
    ctx.quadraticCurveTo(13, -13, 17, -13.5);
    ctx.stroke();

    ctx.restore();

    // 8. Optional floating funny taunt dialogue speech bubble
    if (m.alive && m.tauntText) {
      ctx.save();
      const tauntFontPx = Math.round(12 * resScale);
      ctx.font = `600 ${tauntFontPx}px "Plus Jakarta Sans", sans-serif`;
      const padX = 10 * resScale;
      const textW = ctx.measureText(m.tauntText).width;
      const boxW = Math.min(Math.min(ctx.canvas.width - 24 * resScale, 240 * resScale), textW + padX * 2);
      const boxH = 26 * resScale;
      const bx = Math.max(12 * resScale, Math.min(ctx.canvas.width - boxW - 12 * resScale, m.screenX - boxW * 0.5));
      const by = Math.max(66 * resScale, m.screenY - 38 * scale - boxH);

      ctx.fillStyle = 'rgba(17, 22, 19, 0.9)';
      ctx.strokeStyle = 'rgba(200, 245, 66, 0.7)';
      ctx.lineWidth = 1.4 * resScale;
      this.roundRect(ctx, bx, by, boxW, boxH, 8 * resScale);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#F4F7F2';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(m.tauntText, bx + boxW * 0.5, by + boxH * 0.5, boxW - 12 * resScale);
      ctx.restore();
    }
  }

  private drawHandsOverlay(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    hands: TrackedHand[],
    showLandmarks: boolean,
    showHandPointer: boolean,
    gestureState: GestureState,
    clapReadiness: number,
    practiceMode: boolean,
    practiceCursor: Point2D | null,
    resScale: number,
  ): void {
    // Draw closing clap convergence line between palms when both hands are visible and pointer symbol is enabled
    if (showHandPointer && hands.length >= 2) {
      const p1 = { x: hands[0].palm.x * width, y: hands[0].palm.y * height };
      const p2 = { x: hands[1].palm.x * width, y: hands[1].palm.y * height };
      const mid = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };

      ctx.save();
      const activeClap = clapReadiness > 0.25;
      ctx.strokeStyle = activeClap
        ? `rgba(200, 245, 66, ${0.45 + clapReadiness * 0.5})`
        : 'rgba(244, 247, 242, 0.24)';
      ctx.lineWidth = (activeClap ? 2.5 + clapReadiness * 2 : 1.2) * resScale;
      ctx.setLineDash(activeClap ? [8 * resScale, 5 * resScale] : [4 * resScale, 6 * resScale]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      if (activeClap) {
        // Clap midpoint preview reticle
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(255, 107, 53, ${0.5 + clapReadiness * 0.5})`;
        ctx.lineWidth = 2.5 * resScale;
        const r = (18 + (1 - clapReadiness) * 34) * resScale;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const hand of hands) {
      const px = hand.palm.x * width;
      const py = hand.palm.y * height;
      const isLeft = hand.side === 'Left';
      const accent = isLeft ? '#38BDF8' : '#C8F542';
      const activeAttack =
        gestureState === GestureState.ATTACK_IN_PROGRESS ||
        gestureState === GestureState.ATTACK_CONFIRMED;

      // 1. Hand landmark skeleton (if enabled)
      if (showLandmarks && hand.landmarks.length >= 21) {
        ctx.save();
        ctx.strokeStyle = isLeft ? 'rgba(56, 189, 248, 0.55)' : 'rgba(200, 245, 66, 0.55)';
        ctx.lineWidth = 2 * resScale;
        ctx.lineCap = 'round';

        for (const [aIdx, bIdx] of HAND_CONNECTIONS) {
          const a = hand.landmarks[aIdx];
          const b = hand.landmarks[bIdx];
          ctx.beginPath();
          ctx.moveTo(a.x * width, a.y * height);
          ctx.lineTo(b.x * width, b.y * height);
          ctx.stroke();
        }

        for (let i = 0; i < hand.landmarks.length; i++) {
          const lm = hand.landmarks[i];
          const isTip = i === 4 || i === 8 || i === 12 || i === 16 || i === 20;
          ctx.fillStyle = isTip ? '#FF6B35' : accent;
          ctx.beginPath();
          ctx.arc(lm.x * width, lm.y * height, (isTip ? 4.2 : 2.6) * resScale, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // 2. Velocity motion trail ribbon & palm pointer symbol (when showHandPointer is enabled)
      if (showHandPointer) {
        if (hand.speed > 0.55 && hand.history.length >= 2) {
          ctx.save();
          ctx.strokeStyle = activeAttack ? 'rgba(255, 107, 53, 0.78)' : 'rgba(200, 245, 66, 0.42)';
          ctx.lineWidth = Math.min(18, 4 + hand.speed * 4) * resScale;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          for (let i = 0; i < hand.history.length; i++) {
            const pt = hand.history[i];
            if (i === 0) ctx.moveTo(pt.x * width, pt.y * height);
            else ctx.lineTo(pt.x * width, pt.y * height);
          }
          ctx.stroke();
          ctx.restore();
        }

        // 3. Palm pointer reticle + Left/Right & Open Palm / Fist label
        ctx.save();
        const ringR = Math.max(18 * resScale, hand.palmRadius * width * 0.52);
        ctx.strokeStyle = activeAttack ? '#FF6B35' : accent;
        ctx.lineWidth = (activeAttack ? 3.2 : 2.2) * resScale;
        ctx.beginPath();
        ctx.arc(px, py, ringR, 0, Math.PI * 2);
        ctx.stroke();

        // Inner crosshair
        ctx.fillStyle = activeAttack ? '#FF6B35' : accent;
        ctx.beginPath();
        ctx.arc(px, py, 4.5 * resScale, 0, Math.PI * 2);
        ctx.fill();

        // Clean unboxed text label below palm (with crisp stroke halo for any lighting)
        const poseLabel =
          hand.pose === 'OPEN_PALM' ? 'Open' : hand.pose === 'CLOSED_FIST' ? 'Fist' : 'Hand';
        const label = `${hand.side} · ${poseLabel}`;
        ctx.font = `600 ${Math.round(11 * resScale)}px "JetBrains Mono", monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3 * resScale;
        ctx.strokeStyle = 'rgba(11, 15, 12, 0.88)';
        ctx.strokeText(label, px, py + ringR + 7 * resScale);
        ctx.fillStyle = accent;
        ctx.fillText(label, px, py + ringR + 7 * resScale);
        ctx.restore();
      }
    }

    // Practice Mode pointer reticle (only when practiceMode and showHandPointer are enabled)
    if (practiceMode && showHandPointer && practiceCursor) {
      const cx = practiceCursor.x * width;
      const cy = practiceCursor.y * height;
      ctx.save();
      ctx.strokeStyle = '#C8F542';
      ctx.lineWidth = 2 * resScale;
      ctx.beginPath();
      ctx.arc(cx, cy, 22 * resScale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - 28 * resScale, cy);
      ctx.lineTo(cx - 14 * resScale, cy);
      ctx.moveTo(cx + 14 * resScale, cy);
      ctx.lineTo(cx + 28 * resScale, cy);
      ctx.moveTo(cx, cy - 28 * resScale);
      ctx.lineTo(cx, cy - 14 * resScale);
      ctx.moveTo(cx, cy + 14 * resScale);
      ctx.lineTo(cx, cy + 28 * resScale);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawEffects(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    effects: VisualEffect[],
    nowMs: number,
    resScale: number,
  ): void {
    for (const fx of effects) {
      const elapsed = nowMs - fx.createdAt;
      const progress = Math.min(1, Math.max(0, elapsed / fx.durationMs));
      const inv = 1 - progress;

      if (fx.kind === 'CLAP_RING') {
        const cx = fx.x * width;
        const cy = fx.y * height;
        const maxR = (fx.radius ?? 0.08) * width * (1.1 + progress * 0.45);
        ctx.save();
        ctx.globalAlpha = inv * 0.9;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 5 * inv + 1;
        ctx.beginPath();
        ctx.arc(cx, cy, maxR * (0.45 + progress * 0.6), 0, Math.PI * 2);
        ctx.stroke();

        // Inner cartoon shock-rays
        const rayCount = 10;
        for (let i = 0; i < rayCount; i++) {
          const ang = (i / rayCount) * Math.PI * 2;
          const r1 = maxR * (0.35 + progress * 0.4);
          const r2 = maxR * (0.65 + progress * 0.5);
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
          ctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2);
          ctx.stroke();
        }
        ctx.restore();
      } else if (fx.kind === 'SLAP_SWEEP' && fx.trajectory && fx.trajectory.length >= 2) {
        ctx.save();
        ctx.globalAlpha = inv * 0.88;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = (fx.radius ?? 0.05) * width * 0.52 * inv + 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        for (let i = 0; i < fx.trajectory.length; i++) {
          const pt = fx.trajectory[i];
          if (i === 0) ctx.moveTo(pt.x * width, pt.y * height);
          else ctx.lineTo(pt.x * width, pt.y * height);
        }
        ctx.stroke();
        ctx.restore();
      } else if (fx.kind === 'FACE_ZONE_RIPPLE') {
        // Subtle staggered concentric ripple rings at the face-zone collision point
        const cx = fx.x * width;
        const cy = fx.y * height;
        const baseSpan =
          Math.max(46 * resScale, Math.min(115 * resScale, Math.min(width, height) * 0.088)) *
          (fx.scale ?? 1);

        ctx.save();

        // 1. Soft, brief warm contact bloom right on impact (first 32% of duration)
        if (progress < 0.32) {
          const flashT = progress / 0.32;
          const flashAlpha = (1 - flashT) * 0.26;
          const flashR = baseSpan * (0.22 + flashT * 0.34);
          const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, flashR);
          bloom.addColorStop(0, `rgba(255, 138, 92, ${flashAlpha})`);
          bloom.addColorStop(0.55, `rgba(255, 107, 53, ${flashAlpha * 0.45})`);
          bloom.addColorStop(1, 'rgba(255, 107, 53, 0)');
          ctx.fillStyle = bloom;
          ctx.beginPath();
          ctx.arc(cx, cy, flashR, 0, Math.PI * 2);
          ctx.fill();
        }

        // 2. Three staggered concentric ripple rings with smooth cubic ease-out expansion
        const waves = [
          { delay: 0.0, span: 0.92, maxAlpha: 0.72, startWidth: 2.6, color: fx.color, dashed: false },
          { delay: 0.14, span: 0.84, maxAlpha: 0.5, startWidth: 1.8, color: '#FFD4BF', dashed: false },
          { delay: 0.26, span: 0.74, maxAlpha: 0.42, startWidth: 1.35, color: '#C8F542', dashed: true },
        ];

        for (let w = 0; w < waves.length; w++) {
          const wave = waves[w];
          if (progress < wave.delay) continue;
          const localT = Math.min(1, (progress - wave.delay) / wave.span);
          const easeOut = 1 - Math.pow(1 - localT, 3);
          const fadeOut = Math.pow(1 - localT, 1.45);
          const r = baseSpan * (0.16 + easeOut * (0.82 + w * 0.14));

          ctx.save();
          ctx.globalAlpha = wave.maxAlpha * fadeOut;
          ctx.strokeStyle = wave.color;
          ctx.lineWidth = Math.max(0.6 * resScale, wave.startWidth * resScale * (1 - localT * 0.72));
          if (wave.dashed) {
            ctx.setLineDash([4 * resScale, 5 * resScale]);
          }
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();

          // Delicate 4-direction AR zone crosshair ticks riding the leading ripple
          if (w === 0 && localT < 0.75) {
            const tickAlpha = (1 - localT / 0.75) * 0.65;
            const tickLen = (4 + (1 - localT) * 4) * resScale;
            const innerTick = 1.5 * resScale;
            ctx.globalAlpha = tickAlpha;
            ctx.lineWidth = 1.4 * resScale;
            ctx.beginPath();
            ctx.moveTo(cx - r - tickLen, cy);
            ctx.lineTo(cx - r + innerTick, cy);
            ctx.moveTo(cx + r - innerTick, cy);
            ctx.lineTo(cx + r + tickLen, cy);
            ctx.moveTo(cx, cy - r - tickLen);
            ctx.lineTo(cx, cy - r + innerTick);
            ctx.moveTo(cx, cy + r - innerTick);
            ctx.lineTo(cx, cy + r + tickLen);
            ctx.stroke();
          }
          ctx.restore();
        }

        ctx.restore();
      } else if (fx.kind === 'KILL_SPLAT') {
        // Blood-free comic starburst explosion + dizzy stars + onomatopoeia
        const cx = fx.x * width;
        const cy = fx.y * height;
        const burstScale = 0.65 + Math.sin(Math.min(1, progress * 2.2) * Math.PI * 0.5) * 0.65;
        const baseR = 40 * resScale * (fx.scale ?? 1) * burstScale;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = inv;

        // Jagged comic starburst polygon (vibrant chartreuse/tangerine, 100% blood-free)
        const spikes = 12;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
          const r = i % 2 === 0 ? baseR : baseR * 0.52;
          const ang = (i / (spikes * 2)) * Math.PI * 2 + progress * 0.45;
          const sx = Math.cos(ang) * r;
          const sy = Math.sin(ang) * r;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
        ctx.fillStyle = '#C8F542';
        ctx.strokeStyle = '#0E1310';
        ctx.lineWidth = 3 * resScale;
        ctx.fill();
        ctx.stroke();

        // Orbiting cartoon stars
        for (let s = 0; s < 5; s++) {
          const a = (s / 5) * Math.PI * 2 + progress * 5.2;
          const dist = baseR * (0.9 + progress * 0.9);
          this.drawMiniStar(ctx, Math.cos(a) * dist, Math.sin(a) * dist, (6 * inv + 2) * resScale, '#FF6B35');
        }

        // Bold comic word ("SMACK!", "POW!", "SQUISH!")
        if (fx.comicWord) {
          ctx.font = `800 ${Math.round(18 * resScale)}px "Bricolage Grotesque", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 4 * resScale;
          ctx.strokeStyle = '#0E1310';
          ctx.strokeText(fx.comicWord, 0, 0);
          ctx.fillStyle = '#FFFFFF';
          ctx.fillText(fx.comicWord, 0, 0);
        }
        ctx.restore();
      } else if (fx.kind === 'FLOAT_TEXT' || fx.kind === 'MISS_TEXT') {
        const cx = fx.x * width;
        const floatRise = (fx.kind === 'FLOAT_TEXT' ? 68 : 44) * resScale;
        const cy = fx.y * height - progress * floatRise;
        const alpha = progress < 0.72 ? 1 : (1 - progress) / 0.28;

        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const mainText = fx.text ?? '';
        const mainPx = Math.round((fx.kind === 'FLOAT_TEXT' ? 22 : 17) * resScale);
        ctx.font = `${fx.kind === 'FLOAT_TEXT' ? '800' : '700'} ${mainPx}px "Bricolage Grotesque", sans-serif`;

        // Crisp dark pill-less halo outline for instant legibility over any webcam lighting
        ctx.lineWidth = 5 * resScale;
        ctx.strokeStyle = 'rgba(11, 15, 12, 0.92)';
        ctx.strokeText(mainText, cx, cy);
        ctx.fillStyle = fx.color;
        ctx.fillText(mainText, cx, cy);

        if (fx.subtext) {
          ctx.font = `600 ${Math.round(13 * resScale)}px "Plus Jakarta Sans", sans-serif`;
          ctx.lineWidth = 4 * resScale;
          ctx.strokeStyle = 'rgba(11, 15, 12, 0.9)';
          ctx.strokeText(fx.subtext, cx, cy + 22 * resScale);
          ctx.fillStyle = '#F4F7F2';
          ctx.fillText(fx.subtext, cx, cy + 22 * resScale);
        }
        ctx.restore();
      }
    }
  }

  private drawMiniStar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    color: string,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
      if (i === 0) ctx.moveTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
      else ctx.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}
