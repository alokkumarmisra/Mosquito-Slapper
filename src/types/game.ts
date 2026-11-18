export enum GamePhase {
  CALIBRATION = 'CALIBRATION',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
}

export enum DifficultyLevel {
  EASY = 'EASY',
  NORMAL = 'NORMAL',
  HARD = 'HARD',
  EXTREME = 'EXTREME',
}

export enum GestureState {
  IDLE = 'IDLE',
  HAND_DETECTED = 'HAND_DETECTED',
  ATTACK_PREPARATION = 'ATTACK_PREPARATION',
  ATTACK_IN_PROGRESS = 'ATTACK_IN_PROGRESS',
  ATTACK_CONFIRMED = 'ATTACK_CONFIRMED',
  ATTACK_COOLDOWN = 'ATTACK_COOLDOWN',
}

export type HandPose = 'OPEN_PALM' | 'CLOSED_FIST' | 'NEUTRAL';
export type HandSide = 'Left' | 'Right';

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export type FaceLandingZone = 'HEAD' | 'FOREHEAD' | 'NOSE' | 'LEFT_CHEEK' | 'RIGHT_CHEEK';

export type BodyRegionCategory = 'FACE' | 'NECK' | 'ARM' | 'HAND' | 'LEG';

export type BodyRegionId =
  | 'HEAD'
  | 'FOREHEAD'
  | 'LEFT_CHEEK'
  | 'RIGHT_CHEEK'
  | 'NOSE'
  | 'CHIN'
  | 'NECK'
  | 'LEFT_SHOULDER'
  | 'RIGHT_SHOULDER'
  | 'LEFT_UPPER_ARM'
  | 'RIGHT_UPPER_ARM'
  | 'LEFT_ELBOW'
  | 'RIGHT_ELBOW'
  | 'LEFT_FOREARM'
  | 'RIGHT_FOREARM'
  | 'LEFT_HAND'
  | 'RIGHT_HAND'
  | 'LEFT_THIGH'
  | 'RIGHT_THIGH'
  | 'LEFT_KNEE'
  | 'RIGHT_KNEE'
  | 'LEFT_SHIN'
  | 'RIGHT_SHIN';

export interface FaceZoneAnchor {
  zone: FaceLandingZone;
  label: string;
  point: Point2D;
  radius: number;
}

export interface FaceAnchor {
  faceCenter: Point2D;
  faceRadius: number;
  headRollRad: number;
  leftEar: Point2D;
  rightEar: Point2D;
  earRadius: number;
  /** Recognized chin landmark in canvas-normalized coordinates (0..1) */
  chin?: Point2D;
  /** Recognized anatomical landing zones in canvas-normalized coordinates (0..1) */
  zones: Record<FaceLandingZone, FaceZoneAnchor>;
  /** Compact head/face contour points for subtle AR face-zone recognition overlay */
  headOutline?: Point2D[];
  trackerKind?: 'FACE_LANDMARKER' | 'BLAZEFACE' | 'FALLBACK';
  detected: boolean;
  lastSeen: number;
}

export interface BodyLandmarkReference {
  source: 'FACE' | 'POSE' | 'HAND';
  region: BodyRegionId;
  primaryIndex: number;
  secondaryIndex?: number;
  segmentT?: number;
  /** Offset in anchor-local rotated frame (normalized coords) so bites follow head/limb tilt */
  localOffset: Point2D;
  /** Anchor scale at time of bite so swelling rescales smoothly with player distance */
  referenceScale: number;
}

export interface BodyRegionAnchor {
  region: BodyRegionId;
  category: BodyRegionCategory;
  label: string;
  point: Point2D;
  axisAngleRad: number;
  scale: number;
  visibility: number;
  source: 'FACE' | 'POSE' | 'HAND';
  primaryLandmarkIndex: number;
  secondaryLandmarkIndex?: number;
  segmentStart?: Point2D;
  segmentEnd?: Point2D;
}

export interface PoseLandmarkPoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface BodyTrackingFrame {
  regions: Partial<Record<BodyRegionId, BodyRegionAnchor>>;
  visibleRegions: BodyRegionId[];
  poseLandmarks: PoseLandmarkPoint[];
  poseDetected: boolean;
  segmentationActive: boolean;
  bodyScale: number;
  lastSeen: number;
}

export type BiteVisualStyle =
  | 'SMALL_RED_CIRCLE'
  | 'RAISED_BUMP'
  | 'SWOLLEN_PATCH'
  | 'PULSATING_MARK'
  | 'ITCHING_MARK';

export type BiteAnimationState = 'APPEARING' | 'ACTIVE' | 'HEALING' | 'HEALED';

export type HealingStatus = 'FRESH' | 'INFLAMED' | 'FADING' | 'HEALED';

export interface BiteRecord {
  id: string;
  mosquitoId: string;
  region: BodyRegionId;
  regionLabel: string;
  category: BodyRegionCategory;
  landmarkRef: BodyLandmarkReference;
  /** Live normalized webcam/canvas coordinates (0..1) */
  normalizedX: number;
  normalizedY: number;
  timestamp: number;
  createdAtPerfMs: number;
  swellingSize: number;
  swellingIntensity: number;
  visualStyle: BiteVisualStyle;
  animationState: BiteAnimationState;
  healingStatus: HealingStatus;
  opacity: number;
  depthScale: number;
  visibilityDurationMs: number;
  attachedVisible: boolean;
  killedDuringBite: boolean;
}

export interface BiteStatistics {
  totalBites: number;
  activeBiteMarks: number;
  faceBites: number;
  armBites: number;
  neckBites: number;
  handBites: number;
  legBites: number;
  bitesPerMosquito: Record<string, number>;
  bitesByRegion: Partial<Record<BodyRegionId, number>>;
  mostBittenRegion: BodyRegionId | null;
  mostBittenRegionLabel: string;
  mostBittenRegionCount: number;
  bitingKills: number;
}

export interface BiteNotification {
  id: string;
  message: string;
  regionLabel: string;
  category: BodyRegionCategory;
  createdAt: number;
  kind: 'BITE' | 'BITING_KILL' | 'ESCAPE';
}

export interface BiteSimulationSettings {
  enabled: boolean;
  enableFaceBites: boolean;
  enableArmBites: boolean;
  enableNeckBites: boolean;
  enableHandBites: boolean;
  enableLegBites: boolean;
  /** 0.05 .. 1.0 probability weight for mosquitoes choosing to land & bite */
  landingProbability: number;
  /** Minimum biting duration in seconds (default 2s) */
  minBitingDurationSec: number;
  /** Maximum biting duration in seconds (default 4s) */
  maxBitingDurationSec: number;
  /** Relative visual size multiplier for bite swelling marks (0.5 .. 2.0) */
  biteMarkSize: number;
  /** How long each bite swelling remains visible before healing (seconds) */
  biteVisibilityDurationSec: number;
  /** Dedicated volume for bite reactions & escape laughs (0 .. 1) */
  biteSoundVolume: number;
  /** Special bonus points awarded for slapping a mosquito while it is biting */
  bitingKillBonus: number;
}

export interface FaceLandingEvent {
  type: 'LANDED' | 'BITE_CONFIRMED' | 'ESCAPED_AFTER_BITE' | 'TOOK_OFF';
  mosquitoId: string;
  zone?: FaceLandingZone;
  region: BodyRegionId;
  category: BodyRegionCategory;
  zoneLabel: string;
  point: Point2D;
  landmarkRef?: BodyLandmarkReference;
  depthScale?: number;
}

export interface TrackedHand {
  id: string;
  side: HandSide;
  /** Mirrored normalized coordinates (0..1) matching screen overlay */
  palm: Point2D;
  /** Palm radius in normalized width units */
  palmRadius: number;
  /** Normalized landmarks (21 points for MediaPipe, synthesized contour for local fallback) */
  landmarks: Point3D[];
  pose: HandPose;
  /** Normalized units per second */
  vx: number;
  vy: number;
  speed: number;
  /** Direction in radians */
  direction: number;
  /** Recent trail of palm points for swept slap trajectory */
  history: Array<{ x: number; y: number; time: number }>;
  confidence: number;
  lastSeen: number;
}

export type AttackKind = 'CLAP' | 'SLAP';

export interface AttackEvent {
  id: string;
  kind: AttackKind;
  timestamp: number;
  /** Primary attack origin in normalized screen coords (0..1) */
  position: Point2D;
  /** Normalized direction vector */
  direction: Point2D;
  /** Attack radius in normalized width units */
  radius: number;
  /** For single-hand slap: swept path segments in normalized coords */
  trajectory: Point2D[];
  /** For clap: palm separation right before impact */
  palmDistance?: number;
  handSide?: HandSide | 'Both';
  /** When the player directly smacks a recognized facial zone (head, forehead, nose, cheek) */
  faceZone?: FaceLandingZone;
  /** When the player directly smacks a recognized body region (face, neck, arm, hand, leg) */
  bodyRegion?: BodyRegionId;
}

export type FlightPattern =
  | 'WANDERING'
  | 'ZIGZAG'
  | 'CIRCULAR'
  | 'HOVERING'
  | 'SUDDEN_ESCAPE'
  | 'APPROACH_CAMERA'
  | 'RETREAT_CAMERA'
  | 'APPROACH_FACE_ZONE'
  | 'LANDED_ON_FACE';

export type MosquitoAnimState =
  | 'FLYING'
  | 'HOVERING'
  | 'DARTING'
  | 'APPROACHING_LANDING'
  | 'LANDED'
  | 'DYING'
  | 'DEAD';

export interface MosquitoEntity {
  id: string;
  /** Normalized X (0..1) */
  x: number;
  /** Normalized Y (0..1) */
  y: number;
  /** Simulated depth Z (0.08 = close foreground near webcam, 1.0 = far rear) */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  direction: number;
  speed: number;
  rotation: number;
  baseSize: number;
  health: number;
  alive: boolean;
  pattern: FlightPattern;
  patternTimer: number;
  patternPhase: number;
  hoverAnchor?: Point2D;
  circleCenter?: Point2D;
  circleRadius?: number;
  circleDir?: number;
  wingPhase: number;
  animState: MosquitoAnimState;
  deathTimer: number;
  deathSpin: number;
  /** Computed each frame from Z perspective and difficulty hitbox scale */
  screenX: number;
  screenY: number;
  depthScale: number;
  hitboxRadiusPx: number;
  /** Per-mosquito acoustic properties dynamically scaled by Z-depth */
  baseBuzzPitchHz: number;
  buzzVolume: number; // 0..1 (closer Z = louder)
  buzzPitchHz: number; // Hz (closer Z = higher pitch)
  /** Recent screen positions for velocity motion blur */
  trail: Point2D[];
  /** Optional funny taunt bubble */
  tauntText?: string;
  tauntExpiresAt?: number;
  /** Periodic random face/body landing & biting state */
  landingZone?: FaceLandingZone;
  landingBodyRegion?: BodyRegionId;
  landingBodyCategory?: BodyRegionCategory;
  landingBodyLabel?: string;
  landingLandmarkRef?: BodyLandmarkReference;
  landingOffset?: Point2D;
  landingTimer?: number;
  landingDuration?: number;
  landingProgress?: number;
  bitePulsePhase?: number;
  landedAngleOffset?: number;
  biteTriggerTimeSec?: number;
  biteConfirmed?: boolean;
  biteConfirmedAt?: number;
  activeBiteId?: string;
}

export interface SwarmAcousticMetrics {
  livingCount: number;
  densityFactor: number; // 0..1 normalized swarm density
  totalAcousticEnergy: number; // aggregate sum of individual buzzVolume values
  averageDepthCloseness: number; // 0..1 mean Z closeness across living swarm
  peakDepthCloseness: number; // 0..1 closest living mosquito Z closeness
}

export interface VisualEffect {
  id: string;
  kind: 'KILL_SPLAT' | 'CLAP_RING' | 'SLAP_SWEEP' | 'FACE_ZONE_RIPPLE' | 'FLOAT_TEXT' | 'MISS_TEXT';
  x: number;
  y: number;
  createdAt: number;
  durationMs: number;
  text?: string;
  subtext?: string;
  color: string;
  radius?: number;
  trajectory?: Point2D[];
  comicWord?: string;
  scale?: number;
  faceZone?: FaceLandingZone;
  bodyRegion?: BodyRegionId;
}

export interface HitResolution {
  attack: AttackEvent;
  killedMosquitoes: MosquitoEntity[];
  pointsAwarded: number;
  multiKillBonus: number;
  comboBonus: number;
  isMiss: boolean;
}

export interface RewardConfig {
  normalKill: number;
  doubleKillBonus: number;
  tripleKillBonus: number;
  fiveComboBonus: number;
  tenComboBonus: number;
}

export interface LlmConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
  apiKey: string;
}

export type CameraResolutionPreset = '1080p' | '720p' | '480p';
export type CameraFacingMode = 'user' | 'environment';
export type DeviceRole = 'STANDALONE' | 'TV_DISPLAY' | 'PHONE_CAMERA';
export type VideoTransportMode = 'NONE' | 'WEBRTC' | 'WS_RELAY';
export type CompanionConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'WAITING_FOR_PEER'
  | 'CONNECTED';

export type RemoteCommand =
  | { action: 'START' }
  | { action: 'PAUSE_TOGGLE' }
  | { action: 'RESTART' }
  | { action: 'RESET' }
  | { action: 'END_GAME' }
  | { action: 'ADD_MOSQUITOES'; count: number }
  | { action: 'REMOVE_MOSQUITOES'; count: number }
  | { action: 'SET_DIFFICULTY'; level: DifficultyLevel }
  | { action: 'TOGGLE_MUTE' }
  | { action: 'TOGGLE_POINTER' };

export interface RemoteVisionFramePayload {
  hands: TrackedHand[];
  faceAnchor: FaceAnchor;
  gestureState: GestureState;
  clapReadiness: number;
  mirrorCamera: boolean;
  cameraFacing: CameraFacingMode;
  sentAt: number;
}

export interface TvHudSyncPayload {
  phase: GamePhase;
  score: number;
  mosquitoesKilled: number;
  mosquitoesRemaining: number;
  totalMosquitoesSpawned: number;
  currentCombo: number;
  highestCombo: number;
  accuracy: number;
  elapsedSeconds: number;
  difficulty: DifficultyLevel;
  muted: boolean;
  showHandPointer: boolean;
}

export type BackendConnectionStatus = 'BUILTIN' | 'CONNECTED' | 'ERROR' | 'TESTING';

export interface BackendApiConfig {
  /** Route configured features to custom baseUrl instead of built-in server */
  enabled: boolean;
  /** Custom backend HTTP(S) base URL (e.g. https://api.example.com) */
  baseUrl: string;
  /** Optional custom WebSocket URL for TV/Phone pairing (auto-derived from baseUrl when blank) */
  wsUrl: string;
  /** Endpoint paths relative to baseUrl */
  healthPath: string;
  configPath: string;
  scoresPath: string;
  /** Feature routing flags */
  syncConfig: boolean;
  syncScores: boolean;
  routeLlmProxy: boolean;
  routeTvRelay: boolean;
  /** Forward HTTP calls through built-in Express /api/backend/proxy to bypass browser CORS */
  useServerProxy: boolean;
}

export type DownloadPlatform = 'android' | 'apple' | 'windows';

export interface DownloadLinksConfig {
  /** Optional custom Android APK or Google Play URL */
  androidUrl: string;
  /** Optional custom Apple App Store, TestFlight, or macOS DMG URL */
  appleUrl: string;
  /** Optional custom Windows EXE, MSIX, or Microsoft Store URL */
  windowsUrl: string;
}

export interface GameSettings {
  cameraDeviceId: string;
  cameraFacing: CameraFacingMode;
  resolution: CameraResolutionPreset;
  mirrorCamera: boolean;
  showLandmarks: boolean;
  showHandPointer: boolean;
  showFaceZones: boolean;
  enableFaceLanding: boolean;
  showHitboxes: boolean;
  practiceMode: boolean;

  /** Vision & Gesture Sensitivities */
  handTrackingSensitivity: number; // 0.25 .. 0.90 min confidence (mapped intuitively)
  clapProximityThreshold: number; // 0.06 .. 0.24 normalized screen distance
  clapClosingSpeedThreshold: number; // 0.35 .. 1.8 normalized units/s
  slapVelocityThreshold: number; // 0.8 .. 3.2 normalized units/s
  hitDetectionRadius: number; // 35 .. 130 px at 1080p baseline
  attackCooldownMs: number; // 180 .. 850 ms

  /** Mosquito & Difficulty */
  initialMosquitoCount: number;
  mosquitoSpeedMultiplier: number; // 0.5 .. 2.0
  difficulty: DifficultyLevel;
  autoDifficulty: boolean;

  /** Rewards */
  rewards: RewardConfig;

  /** Audio */
  sfxVolume: number; // 0 .. 1
  buzzVolume: number; // 0 .. 1
  muted: boolean;
  enableMissVoice: boolean;

  /** Local LM Studio LLM */
  llm: LlmConfig;

  /** Custom Backend API Configuration */
  backend: BackendApiConfig;

  /** Custom Platform Download Links (Android / Apple / Windows) */
  downloads: DownloadLinksConfig;

  /** Body Bite Simulation Settings */
  bites: BiteSimulationSettings;
}

export interface GameStats {
  totalMosquitoesSpawned: number;
  mosquitoesKilled: number;
  mosquitoesRemaining: number;
  missedAttacks: number;
  totalAttacks: number;
  successfulAttacks: number;
  score: number;
  accuracy: number;
  currentCombo: number;
  highestCombo: number;
  doubleKills: number;
  tripleKills: number;
  elapsedSeconds: number;
}

export interface AchievementBadge {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  aiMessage?: string;
}

export interface ActiveChallenge {
  id: string;
  title: string;
  description: string;
  targetType: 'KILLS' | 'COMBO' | 'DOUBLE_KILL' | 'ACCURACY_STREAK';
  targetValue: number;
  progress: number;
  completed: boolean;
  bonusPoints: number;
}

export interface CameraDeviceOption {
  deviceId: string;
  label: string;
}

export type VisionEngineMode = 'INITIALIZING' | 'MEDIAPIPE_GPU' | 'MEDIAPIPE_CPU' | 'LOCAL_OPTICAL' | 'PRACTICE_MOUSE';

export interface DifficultyProfile {
  label: string;
  summary: string;
  speedScale: number;
  hitboxScale: number;
  turnFrequency: number;
  escapeChance: number;
  approachAggression: number;
}

export interface PlayerLifetimeStats {
  gamesPlayed: number;
  bestScore: number;
  totalKills: number;
  totalScore: number;
  highestCombo: number;
  bestAccuracy: number;
  swarmsCleared: number;
}

export interface LeaderboardEntry {
  id: string;
  playerName: string;
  username?: string;
  userId?: string;
  isGuest: boolean;
  score: number;
  mosquitoesKilled: number;
  totalMosquitoesSpawned?: number;
  missedAttacks?: number;
  accuracy: number;
  highestCombo: number;
  difficulty: DifficultyLevel;
  swarmCleared: boolean;
  elapsedSeconds: number;
  savedAt: string;
}

export interface PlayerAccount {
  id: string;
  username: string;
  displayName: string;
  photoURL?: string;
  email?: string | null;
  createdAt: string;
  stats: PlayerLifetimeStats;
  unlockedAchievements: string[];
}

export interface GuestProfile {
  guestId: string;
  displayName: string;
  stats: PlayerLifetimeStats;
  unlockedAchievements: string[];
  recentMatches: LeaderboardEntry[];
}

export interface GuestProgressImport {
  stats?: Partial<PlayerLifetimeStats>;
  unlockedAchievements?: string[];
  settings?: Partial<GameSettings>;
}

export type AccountModalTab = 'profile' | 'leaderboard';

