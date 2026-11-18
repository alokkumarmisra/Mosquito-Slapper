import { FaceAnchor, MosquitoEntity, SwarmAcousticMetrics } from '../types/game';

interface MosquitoVoiceNodes {
  oscPrimary: OscillatorNode;
  oscHarmonic: OscillatorNode;
  oscSubJitter: OscillatorNode;
  harmonicGain: GainNode;
  subGain: GainNode;
  highpass: BiquadFilterNode;
  formantBody: BiquadFilterNode;
  formantAir: BiquadFilterNode;
  presenceLowpass: BiquadFilterNode;
  panner: PannerNode;
  gain: GainNode;
  assignedMosquitoId: string | null;
}

interface SwarmBedLayer {
  osc: OscillatorNode;
  filter: BiquadFilterNode;
  panner: PannerNode;
  gain: GainNode;
  baseFreq: number;
  baseX: number;
  baseY: number;
  phaseOffset: number;
}

function hashMosquitoId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function setPannerPosition3D(
  panner: PannerNode,
  x: number,
  y: number,
  z: number,
  now: number,
  smoothTau = 0.035,
): void {
  if (panner.positionX && panner.positionY && panner.positionZ) {
    panner.positionX.setTargetAtTime(x, now, smoothTau);
    panner.positionY.setTargetAtTime(y, now, smoothTau);
    panner.positionZ.setTargetAtTime(z, now, smoothTau);
  } else {
    panner.setPosition(x, y, z);
  }
}

/**
 * 100% Local Web Audio API Sound Manager.
 * Features:
 * - True 3D HRTF spatialized mosquito buzzing using Web Audio PannerNode & AudioListener:
 *   * Calculates each mosquito's 3D position (X, Y, Z) relative to the player's live FaceAnchor.
 *   * Up to 6 individual spatial mosquito voices with inverse-distance 3D PannerNode attenuation,
 *     unique wingbeat fundamentals (425–585 Hz), asymmetric nasal formant shaping, organic
 *     pitch flutter, 3D approach Doppler, and strong volume + frequency/pitch intensification
 *     as mosquitoes fly closer to the player's face and ears.
 *   * Count-scaled 3D ambient swarm chorus bed scaling organically with living mosquito count.
 * - 5 non-repeating kill SFX + 4 non-repeating miss SFX + overlap limiter.
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private biteGain: GainNode | null = null;
  private swarmSummingBus: GainNode | null = null;
  private buzzMasterGain: GainNode | null = null;
  private buzzCompressor: DynamicsCompressorNode | null = null;

  private voices: MosquitoVoiceNodes[] = [];
  private swarmBed: SwarmBedLayer[] = [];
  /** 10 dedicated 3D HRTF PannerNode voices so the default 10-mosquito swarm has 1:1 per-bug spatial audio */
  private readonly maxIndividualVoices = 10;
  private lastSwarmAudioUpdateMs = 0;

  private sfxVolume = 0.8;
  private buzzVolume = 0.35;
  private biteSoundVolume = 0.85;
  private muted = false;
  private enableMissVoice = false;

  private lastKillVariant = -1;
  private lastMissVariant = -1;
  private lastBiteVariant = -1;
  private lastSfxTimestamp = 0;
  private activeOneShots = 0;
  private readonly maxConcurrentOneShots = 5;
  private activeBiteOscillators: Set<OscillatorNode> = new Set();
  private biteSpeechActive = false;

  public unlock(): void {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      this.configureAudioListener();

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.ctx.destination);

      this.biteGain = this.ctx.createGain();
      this.biteGain.connect(this.ctx.destination);

      // Dedicated summing bus aggregating all individual mosquito PannerNodes + swarm density layers
      this.swarmSummingBus = this.ctx.createGain();
      this.swarmSummingBus.gain.value = 1.0;

      // Dynamics compressor preserves swarm density punch while preventing clipping with 20-50+ bugs
      this.buzzCompressor = this.ctx.createDynamicsCompressor();
      this.buzzCompressor.threshold.value = -12;
      this.buzzCompressor.knee.value = 18;
      this.buzzCompressor.ratio.value = 5.5;
      this.buzzCompressor.attack.value = 0.005;
      this.buzzCompressor.release.value = 0.14;

      this.buzzMasterGain = this.ctx.createGain();
      this.buzzMasterGain.gain.value = 0;

      this.swarmSummingBus.connect(this.buzzCompressor);
      this.buzzCompressor.connect(this.buzzMasterGain);
      this.buzzMasterGain.connect(this.ctx.destination);

      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /**
   * Anchors the Web Audio 3D listener at the origin (player's head/face),
   * facing forward along -Z toward the webcam/screen with +Y up.
   */
  private configureAudioListener(): void {
    if (!this.ctx) return;
    const listener = this.ctx.listener;
    const now = this.ctx.currentTime;

    if (listener.positionX && listener.positionY && listener.positionZ) {
      listener.positionX.setValueAtTime(0, now);
      listener.positionY.setValueAtTime(0, now);
      listener.positionZ.setValueAtTime(0, now);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(0, 0, 0);
    }

    if (
      listener.forwardX &&
      listener.forwardY &&
      listener.forwardZ &&
      listener.upX &&
      listener.upY &&
      listener.upZ
    ) {
      listener.forwardX.setValueAtTime(0, now);
      listener.forwardY.setValueAtTime(0, now);
      listener.forwardZ.setValueAtTime(-1, now);
      listener.upX.setValueAtTime(0, now);
      listener.upY.setValueAtTime(1, now);
      listener.upZ.setValueAtTime(0, now);
    } else if (typeof listener.setOrientation === 'function') {
      listener.setOrientation(0, 0, -1, 0, 1, 0);
    }
  }

  public configure(opts: {
    sfxVolume: number;
    buzzVolume: number;
    biteSoundVolume?: number;
    muted: boolean;
    enableMissVoice: boolean;
  }): void {
    this.sfxVolume = clamp(opts.sfxVolume, 0, 1);
    this.buzzVolume = clamp(opts.buzzVolume, 0, 1);
    if (typeof opts.biteSoundVolume === 'number') {
      this.biteSoundVolume = clamp(opts.biteSoundVolume, 0, 1);
    }
    this.muted = opts.muted;
    this.enableMissVoice = opts.enableMissVoice;
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxGain || !this.buzzMasterGain) return;
    const now = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.muted ? 0 : this.sfxVolume, now, 0.03);
    if (this.biteGain) {
      this.biteGain.gain.setTargetAtTime(this.muted ? 0 : this.biteSoundVolume, now, 0.03);
    }
    if (this.muted || this.buzzVolume <= 0.005) {
      this.buzzMasterGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  private createSpatialPanner(refDistance: number, rolloffFactor: number): PannerNode {
    const panner = this.ctx!.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = refDistance;
    panner.maxDistance = 8;
    panner.rolloffFactor = rolloffFactor;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
    panner.coneOuterGain = 1;
    return panner;
  }

  /**
   * Lazily constructs 10 individual 3D HRTF PannerNode voices + 4 density swarm chorus PannerNodes,
   * routing every PannerNode into the shared swarmSummingBus for unified swarm density aggregation.
   */
  private ensureSwarmAudioGraph(): void {
    if (!this.ctx || !this.swarmSummingBus || this.voices.length > 0) return;

    const now = this.ctx.currentTime;

    // 1. Ten independent 3D spatialized mosquito PannerNode voices
    for (let i = 0; i < this.maxIndividualVoices; i++) {
      const oscPrimary = this.ctx.createOscillator();
      const oscHarmonic = this.ctx.createOscillator();
      const oscSubJitter = this.ctx.createOscillator();

      oscPrimary.type = 'sawtooth';
      oscHarmonic.type = 'triangle';
      oscSubJitter.type = 'sawtooth';

      const base = 445 + i * 24;
      oscPrimary.frequency.value = base;
      oscHarmonic.frequency.value = base * 2.003;
      oscSubJitter.frequency.value = base * 2.996;

      const harmonicGain = this.ctx.createGain();
      harmonicGain.gain.value = 0.42;

      const subGain = this.ctx.createGain();
      subGain.gain.value = 0.2;

      // Strip low booming frequencies so the buzz retains thin, realistic insect airiness
      const highpass = this.ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 370;
      highpass.Q.value = 0.9;

      // Resonant nasal insect formant 1 (~1.15 kHz)
      const formantBody = this.ctx.createBiquadFilter();
      formantBody.type = 'peaking';
      formantBody.frequency.value = 1120 + i * 55;
      formantBody.Q.value = 2.6;
      formantBody.gain.value = 7.5;

      // Upper wing-whine formant 2 (~2.35 kHz — makes close face/ear buzz lifelike)
      const formantAir = this.ctx.createBiquadFilter();
      formantAir.type = 'peaking';
      formantAir.frequency.value = 2350 + i * 90;
      formantAir.Q.value = 2.4;
      formantAir.gain.value = 4.5;

      // Air-absorption lowpass (opens wide up to 4.8kHz as mosquito closes in on face/ears)
      const presenceLowpass = this.ctx.createBiquadFilter();
      presenceLowpass.type = 'lowpass';
      presenceLowpass.frequency.value = 1500;
      presenceLowpass.Q.value = 1.15;

      // True 3D HRTF PannerNode with inverse distance rolloff relative to the player's face
      const panner = this.createSpatialPanner(0.32, 1.7);
      setPannerPosition3D(panner, 0, 0, -1.5, now, 0.01);

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      oscPrimary.connect(highpass);
      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(highpass);
      oscSubJitter.connect(subGain);
      subGain.connect(highpass);

      highpass.connect(formantBody);
      formantBody.connect(formantAir);
      formantAir.connect(presenceLowpass);
      presenceLowpass.connect(panner);
      panner.connect(gain);
      gain.connect(this.swarmSummingBus);

      oscPrimary.start();
      oscHarmonic.start();
      oscSubJitter.start();

      this.voices.push({
        oscPrimary,
        oscHarmonic,
        oscSubJitter,
        harmonicGain,
        subGain,
        highpass,
        formantBody,
        formantAir,
        presenceLowpass,
        panner,
        gain,
        assignedMosquitoId: null,
      });
    }

    // 2. Count-based 3D ambient swarm chorus layers (fades in smoothly when > 3 mosquitoes are alive)
    const bedSpecs = [
      { freq: 432, x: -1.25, y: 0.25, phase: 0.4 },
      { freq: 498, x: -0.45, y: -0.2, phase: 2.1 },
      { freq: 546, x: 0.48, y: 0.28, phase: 4.3 },
      { freq: 604, x: 1.25, y: -0.18, phase: 5.7 },
    ];
    for (const spec of bedSpecs) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = spec.freq;

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = spec.freq * 2.35;
      filter.Q.value = 2.8;

      const panner = this.createSpatialPanner(0.65, 1.15);
      setPannerPosition3D(panner, spec.x, spec.y, -1.6, now, 0.01);

      const gain = this.ctx.createGain();
      gain.gain.value = 0;

      osc.connect(filter);
      filter.connect(panner);
      panner.connect(gain);
      gain.connect(this.swarmSummingBus);
      osc.start();

      this.swarmBed.push({
        osc,
        filter,
        panner,
        gain,
        baseFreq: spec.freq,
        baseX: spec.x,
        baseY: spec.y,
        phaseOffset: spec.phase,
      });
    }
  }

  /**
   * Drives each mosquito's dedicated 3D HRTF PannerNode from its Z-depth scaled
   * buzzVolume & buzzPitchHz (computed in MosquitoEngine) plus live 3D face/ear proximity,
   * and aggregates all panner outputs through swarmSummingBus to reflect overall swarm density.
   */
  public updateSwarmAudio(
    isPlaying: boolean,
    mosquitoes: MosquitoEntity[],
    faceAnchor: FaceAnchor,
    nowMs: number,
    swarmMetrics?: SwarmAcousticMetrics,
  ): void {
    if (!this.ctx || !this.buzzMasterGain || !this.swarmSummingBus) return;

    const living = mosquitoes.filter((m) => m.alive);
    if (!isPlaying || living.length === 0 || this.muted || this.buzzVolume <= 0.005) {
      this.buzzMasterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.07);
      return;
    }

    if (nowMs - this.lastSwarmAudioUpdateMs < 32) return;
    this.lastSwarmAudioUpdateMs = nowMs;

    this.ensureSwarmAudioGraph();
    const now = this.ctx.currentTime;
    const tSec = nowMs / 1000;

    // Master buzz slider gain
    this.buzzMasterGain.gain.setTargetAtTime(this.buzzVolume * 0.95, now, 0.06);

    // Derive swarm density aggregation metrics (uses MosquitoEngine metrics when supplied)
    const densityFactor =
      swarmMetrics?.densityFactor ?? clamp(Math.log2(living.length + 1) / 5.2, 0, 1);
    const totalAcousticEnergy =
      swarmMetrics?.totalAcousticEnergy ?? living.reduce((sum, m) => sum + (m.buzzVolume ?? 0.3), 0);

    // Aggregate summing bus reflects overall swarm density:
    // 1 mosquito stays crisp & focused (~0.88x); dense swarms swell naturally up to ~1.55x before compression
    const densityBusGain = clamp(
      0.85 + densityFactor * 0.52 + clamp(totalAcousticEnergy / 28, 0, 0.25),
      0.82,
      1.6,
    );
    this.swarmSummingBus.gain.setTargetAtTime(densityBusGain, now, 0.08);

    // Map face-relative horizontal ear offsets into 3D space (meters)
    const leftEarRelX = (faceAnchor.leftEar.x - faceAnchor.faceCenter.x) * 2.2;
    const leftEarRelY = -(faceAnchor.leftEar.y - faceAnchor.faceCenter.y) * 1.5;
    const rightEarRelX = (faceAnchor.rightEar.x - faceAnchor.faceCenter.x) * 2.2;
    const rightEarRelY = -(faceAnchor.rightEar.y - faceAnchor.faceCenter.y) * 1.5;

    // Project every living mosquito into 3D coordinates relative to the player's FaceAnchor
    const scored = living.map((m) => {
      const relX = (m.x - faceAnchor.faceCenter.x) * 2.2;
      const relY = -(m.y - faceAnchor.faceCenter.y) * 1.5;
      const depthMeters = clamp((m.z - 0.06) * 2.15, 0.08, 2.2);
      const relZ = -depthMeters;

      const dist3DFace = Math.hypot(relX, relY, depthMeters);
      const dist3DLeftEar = Math.hypot(relX - leftEarRelX, relY - leftEarRelY, depthMeters);
      const dist3DRightEar = Math.hypot(relX - rightEarRelX, relY - rightEarRelY, depthMeters);
      const closestHeadDist3D = Math.min(dist3DFace, dist3DLeftEar, dist3DRightEar);

      const faceScale3D = Math.max(0.42, faceAnchor.faceRadius * 3.4);
      const proximity3D = clamp(Math.exp(-((closestHeadDist3D / faceScale3D) ** 2) * 1.55), 0, 1);

      const toFaceX = faceAnchor.faceCenter.x - m.x;
      const toFaceY = faceAnchor.faceCenter.y - m.y;
      const dist2D = Math.max(0.001, Math.hypot(toFaceX, toFaceY));
      const radialApproach2D = (m.vx * toFaceX + m.vy * toFaceY) / dist2D;
      const radialApproach3D = radialApproach2D * 0.45 - m.vz * 1.1;

      const zCloseness = clamp((1.0 - m.z) / 0.92, 0, 1);
      const isLanded = m.animState === 'LANDED';
      const prominence = isLanded
        ? 0.08
        : proximity3D * 2.8 + m.buzzVolume * 1.6 + zCloseness;

      return {
        m,
        relX,
        relY,
        relZ,
        zCloseness,
        closestHeadDist3D,
        proximity3D,
        radialApproach3D,
        prominence,
      };
    });

    scored.sort((a, b) => b.prominence - a.prominence);
    const activeCount = Math.min(this.maxIndividualVoices, scored.length);

    // Gentle per-voice headroom normalization so 1 -> 10 individual PannerNodes sum cleanly
    // while still getting noticeably fuller as more mosquitoes buzz simultaneously
    const voiceAggregationScale = 1 / Math.pow(Math.max(1, activeCount), 0.42);

    for (let i = 0; i < this.voices.length; i++) {
      const voice = this.voices[i];
      if (i >= activeCount) {
        voice.assignedMosquitoId = null;
        voice.gain.gain.setTargetAtTime(0, now, 0.08);
        continue;
      }

      const item = scored[i];
      const { m, relX, relY, relZ, zCloseness, proximity3D, radialApproach3D, closestHeadDist3D } =
        item;
      const seed = hashMosquitoId(m.id);
      voice.assignedMosquitoId = m.id;

      // 1. Update true 3D HRTF PannerNode position relative to player's face anchor
      setPannerPosition3D(voice.panner, relX, relY, relZ, now, 0.032);

      // 2. Pitch driven directly by MosquitoEngine's Z-depth scaled buzzPitchHz
      //    plus organic erratic wing flutter, 3D radial Doppler, and close face/ear intensity boost
      const flutterRate = 1 + zCloseness * 0.4 + proximity3D * 0.55;
      const organicWander =
        Math.sin(tSec * (2.6 + seed * 1.8) * flutterRate + seed * 19) * (13 + proximity3D * 8) +
        Math.sin(tSec * (7.1 + seed * 3.0) * flutterRate + seed * 31) * (7 + proximity3D * 6) +
        Math.sin(tSec * 15.2 + seed * 11) * (3 + zCloseness * 2.5);

      const faceApproachDoppler = clamp(radialApproach3D * 45, -24, 38);
      const faceProximityPitchBoost = Math.pow(proximity3D, 1.15) * 95;

      const freq = clamp(
        m.buzzPitchHz + organicWander + faceApproachDoppler + faceProximityPitchBoost,
        365,
        960,
      );

      voice.oscPrimary.frequency.setTargetAtTime(freq, now, 0.04);
      voice.oscHarmonic.frequency.setTargetAtTime(freq * 2.005, now, 0.04);
      voice.oscSubJitter.frequency.setTargetAtTime(freq * 3.01, now, 0.04);

      // Closer Z-depth and closer face proximity both open upper-harmonic nasal presence
      const closenessIntensity = clamp(zCloseness * 0.48 + proximity3D * 0.65, 0, 1);
      voice.harmonicGain.gain.setTargetAtTime(0.36 + closenessIntensity * 0.36, now, 0.045);
      voice.subGain.gain.setTargetAtTime(0.14 + closenessIntensity * 0.26, now, 0.045);
      voice.formantBody.frequency.setTargetAtTime(1080 + closenessIntensity * 340, now, 0.05);
      voice.formantAir.gain.setTargetAtTime(2.8 + closenessIntensity * 8.6, now, 0.05);
      const cutoffHz =
        1050 +
        zCloseness * 1550 +
        proximity3D * 2450 +
        clamp(1 / Math.max(0.3, closestHeadDist3D), 0, 1.4) * 350;
      voice.presenceLowpass.frequency.setTargetAtTime(clamp(cutoffHz, 1050, 5400), now, 0.045);

      // 3. Individual PannerNode output volume directly scaled by Z-depth buzzVolume + face/ear surge
      //    Drops cleanly to near-silent when landed on the player's skin (just like a real mosquito!)
      const isLanded = m.animState === 'LANDED';
      const wingAmpFlutter = 0.87 + Math.sin(tSec * (12 + seed * 9) + seed * 13) * 0.13;
      const zScaledGain = 0.014 + m.buzzVolume * 0.058;
      const faceProximitySurge = isLanded ? 0 : Math.pow(proximity3D, 1.25) * 0.09;
      const landedAttenuation = isLanded ? 0.07 : 1.0;
      const targetGain =
        (zScaledGain + faceProximitySurge) *
        voiceAggregationScale *
        wingAmpFlutter *
        landedAttenuation;
      voice.gain.gain.setTargetAtTime(targetGain, now, 0.038);
    }

    // 4. Aggregated Swarm Density Chorus Bed (represents mosquitoes beyond individual focus & amplifies large-swarm texture)
    //    Starts weaving in lightly at 6+ mosquitoes and grows substantially at 12, 20, 40+ mosquitoes
    const overflowCount = Math.max(0, living.length - 5);
    const overflowRatio = overflowCount > 0 ? clamp(Math.log2(overflowCount + 1) / 4.2, 0, 1) : 0;
    const swarmChorusWeight = clamp(overflowRatio * 0.72 + densityFactor * 0.28 * (living.length >= 6 ? 1 : 0), 0, 1);
    const avgCloseness =
      swarmMetrics?.averageDepthCloseness ??
      scored.reduce((acc, s) => acc + s.zCloseness, 0) / Math.max(1, scored.length);

    for (let i = 0; i < this.swarmBed.length; i++) {
      const layer = this.swarmBed[i];
      const drift =
        Math.sin(tSec * (1.7 + i * 0.45) + layer.phaseOffset) * 22 +
        Math.cos(tSec * (4.3 + i * 0.6) + layer.phaseOffset) * 11;
      const freq = layer.baseFreq + drift + avgCloseness * 110;
      layer.osc.frequency.setTargetAtTime(freq, now, 0.09);
      layer.filter.frequency.setTargetAtTime(
        freq * (2.1 + swarmChorusWeight * 0.65 + avgCloseness * 0.55),
        now,
        0.1,
      );

      const bedX = layer.baseX + Math.sin(tSec * (0.8 + i * 0.25) + layer.phaseOffset) * 0.35;
      const bedY = layer.baseY + Math.cos(tSec * (0.65 + i * 0.2) + layer.phaseOffset) * 0.22;
      const bedZ = -(1.85 - avgCloseness * 0.95 - swarmChorusWeight * 0.28);
      setPannerPosition3D(layer.panner, bedX, bedY, bedZ, now, 0.12);

      const bedGain = swarmChorusWeight * (0.026 + avgCloseness * 0.044);
      layer.gain.gain.setTargetAtTime(bedGain, now, 0.12);
    }
  }

  public stopBuzzing(): void {
    if (!this.ctx || !this.buzzMasterGain) return;
    const now = this.ctx.currentTime;
    this.buzzMasterGain.gain.setTargetAtTime(0, now, 0.06);
    for (const v of this.voices) {
      v.gain.gain.setTargetAtTime(0, now, 0.06);
    }
    for (const b of this.swarmBed) {
      b.gain.gain.setTargetAtTime(0, now, 0.06);
    }
  }

  /**
   * Plays a randomly selected, non-repeating funny mosquito-kill sound effect.
   */
  public playKillSound(multiKillCount = 1): void {
    if (!this.canPlayOneShot()) return;
    const variant = this.pickNonRepeating(5, this.lastKillVariant);
    this.lastKillVariant = variant;

    switch (variant) {
      case 0:
        this.playSquishSound();
        break;
      case 1:
        this.playCartoonPopSound();
        break;
      case 2:
        this.playMosquitoScreamSound();
        break;
      case 3:
        this.playComedicSmackSound();
        break;
      default:
        this.playShortVictoryChime();
        break;
    }

    if (multiKillCount >= 2) {
      window.setTimeout(() => this.playBonusRewardSound(), 110);
    }
  }

  /**
   * Plays a randomly selected, non-repeating funny missed-attack sound effect.
   */
  public playMissSound(): void {
    if (!this.canPlayOneShot()) return;
    const variant = this.pickNonRepeating(4, this.lastMissVariant);
    this.lastMissVariant = variant;

    switch (variant) {
      case 0:
        this.playComedicWhoosh();
        break;
      case 1:
        this.playFunnyLaughSound();
        break;
      case 2:
        this.playSlideBoingMiss();
        if (this.enableMissVoice && !this.muted && 'speechSynthesis' in window) {
          this.speakMissedVoice();
        }
        break;
      default:
        this.playShortFailureWah();
        break;
    }
  }

  public playGameStart(): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [392, 523.25, 659.25, 783.99];
    notes.forEach((freq, i) => {
      this.scheduleTone(freq, 'triangle', now + i * 0.085, 0.16, 0.24);
    });
  }

  public playGameOver(): void {
    this.unlock();
    if (!this.ctx || !this.sfxGain || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [523.25, 493.88, 440, 349.23];
    notes.forEach((freq, i) => {
      this.scheduleTone(freq, 'sawtooth', now + i * 0.14, 0.24, 0.16);
    });
  }

  public playComboAchievement(): void {
    if (!this.canPlayOneShot(true)) return;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const chord = [523.25, 659.25, 783.99, 1046.5];
    chord.forEach((freq, i) => {
      this.scheduleTone(freq, 'triangle', now + i * 0.055, 0.22, 0.22);
    });
  }

  public playBonusRewardSound(): void {
    if (!this.canPlayOneShot(true)) return;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const sparkle = [659.25, 880, 1174.66, 1318.51];
    sparkle.forEach((freq, i) => {
      this.scheduleTone(freq, 'sine', now + i * 0.045, 0.14, 0.2);
    });
  }

  // --- Kill Sound Synthesizers ---

  private playSquishSound(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.scheduleFilteredNoise(now, 0.18, 950, 240, 0.36);

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.19);
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.22);
    this.trackOneShot(230);
  }

  private playCartoonPopSound(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(920, now + 0.055);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.13);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.16);
    this.trackOneShot(170);
  }

  private playMosquitoScreamSound(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const vibrato = this.ctx.createOscillator();
    const vibGain = this.ctx.createGain();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(1650, now);
    osc.frequency.exponentialRampToValueAtTime(1920, now + 0.06);
    osc.frequency.exponentialRampToValueAtTime(380, now + 0.32);

    vibrato.frequency.value = 34;
    vibGain.gain.value = 85;
    vibrato.connect(vibGain);
    vibGain.connect(osc.frequency);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 2.2;

    gain.gain.setValueAtTime(0.24, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);

    osc.start(now);
    vibrato.start(now);
    osc.stop(now + 0.35);
    vibrato.stop(now + 0.35);
    this.trackOneShot(360);
  }

  private playComedicSmackSound(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    this.scheduleFilteredNoise(now, 0.11, 2200, 480, 0.45);
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.12);
    gain.gain.setValueAtTime(0.26, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.14);
    this.trackOneShot(160);
  }

  private playShortVictoryChime(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.scheduleTone(587.33, 'triangle', now, 0.1, 0.25);
    this.scheduleTone(880, 'triangle', now + 0.06, 0.16, 0.28);
    this.trackOneShot(220);
  }

  // --- Miss Sound Synthesizers ---

  private playComedicWhoosh(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.scheduleFilteredNoise(now, 0.26, 360, 1450, 0.34);
    this.trackOneShot(270);
  }

  private playFunnyLaughSound(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const pitches = [980, 1180, 920, 1120];
    pitches.forEach((f, idx) => {
      this.scheduleTone(f, 'triangle', now + idx * 0.068, 0.055, 0.2);
    });
    this.trackOneShot(300);
  }

  private playSlideBoingMiss(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.12);
    osc.frequency.exponentialRampToValueAtTime(640, now + 0.24);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.29);
    this.trackOneShot(300);
  }

  private playShortFailureWah(): void {
    if (!this.ctx || !this.sfxGain) return;
    const now = this.ctx.currentTime;
    const freqs = [330, 293.66];
    freqs.forEach((f, i) => {
      const start = now + i * 0.14;
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(f, start);
      osc.frequency.exponentialRampToValueAtTime(f * 0.86, start + 0.13);

      const filter = this.ctx!.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 950;

      gain.gain.setValueAtTime(0.18, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.15);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain!);
      osc.start(start);
      osc.stop(start + 0.16);
    });
    this.trackOneShot(320);
  }

  private speakMissedVoice(): void {
    try {
      if (window.speechSynthesis.speaking) return;
      const utter = new SpeechSynthesisUtterance('Missed me!');
      utter.pitch = 1.9;
      utter.rate = 1.35;
      utter.volume = Math.min(1, this.sfxVolume * 0.75);
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore if speech synthesis unavailable
    }
  }

  /** Tiny comical soft tickle-boop when a mosquito lands on the player's body or face */
  public playLandingTickle(): void {
    this.unlock();
    if (!this.ctx || !this.biteGain || this.muted || this.biteSoundVolume <= 0.01) return;
    const now = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.065);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.14);

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    osc.connect(gain);
    gain.connect(this.biteGain);
    this.trackBiteOscillator(osc);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  /**
   * Plays ONE randomized, non-repeating bite sound effect when a new bite is confirmed:
   *  0) "Ouch!"
   *  1) "Hey! That tickles!"
   *  2) "Gotcha! I've bitten you!"
   *  3) "Another victim!"
   *  4) Funny synthesized mosquito laughter
   */
  public playBiteConfirmedSound(): void {
    this.unlock();
    if (!this.ctx || !this.biteGain || this.muted || this.biteSoundVolume <= 0.01) return;

    const variant = this.pickNonRepeating(5, this.lastBiteVariant);
    this.lastBiteVariant = variant;
    const now = this.ctx.currentTime;

    switch (variant) {
      case 0:
        // Crisp comic pinch sting + "Ouch!"
        this.scheduleBiteTone(860, 420, 'triangle', now, 0.15, 0.24);
        this.scheduleBiteTone(520, 290, 'sine', now + 0.07, 0.14, 0.16);
        this.speakBiteLine('Ouch!', 1.22, 1.18);
        break;
      case 1:
        // Playful tickle trill + "Hey! That tickles!"
        [680, 820, 960, 790].forEach((hz, idx) => {
          this.scheduleBiteTone(hz, hz * 1.08, 'sine', now + idx * 0.05, 0.06, 0.15);
        });
        this.speakBiteLine('Hey! That tickles!', 1.32, 1.2);
        break;
      case 2:
        // Mischievous mosquito sting + "Gotcha! I've bitten you!"
        this.scheduleBiteTone(640, 1140, 'sawtooth', now, 0.11, 0.13);
        this.scheduleBiteTone(920, 1280, 'triangle', now + 0.1, 0.12, 0.15);
        this.speakBiteLine("Gotcha! I've bitten you!", 1.82, 1.24);
        break;
      case 3:
        // Cheeky chirp + "Another victim!"
        this.scheduleBiteTone(540, 880, 'triangle', now, 0.1, 0.17);
        this.scheduleBiteTone(740, 1180, 'triangle', now + 0.09, 0.12, 0.17);
        this.speakBiteLine('Another victim!', 1.75, 1.22);
        break;
      default:
        // Pure comedic high-pitched mosquito giggle cascade ("hee-hee-hee-hee!")
        this.playMosquitoBiteLaughter(now);
        break;
    }
  }

  /**
   * Immediately halts any ongoing biting sound/utterance when the player slaps a biting mosquito.
   */
  public stopBitingSound(): void {
    for (const osc of this.activeBiteOscillators) {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    }
    this.activeBiteOscillators.clear();

    if (this.biteSpeechActive && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // Ignore speech cancellation errors
      }
      this.biteSpeechActive = false;
    }
  }

  /** Playful mini insect zip-giggle when a mosquito escapes after biting */
  public playBiteEscapeLaugh(): void {
    this.unlock();
    if (!this.ctx || !this.biteGain || this.muted || this.biteSoundVolume <= 0.01) return;
    const now = this.ctx.currentTime;
    this.playMosquitoBiteLaughter(now);
  }

  /** Celebratory crisp reward chime when slapping a mosquito mid-bite for the special bonus */
  public playBitingKillBonusSound(): void {
    if (!this.canPlayOneShot(true)) return;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const notes = [587.33, 783.99, 1046.5, 1318.51];
    notes.forEach((hz, idx) => {
      this.scheduleTone(hz, 'triangle', now + idx * 0.042, 0.15, 0.22);
    });
  }

  private playMosquitoBiteLaughter(now: number): void {
    const giggleNotes = [940, 1220, 990, 1310, 1040, 1420];
    giggleNotes.forEach((hz, idx) => {
      this.scheduleBiteTone(hz, hz * 1.12, 'triangle', now + idx * 0.058, 0.052, 0.17);
    });
  }

  private scheduleBiteTone(
    startFreq: number,
    endFreq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.biteGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), startTime + duration);

    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    osc.connect(gain);
    gain.connect(this.biteGain);
    this.trackBiteOscillator(osc);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private trackBiteOscillator(osc: OscillatorNode): void {
    this.activeBiteOscillators.add(osc);
    osc.onended = () => {
      this.activeBiteOscillators.delete(osc);
    };
  }

  private speakBiteLine(text: string, pitch: number, rate: number): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (this.muted || this.biteSoundVolume <= 0.02) return;
    try {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.pitch = pitch;
      utter.rate = rate;
      utter.volume = clamp(this.biteSoundVolume * 0.88, 0.05, 1.0);
      this.biteSpeechActive = true;
      utter.onend = () => {
        this.biteSpeechActive = false;
      };
      utter.onerror = () => {
        this.biteSpeechActive = false;
      };
      window.speechSynthesis.speak(utter);
    } catch {
      this.biteSpeechActive = false;
    }
  }

  // --- Shared Audio Primitives ---

  private scheduleTone(
    freq: number,
    type: OscillatorType,
    startTime: number,
    duration: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }

  private scheduleFilteredNoise(
    startTime: number,
    duration: number,
    startFreq: number,
    endFreq: number,
    peakGain: number,
  ): void {
    if (!this.ctx || !this.sfxGain) return;
    const sampleCount = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.8;
    filter.frequency.setValueAtTime(startFreq, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, endFreq), startTime + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(startTime);
  }

  private canPlayOneShot(bypassRateLimit = false): boolean {
    this.unlock();
    if (!this.ctx || !this.sfxGain || this.muted || this.sfxVolume <= 0.01) return false;
    const now = performance.now();
    if (!bypassRateLimit && now - this.lastSfxTimestamp < 70) return false;
    if (this.activeOneShots >= this.maxConcurrentOneShots) return false;
    this.lastSfxTimestamp = now;
    return true;
  }

  private trackOneShot(durationMs: number): void {
    this.activeOneShots++;
    window.setTimeout(() => {
      this.activeOneShots = Math.max(0, this.activeOneShots - 1);
    }, durationMs);
  }

  private pickNonRepeating(count: number, lastIndex: number): number {
    if (count <= 1) return 0;
    let next = Math.floor(Math.random() * count);
    if (next === lastIndex) {
      next = (next + 1 + Math.floor(Math.random() * (count - 1))) % count;
    }
    return next;
  }

  public dispose(): void {
    this.stopBuzzing();
    try {
      for (const v of this.voices) {
        v.oscPrimary.stop();
        v.oscHarmonic.stop();
        v.oscSubJitter.stop();
      }
      for (const b of this.swarmBed) {
        b.osc.stop();
      }
      this.ctx?.close();
    } catch {
      // Ignore teardown errors
    }
    this.ctx = null;
    this.voices = [];
    this.swarmBed = [];
  }
}
