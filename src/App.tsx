/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PointerEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { User as FirebaseUser } from 'firebase/auth';
import { Analytics } from '@vercel/analytics/react';
import { LocalLlmService, LlmConnectionStatus } from './ai/LocalLlmService';
import { SoundManager } from './audio/SoundManager';
import {
  clearGuestStats,
  ensureFirestoreUserProfile,
  importGuestProgressToCloud,
  loadFirestoreUserPreferences,
  loadGuestProfile,
  recordGuestMatch,
  recordSignedInMatchToFirestore,
  saveFirestoreUserPreferences,
  signInWithGoogleAccount,
  signOutGoogleAccount,
  subscribeFirebaseAuth,
  subscribeFirestoreUserProfile,
  updateFirestoreDisplayName,
  updateGuestDisplayName,
} from './auth/PlayerSessionService';
import { AccountModal } from './components/AccountModal';
import { CalibrationOverlay } from './components/CalibrationOverlay';
import { ControlDock } from './components/ControlDock';
import { DownloadAppsModal } from './components/DownloadAppsModal';
import { GameHud } from './components/GameHud';
import { GameOverModal } from './components/GameOverModal';
import { PhoneControllerView } from './components/PhoneControllerView';
import { OfflineNotice } from './components/PWAInstallButton';
import { SettingsDrawer } from './components/SettingsDrawer';
import { TvCastModal } from './components/TvCastModal';
import {
  DEFAULT_SETTINGS,
  DIFFICULTY_PROFILES,
  loadLocalSettings,
  loadServerConfig,
  mergeSettings,
  saveLocalSettings,
} from './config/defaults';
import { ArenaRenderer } from './game/ArenaRenderer';
import { CollisionEngine } from './game/CollisionEngine';
import { computeAutoDifficulty, MosquitoEngine } from './game/MosquitoEngine';
import { useWakeLock } from './hooks/usePWAInstall';
import {
  isCustomBackendActive,
  submitMatchScore,
  testBackendConnection,
} from './network/BackendApiClient';
import { CompanionLink } from './network/CompanionLink';
import {
  AccountModalTab,
  AchievementBadge,
  ActiveChallenge,
  AttackEvent,
  BackendConnectionStatus,
  CameraDeviceOption,
  CompanionConnectionState,
  DeviceRole,
  DifficultyLevel,
  DownloadPlatform,
  FaceLandingZone,
  GamePhase,
  GameSettings,
  GameStats,
  GestureState,
  GuestProfile,
  PlayerAccount,
  Point2D,
  RemoteCommand,
  RemoteVisionFramePayload,
  TrackedHand,
  TvHudSyncPayload,
  VideoTransportMode,
  VisionEngineMode,
  VisualEffect,
} from './types/game';
import { createDefaultFaceAnchor, FACE_ZONE_LABELS, FaceTracker } from './vision/FaceTracker';
import { GestureStateMachine } from './vision/GestureStateMachine';
import { HandTracker } from './vision/HandTracker';
import { WebcamManager } from './vision/WebcamManager';

const PRACTICE_BACKDROP_IMAGE = '/src/assets/images/practice_room_backdrop_1794931290029.jpg';
const COMIC_HIT_WORDS = ['SMACK!', 'POW!', 'SQUISH!', 'ZAP!', 'SPLAP!', 'BONK!'];

function createInitialStats(initialCount: number): GameStats {
  return {
    totalMosquitoesSpawned: initialCount,
    mosquitoesKilled: 0,
    mosquitoesRemaining: initialCount,
    missedAttacks: 0,
    totalAttacks: 0,
    successfulAttacks: 0,
    score: 0,
    accuracy: 100,
    currentCombo: 0,
    highestCombo: 0,
    doubleKills: 0,
    tripleKills: 0,
    elapsedSeconds: 0,
  };
}

function buildAchievements(stats: GameStats): AchievementBadge[] {
  return [
    {
      id: 'first-blood',
      title: 'First Blood',
      description: 'Swat your very first mosquito out of the air.',
      unlocked: stats.mosquitoesKilled >= 1,
    },
    {
      id: 'mosquito-hunter',
      title: 'Mosquito Hunter',
      description: 'Eliminate 10 or more mosquitoes in one session.',
      unlocked: stats.mosquitoesKilled >= 10,
    },
    {
      id: 'double-killer',
      title: 'Double Killer',
      description: 'Hit 2 mosquitoes simultaneously in one clap or slap.',
      unlocked: stats.doubleKills >= 1,
    },
    {
      id: 'triple-threat',
      title: 'Triple Threat',
      description: 'Eliminate 3 or more mosquitoes in a single strike.',
      unlocked: stats.tripleKills >= 1,
    },
    {
      id: 'perfect-slapper',
      title: 'Perfect Slapper',
      description: 'Finish with 80%+ accuracy and at least 5 kills.',
      unlocked: stats.mosquitoesKilled >= 5 && stats.accuracy >= 80,
    },
    {
      id: 'mosquito-destroyer',
      title: 'Mosquito Destroyer',
      description: 'Reach 25 total kills or an unstoppable 10x combo.',
      unlocked: stats.mosquitoesKilled >= 25 || stats.highestCombo >= 10,
    },
  ];
}

export default function App() {
  const [settings, setSettings] = useState<GameSettings>(() => loadLocalSettings());
  const [phase, setPhase] = useState<GamePhase>(GamePhase.CALIBRATION);
  const [effectiveDifficulty, setEffectiveDifficulty] = useState<DifficultyLevel>(settings.difficulty);
  const [stats, setStats] = useState<GameStats>(() =>
    createInitialStats(settings.initialMosquitoCount),
  );
  const [gestureState, setGestureState] = useState<GestureState>(GestureState.IDLE);
  const [trackedHandsUi, setTrackedHandsUi] = useState<TrackedHand[]>([]);
  const [calibrationProgress, setCalibrationProgress] = useState(0);

  const [cameras, setCameras] = useState<CameraDeviceOption[]>([]);
  const [webcamActive, setWebcamActive] = useState(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [cameraResLabel, setCameraResLabel] = useState('1920 × 1080');
  const [visionMode, setVisionMode] = useState<VisionEngineMode>('INITIALIZING');

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tvModalOpen, setTvModalOpen] = useState(false);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [downloadPlatformFocus, setDownloadPlatformFocus] = useState<DownloadPlatform | null>(null);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [accountModalTab, setAccountModalTab] = useState<AccountModalTab>('profile');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Instant Guest Mode + Optional Firebase Google Auth (zero blocking on load)
  const [guestProfile, setGuestProfile] = useState<GuestProfile>(() => loadGuestProfile());
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [account, setAccount] = useState<PlayerAccount | null>(null);

  // Mobile Phone-Camera <-> TV Display Companion state
  const [deviceRole, setDeviceRole] = useState<DeviceRole>('STANDALONE');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [companionState, setCompanionState] = useState<CompanionConnectionState>('DISCONNECTED');
  const [transportMode, setTransportMode] = useState<VideoTransportMode>('NONE');
  const [companionError, setCompanionError] = useState<string | null>(null);
  const [tvHudSync, setTvHudSync] = useState<TvHudSyncPayload | null>(null);

  const [llmStatus, setLlmStatus] = useState<LlmConnectionStatus>('UNKNOWN');
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmStatusMsg, setLlmStatusMsg] = useState('Checking local LM Studio...');
  const [backendStatus, setBackendStatus] = useState<BackendConnectionStatus>(() =>
    isCustomBackendActive(settings.backend) ? 'CONNECTED' : 'BUILTIN',
  );
  const [backendStatusMsg, setBackendStatusMsg] = useState(() =>
    isCustomBackendActive(settings.backend)
      ? `Custom API: ${settings.backend.baseUrl}`
      : 'Using built-in local Express server.',
  );
  const [scoreSyncStatus, setScoreSyncStatus] = useState<string | null>(null);
  const [difficultyDesc, setDifficultyDesc] = useState(
    DIFFICULTY_PROFILES[settings.difficulty].summary,
  );
  const [commentary, setCommentary] = useState(
    'Clap both hands or whip a quick single-hand slap to swat mosquitoes.',
  );
  const [swarmTacticName, setSwarmTacticName] = useState<string | null>(null);
  const [activeChallenge, setActiveChallenge] = useState<ActiveChallenge | null>(null);
  const [aiDebrief, setAiDebrief] = useState('');
  const [swarmCleared, setSwarmCleared] = useState(false);

  // Keep mobile/TV screens awake while actively playing or paired
  useWakeLock(
    phase === GamePhase.PLAYING ||
      deviceRole === 'PHONE_CAMERA' ||
      deviceRole === 'TV_DISPLAY',
  );

  // Refs for zero-overhead 60fps game & CV loop
  const arenaRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phonePreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backdropImgRef = useRef<HTMLImageElement | null>(null);

  const webcamMgrRef = useRef<WebcamManager | null>(null);
  const handTrackerRef = useRef<HandTracker | null>(null);
  const faceTrackerRef = useRef<FaceTracker | null>(null);
  const gestureFsmRef = useRef<GestureStateMachine>(new GestureStateMachine());
  const mosquitoEngineRef = useRef<MosquitoEngine>(new MosquitoEngine());
  const collisionEngineRef = useRef<CollisionEngine>(new CollisionEngine());
  const rendererRef = useRef<ArenaRenderer>(new ArenaRenderer());
  const soundMgrRef = useRef<SoundManager>(new SoundManager());
  const llmRef = useRef<LocalLlmService>(new LocalLlmService(settings.llm, settings.backend));
  const companionRef = useRef<CompanionLink>(new CompanionLink());

  const settingsRef = useRef<GameSettings>(settings);
  const phaseRef = useRef<GamePhase>(phase);
  const statsRef = useRef<GameStats>(stats);
  const effDiffRef = useRef<DifficultyLevel>(effectiveDifficulty);
  const activeChallengeRef = useRef<ActiveChallenge | null>(activeChallenge);
  const deviceRoleRef = useRef<DeviceRole>(deviceRole);
  const firebaseUserRef = useRef<FirebaseUser | null>(firebaseUser);
  const accountRef = useRef<PlayerAccount | null>(account);
  const guestProfileRef = useRef<GuestProfile>(guestProfile);
  const accountModalOpenRef = useRef<boolean>(accountModalOpen);
  const sessionHydratedRef = useRef<boolean>(false);
  const prefsHydratedRef = useRef<boolean>(false);
  const signInInProgressRef = useRef<boolean>(false);

  const effectsRef = useRef<VisualEffect[]>([]);
  const phoneFxRef = useRef<VisualEffect[]>([]);
  const effectSeqRef = useRef(0);
  const latestHandsRef = useRef<TrackedHand[]>([]);
  const calibrationRef = useRef(0);
  const swarmClearTimerRef = useRef<number | null>(null);
  const lastTauntTimeRef = useRef(0);

  // TV-side remote phone state refs
  const remoteVisionRef = useRef<RemoteVisionFramePayload | null>(null);
  const remoteVisionReceivedAtRef = useRef<number>(0);
  const remoteAttackQueueRef = useRef<AttackEvent[]>([]);
  const remoteJpegImgRef = useRef<HTMLImageElement | null>(null);
  const remoteMirrorRef = useRef<boolean>(true);
  const remoteCommandHandlerRef = useRef<(cmd: RemoteCommand) => void>(() => {});

  // Practice mode pointer tracking refs
  const practiceCursorRef = useRef<Point2D | null>(null);
  const practiceTrailRef = useRef<Array<{ x: number; y: number; time: number }>>([]);

  settingsRef.current = settings;
  phaseRef.current = phase;
  effDiffRef.current = effectiveDifficulty;
  activeChallengeRef.current = activeChallenge;
  deviceRoleRef.current = deviceRole;
  firebaseUserRef.current = firebaseUser;
  accountRef.current = account;
  guestProfileRef.current = guestProfile;
  accountModalOpenRef.current = accountModalOpen;

  // Sync audio, backend API routing & local settings persistence
  useEffect(() => {
    if (sessionHydratedRef.current) {
      saveLocalSettings(settings, null);
    } else {
      try {
        window.localStorage.setItem('ai_mosquito_slapper_settings_v1', JSON.stringify(settings));
      } catch {
        // Ignore quota errors
      }
    }
    soundMgrRef.current.configure({
      sfxVolume: settings.sfxVolume,
      buzzVolume: settings.buzzVolume,
      muted: settings.muted,
      enableMissVoice: settings.enableMissVoice,
    });
    handTrackerRef.current?.updateSensitivity(settings.handTrackingSensitivity);
    llmRef.current.updateConfig(settings.llm);
    llmRef.current.updateBackendConfig(settings.backend);
    companionRef.current.setBackendConfig(settings.backend);
    companionRef.current.updatePhoneMirror(settings.mirrorCamera);
    if (!settings.backend.enabled) {
      setBackendStatus('BUILTIN');
      setBackendStatusMsg('Using built-in local Express server.');
    }
    if (!settings.autoDifficulty) {
      setEffectiveDifficulty(settings.difficulty);
    }
  }, [settings]);

  // Debounced cloud preferences sync to Firestore for signed-in Google players
  useEffect(() => {
    if (!firebaseUser || !prefsHydratedRef.current) return;
    const uid = firebaseUser.uid;
    const timer = window.setTimeout(() => {
      void saveFirestoreUserPreferences(uid, settings);
    }, 600);
    return () => window.clearTimeout(timer);
  }, [
    firebaseUser,
    settings.difficulty,
    settings.autoDifficulty,
    settings.initialMosquitoCount,
    settings.mosquitoSpeedMultiplier,
    settings.sfxVolume,
    settings.buzzVolume,
    settings.muted,
    settings.enableMissVoice,
    settings.showLandmarks,
    settings.showHandPointer,
    settings.showFaceZones,
    settings.enableFaceLanding,
    settings.mirrorCamera,
    settings.practiceMode,
  ]);

  // Listen to Firebase Authentication state (never blocks Guest play on load)
  useEffect(() => {
    const unsubscribeAuth = subscribeFirebaseAuth((fbUser) => {
      setFirebaseUser(fbUser);
      setAuthReady(true);
      if (!fbUser) {
        setAccount(null);
        prefsHydratedRef.current = false;
      }
    });
    return () => unsubscribeAuth();
  }, []);

  // Hydrate Firestore profile & preferences when signed in, or load optional server config for Guests
  useEffect(() => {
    if (!authReady) return;
    let active = true;
    let unsubscribeProfile: (() => void) | null = null;

    if (!firebaseUser) {
      loadServerConfig(settingsRef.current.backend, null)
        .then((serverCfg) => {
          if (active && serverCfg) {
            setSettings((prev) => mergeSettings(prev, serverCfg));
          }
        })
        .finally(() => {
          if (active) {
            sessionHydratedRef.current = true;
          }
        });
      return () => {
        active = false;
      };
    }

    // Live Firestore profile subscription (updates immediately on displayName / match sync)
    unsubscribeProfile = subscribeFirestoreUserProfile(firebaseUser, (liveProfile) => {
      if (active) {
        setAccount(liveProfile);
      }
    });

    // For restored sessions (not initiated via active sign-in popup), ensure profile & hydrate prefs
    if (!signInInProgressRef.current) {
      Promise.all([
        ensureFirestoreUserProfile(firebaseUser).catch(() => null),
        loadFirestoreUserPreferences(firebaseUser.uid).catch(() => null),
      ])
        .then(([profile, savedPrefs]) => {
          if (!active) return;
          if (profile) setAccount(profile);
          if (savedPrefs) {
            setSettings((prev) => mergeSettings(prev, savedPrefs));
          }
        })
        .finally(() => {
          if (active) {
            prefsHydratedRef.current = true;
            sessionHydratedRef.current = true;
          }
        });
    }

    return () => {
      active = false;
      unsubscribeProfile?.();
    };
  }, [authReady, firebaseUser]);

  const openAccountModal = useCallback((tab: AccountModalTab = 'profile') => {
    setAccountModalTab(tab);
    setAccountModalOpen(true);
  }, []);

  const handleSignInWithGoogle = useCallback(async (importGuest: boolean) => {
    const curGuest = guestProfileRef.current;
    const guestImport =
      importGuest && curGuest.stats.gamesPlayed > 0
        ? {
            stats: curGuest.stats,
            unlockedAchievements: curGuest.unlockedAchievements,
          }
        : null;

    signInInProgressRef.current = true;
    try {
      const res = await signInWithGoogleAccount(guestImport);
      if (res.ok && res.account) {
        setAccount(res.account);
        if (guestImport) {
          setGuestProfile((prev) => clearGuestStats(prev));
        }
        if (res.savedPreferences) {
          setSettings((prev) => mergeSettings(prev, res.savedPreferences!));
        }
        prefsHydratedRef.current = true;
        sessionHydratedRef.current = true;
        return { ok: true };
      }
      return { ok: false, error: res.error };
    } finally {
      signInInProgressRef.current = false;
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    prefsHydratedRef.current = false;
    await signOutGoogleAccount();
    setAccount(null);
    setFirebaseUser(null);
  }, []);

  const handleUpdateDisplayName = useCallback(async (nextName: string) => {
    const fbUser = firebaseUserRef.current;
    if (fbUser && accountRef.current) {
      const res = await updateFirestoreDisplayName(fbUser.uid, nextName);
      if (res.ok && res.displayName) {
        setAccount((prev) => (prev ? { ...prev, displayName: res.displayName! } : prev));
        return { ok: true };
      }
      return { ok: false, error: res.error };
    }
    setGuestProfile((prev) => updateGuestDisplayName(prev, nextName));
    return { ok: true };
  }, []);

  const handleImportGuestToAccount = useCallback(async () => {
    const fbUser = firebaseUserRef.current;
    if (!fbUser) {
      return { ok: false, error: 'Sign in with Google first to import Guest stats.' };
    }
    const res = await importGuestProgressToCloud(fbUser, guestProfileRef.current);
    if (res.ok && res.account) {
      setAccount(res.account);
      setGuestProfile((prev) => clearGuestStats(prev));
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }, []);

  const handleClearGuestHistory = useCallback(() => {
    setGuestProfile((prev) => clearGuestStats(prev));
  }, []);

  // Preload practice mode backdrop image
  useEffect(() => {
    const img = new Image();
    img.src = PRACTICE_BACKDROP_IMAGE;
    backdropImgRef.current = img;
  }, []);

  // Unlock Web Audio on first user tap/click anywhere (critical for TV & iOS Safari)
  useEffect(() => {
    const unlockOnce = () => {
      soundMgrRef.current.unlock();
    };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    };
  }, []);

  // Test Backend API reachability & latency
  const handleTestBackend = useCallback(async () => {
    const cfg = settingsRef.current.backend;
    setBackendStatus('TESTING');
    setBackendStatusMsg('Testing backend endpoint...');
    const result = await testBackendConnection(cfg);
    if (result.ok) {
      setBackendStatus(cfg.enabled ? 'CONNECTED' : 'BUILTIN');
      setBackendStatusMsg(result.message);
    } else {
      setBackendStatus('ERROR');
      setBackendStatusMsg(result.message);
    }
  }, []);

  // Probe LM Studio asynchronously on mount
  const testLlmConnection = useCallback(async () => {
    llmRef.current.updateConfig(settingsRef.current.llm);
    llmRef.current.updateBackendConfig(settingsRef.current.backend);
    const res = await llmRef.current.testConnection();
    setLlmStatus(res.status);
    setLlmModels(res.models);
    setLlmStatusMsg(res.message);
    if (res.ok) {
      llmRef.current.warmCachesAsync();
      if (
        res.models.length > 0 &&
        (settingsRef.current.llm.model === 'local-model' || !settingsRef.current.llm.model)
      ) {
        setSettings((prev) => ({
          ...prev,
          llm: { ...prev.llm, model: res.models[0] },
        }));
      }
    }
  }, []);

  useEffect(() => {
    void testLlmConnection();
  }, [testLlmConnection]);

  // Update difficulty description (via local LLM cache or instant offline profile)
  useEffect(() => {
    let cancelled = false;
    setDifficultyDesc(DIFFICULTY_PROFILES[settings.difficulty].summary);
    llmRef.current.getDifficultyDescription(settings.difficulty).then((desc) => {
      if (!cancelled && desc) setDifficultyDesc(desc);
    });
    return () => {
      cancelled = true;
    };
  }, [settings.difficulty, llmStatus]);

  // Wire CompanionLink callbacks once
  useEffect(() => {
    const link = companionRef.current;
    link.setBackendConfig(settingsRef.current.backend);
    link.setCallbacks({
      onConnectionStateChange: (state) => {
        setCompanionState(state);
        if (state === 'CONNECTED') {
          setCompanionError(null);
          // Re-attach phone media as soon as peer connects
          if (deviceRoleRef.current === 'PHONE_CAMERA') {
            const stream = webcamMgrRef.current?.getStream() ?? null;
            link.attachPhoneMedia(stream, videoRef.current, settingsRef.current.mirrorCamera);
          }
        }
      },
      onRoomCode: (code) => {
        setRoomCode(code);
      },
      onTransportChange: (mode) => {
        setTransportMode(mode);
      },
      onError: (msg) => {
        setCompanionError(msg);
      },
      onRemoteStream: (stream) => {
        const rv = remoteVideoRef.current;
        if (!rv) return;
        if (stream) {
          rv.srcObject = stream;
          rv.muted = true;
          rv.playsInline = true;
          rv.play().catch(() => {});
        } else {
          rv.srcObject = null;
        }
      },
      onRemoteJpegFrame: (dataUrl, mirrored) => {
        remoteMirrorRef.current = mirrored;
        const img = new Image();
        img.onload = () => {
          remoteJpegImgRef.current = img;
        };
        img.src = dataUrl;
      },
      onRemoteVisionFrame: (payload) => {
        remoteVisionRef.current = payload;
        remoteVisionReceivedAtRef.current = performance.now();
        remoteMirrorRef.current = payload.mirrorCamera;
      },
      onRemoteAttack: (attack) => {
        remoteAttackQueueRef.current.push(attack);
        if (remoteAttackQueueRef.current.length > 8) {
          remoteAttackQueueRef.current.shift();
        }
      },
      onRemoteCommand: (cmd) => {
        remoteCommandHandlerRef.current(cmd);
      },
      onTvHud: (hud) => {
        setTvHudSync(hud);
      },
    });

    // Check URL params for instant QR-code phone join (`/?mode=phone&room=XXXX`), TV launch (`/?mode=tv`),
    // or platform download deep-links (`/?downloads=1` or `/?install=android|apple|windows`)
    const params = new URLSearchParams(window.location.search);
    const urlMode = params.get('mode');
    const urlRoom = params.get('room');
    const urlInstall = (params.get('install') || '').toLowerCase();
    const urlDownloads = params.get('downloads');

    if (urlMode === 'phone' && urlRoom && /^\d{4}$/.test(urlRoom)) {
      setDeviceRole('PHONE_CAMERA');
      deviceRoleRef.current = 'PHONE_CAMERA';
      setRoomCode(urlRoom);
      link.connectAsPhone(urlRoom);
    } else if (urlMode === 'tv') {
      setDeviceRole('TV_DISPLAY');
      deviceRoleRef.current = 'TV_DISPLAY';
      setTvModalOpen(true);
      link.connectAsTv();
    } else if (urlInstall === 'android' || urlInstall === 'apple' || urlInstall === 'windows') {
      setDownloadPlatformFocus(urlInstall);
      setDownloadsOpen(true);
    } else if (urlDownloads === '1' || urlDownloads === 'true') {
      setDownloadPlatformFocus(null);
      setDownloadsOpen(true);
    }

    return () => {
      link.disconnect();
    };
  }, []);

  // Initialize Webcam + MediaPipe HandTracker (active in STANDALONE and PHONE_CAMERA; disabled in TV_DISPLAY)
  const initWebcam = useCallback(async () => {
    const role = deviceRoleRef.current;
    if (role === 'TV_DISPLAY') {
      webcamMgrRef.current?.stop();
      setWebcamActive(false);
      setWebcamError(null);
      return;
    }

    if (role === 'STANDALONE' && settingsRef.current.practiceMode) {
      webcamMgrRef.current?.stop();
      setWebcamActive(false);
      setWebcamError(null);
      setVisionMode('PRACTICE_MOUSE');
      return;
    }

    const video = videoRef.current;
    if (!video) return;
    if (!webcamMgrRef.current) webcamMgrRef.current = new WebcamManager();

    setWebcamError(null);
    // In Phone Camera mode, cap resolution at 720p for silky-smooth mobile MediaPipe + WebRTC streaming
    const preferredRes =
      role === 'PHONE_CAMERA' && settingsRef.current.resolution === '1080p'
        ? '720p'
        : settingsRef.current.resolution;

    const result = await webcamMgrRef.current.start(
      video,
      preferredRes,
      settingsRef.current.cameraDeviceId || undefined,
      settingsRef.current.cameraFacing,
    );

    const list = await webcamMgrRef.current.enumerateCameras();
    setCameras(list);

    if (result.active) {
      setWebcamActive(true);
      setWebcamError(null);
      setCameraResLabel(`${result.width} × ${result.height}`);

      if (role === 'PHONE_CAMERA') {
        companionRef.current.attachPhoneMedia(
          webcamMgrRef.current.getStream(),
          video,
          settingsRef.current.mirrorCamera,
        );
      }

      if (!handTrackerRef.current) {
        handTrackerRef.current = new HandTracker();
      }
      if (!faceTrackerRef.current) {
        faceTrackerRef.current = new FaceTracker();
      }
      setVisionMode('INITIALIZING');
      // Initialize MediaPipe tasks sequentially so their global self.ModuleFactory loader never races
      const mode = await handTrackerRef.current.initialize(
        settingsRef.current.handTrackingSensitivity,
      );
      setVisionMode(mode);
      await faceTrackerRef.current.initialize();
    } else {
      setWebcamActive(false);
      setWebcamError(result.error);
    }
  }, []);

  useEffect(() => {
    void initWebcam();
    return () => {
      webcamMgrRef.current?.stop();
    };
  }, [
    settings.cameraDeviceId,
    settings.cameraFacing,
    settings.resolution,
    settings.practiceMode,
    deviceRole,
    initWebcam,
  ]);

  // Dispose hardware resources on unmount
  useEffect(() => {
    return () => {
      companionRef.current.disconnect();
      webcamMgrRef.current?.stop();
      handTrackerRef.current?.dispose();
      faceTrackerRef.current?.dispose();
      soundMgrRef.current.dispose();
      if (swarmClearTimerRef.current !== null) {
        window.clearTimeout(swarmClearTimerRef.current);
      }
    };
  }, []);

  // Keep arena & phone preview canvases sized crisply across any resolution, DPR, orientation, or split-screen resize
  useEffect(() => {
    const computeCrispSize = (rectWidth: number, rectHeight: number): { w: number; h: number } => {
      const cssW = Math.max(200, rectWidth);
      const cssH = Math.max(180, rectHeight);
      const rawDpr = Math.min(window.devicePixelRatio || 1, 2);
      // Keep max render buffer <= 2560px on any axis so 4K/Retina devices sustain silky 60fps
      const maxAxis = Math.max(cssW, cssH) * rawDpr;
      const effectiveDpr = maxAxis > 2560 ? (2560 / Math.max(cssW, cssH)) : rawDpr;
      return {
        w: Math.max(200, Math.round(cssW * effectiveDpr)),
        h: Math.max(180, Math.round(cssH * effectiveDpr)),
      };
    };

    const syncCanvasSize = () => {
      const canvas = canvasRef.current;
      const arena = arenaRef.current;
      if (canvas && arena) {
        const rect = arena.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const { w, h } = computeCrispSize(rect.width, rect.height);
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
        }
      }

      const phoneCanvas = phonePreviewCanvasRef.current;
      if (phoneCanvas && phoneCanvas.parentElement) {
        const rect = phoneCanvas.parentElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const { w, h } = computeCrispSize(rect.width, rect.height);
          if (phoneCanvas.width !== w || phoneCanvas.height !== h) {
            phoneCanvas.width = w;
            phoneCanvas.height = h;
          }
        }
      }
    };

    syncCanvasSize();
    const rafInitial = window.requestAnimationFrame(syncCanvasSize);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => syncCanvasSize());
      if (arenaRef.current) observer.observe(arenaRef.current);
      if (phonePreviewCanvasRef.current?.parentElement) {
        observer.observe(phonePreviewCanvasRef.current.parentElement);
      }
    }

    const onOrientationChange = () => {
      syncCanvasSize();
      window.setTimeout(syncCanvasSize, 180);
    };

    window.addEventListener('resize', syncCanvasSize);
    window.addEventListener('orientationchange', onOrientationChange);
    window.visualViewport?.addEventListener('resize', syncCanvasSize);

    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      syncCanvasSize();
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.cancelAnimationFrame(rafInitial);
      observer?.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
      window.removeEventListener('orientationchange', onOrientationChange);
      window.visualViewport?.removeEventListener('resize', syncCanvasSize);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [deviceRole]);

  // Helper to push visual effects safely
  const pushEffect = useCallback((fx: Omit<VisualEffect, 'id'>) => {
    effectsRef.current.push({
      ...fx,
      id: `fx-${++effectSeqRef.current}`,
    });
    if (effectsRef.current.length > 48) {
      effectsRef.current.splice(0, effectsRef.current.length - 48);
    }
  }, []);

  // Trigger Game Over and ask local LLM for async debrief
  const finishGame = useCallback((clearedAll: boolean) => {
    if (swarmClearTimerRef.current !== null) {
      window.clearTimeout(swarmClearTimerRef.current);
      swarmClearTimerRef.current = null;
    }
    phaseRef.current = GamePhase.GAME_OVER;
    setPhase(GamePhase.GAME_OVER);
    setSwarmCleared(clearedAll);
    soundMgrRef.current.stopBuzzing();
    soundMgrRef.current.playGameOver();

    const snapshot = { ...statsRef.current };
    setStats(snapshot);
    const unlockedTitles = buildAchievements(snapshot)
      .filter((a) => a.unlocked)
      .map((a) => a.title);

    setAiDebrief(
      clearedAll
        ? `Every single mosquito cleared! ${snapshot.mosquitoesKilled} swatted at ${Math.round(snapshot.accuracy)}% accuracy.`
        : `Session complete: ${snapshot.mosquitoesKilled} kills, ${snapshot.missedAttacks} misses, best combo ${snapshot.highestCombo}x.`,
    );

    llmRef.current.generateGameOverDebrief(snapshot, unlockedTitles).then((line) => {
      if (line) setAiDebrief(line);
    });

    const fbUser = firebaseUserRef.current;
    const activeAccount = accountRef.current;

    if (fbUser && activeAccount) {
      // Signed-in Google player: atomic Firestore profile + Cloud Leaderboard write
      setScoreSyncStatus('Syncing score to Firebase Cloud Leaderboard...');
      recordSignedInMatchToFirestore(
        fbUser,
        activeAccount,
        snapshot,
        effDiffRef.current,
        clearedAll,
        unlockedTitles,
      ).then((res) => {
        setScoreSyncStatus(res.message);
        if (res.account) {
          setAccount(res.account);
        }
      });

      // Optionally mirror score to a user-configured external Backend API
      if (
        isCustomBackendActive(settingsRef.current.backend) &&
        settingsRef.current.backend.syncScores
      ) {
        void submitMatchScore(
          settingsRef.current.backend,
          snapshot,
          effDiffRef.current,
          clearedAll,
          unlockedTitles,
          {
            playerName: activeAccount.displayName,
            isGuest: false,
          },
        );
      }
    } else {
      // Guest Mode (no login required): persist immediately in browser storage + optional leaderboard
      const guestName = guestProfileRef.current.displayName || 'Guest';
      setGuestProfile((prev) =>
        recordGuestMatch(prev, snapshot, effDiffRef.current, clearedAll, unlockedTitles),
      );

      if (settingsRef.current.backend.syncScores) {
        setScoreSyncStatus('Saving Guest score to leaderboard...');
        submitMatchScore(
          settingsRef.current.backend,
          snapshot,
          effDiffRef.current,
          clearedAll,
          unlockedTitles,
          {
            playerName: guestName,
            isGuest: true,
          },
        ).then((res) => {
          setScoreSyncStatus(res.message || 'Saved locally in browser.');
        });
      } else {
        setScoreSyncStatus('Saved locally in browser.');
      }
    }
  }, []);

  // Process a confirmed CLAP or SLAP attack through deterministic CollisionEngine
  const resolveAttack = useCallback(
    (attack: AttackEvent, nowMs: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const vw = canvas.width;
      const vh = canvas.height;

      const mosquitoes = mosquitoEngineRef.current.getMosquitoes();
      const prevCombo = statsRef.current.currentCombo;
      const resolution = collisionEngineRef.current.evaluateAttack(
        attack,
        mosquitoes,
        vw,
        vh,
        settingsRef.current,
        prevCombo,
      );

      if (attack.kind === 'CLAP') {
        pushEffect({
          kind: 'CLAP_RING',
          x: attack.position.x,
          y: attack.position.y,
          createdAt: nowMs,
          durationMs: 360,
          radius: attack.radius,
          color: resolution.isMiss ? '#FB7185' : '#C8F542',
        });
      } else {
        pushEffect({
          kind: 'SLAP_SWEEP',
          x: attack.position.x,
          y: attack.position.y,
          createdAt: nowMs,
          durationMs: 280,
          radius: attack.radius,
          trajectory: attack.trajectory,
          color: resolution.isMiss ? 'rgba(251, 113, 133, 0.72)' : 'rgba(200, 245, 66, 0.85)',
        });
      }

      const nextStats = { ...statsRef.current };
      nextStats.totalAttacks += 1;

      if (resolution.isMiss) {
        nextStats.missedAttacks += 1;
        nextStats.currentCombo = 0;
        nextStats.accuracy =
          nextStats.totalAttacks > 0
            ? (nextStats.successfulAttacks / nextStats.totalAttacks) * 100
            : 100;

        statsRef.current = nextStats;
        setStats(nextStats);

        soundMgrRef.current.playMissSound();
        const taunt = llmRef.current.getMissTaunt();
        pushEffect({
          kind: 'MISS_TEXT',
          x: Math.min(0.84, Math.max(0.16, attack.position.x)),
          y: Math.min(0.82, Math.max(0.2, attack.position.y)),
          createdAt: nowMs,
          durationMs: 1250,
          text: taunt,
          subtext: attack.kind === 'CLAP' ? 'Clap missed' : 'Slap missed',
          color: '#FDA4AF',
        });
        return;
      }

      // Hit confirmed! Kill ONLY the intersected mosquitoes
      const killCount = resolution.killedMosquitoes.length;
      const rescuedZones: FaceLandingZone[] = [];
      for (const hitMosq of resolution.killedMosquitoes) {
        const hitFaceZone =
          hitMosq.landingZone &&
          (hitMosq.animState === 'LANDED' || hitMosq.animState === 'APPROACHING_LANDING')
            ? hitMosq.landingZone
            : undefined;
        if (hitFaceZone) {
          rescuedZones.push(hitFaceZone);
          pushEffect({
            kind: 'FACE_ZONE_RIPPLE',
            x: hitMosq.x,
            y: hitMosq.y,
            createdAt: nowMs,
            durationMs: 680,
            color: '#FF6B35',
            scale: Math.max(0.85, Math.min(1.35, hitMosq.depthScale)),
            faceZone: hitFaceZone,
          });
        }
        mosquitoEngineRef.current.killMosquito(hitMosq.id);
        const comicWord = COMIC_HIT_WORDS[Math.floor(Math.random() * COMIC_HIT_WORDS.length)];
        pushEffect({
          kind: 'KILL_SPLAT',
          x: hitMosq.x,
          y: hitMosq.y,
          createdAt: nowMs,
          durationMs: 560,
          color: '#C8F542',
          comicWord,
          scale: Math.max(0.85, Math.min(1.45, hitMosq.depthScale)),
        });
      }

      const faceSaveBonus = rescuedZones.length * 15;
      const totalPointsAwarded = resolution.pointsAwarded + faceSaveBonus;

      nextStats.successfulAttacks += 1;
      nextStats.mosquitoesKilled += killCount;
      nextStats.mosquitoesRemaining = mosquitoEngineRef.current.getLivingCount();
      nextStats.currentCombo += killCount;
      if (nextStats.currentCombo > nextStats.highestCombo) {
        nextStats.highestCombo = nextStats.currentCombo;
      }
      if (killCount === 2) nextStats.doubleKills += 1;
      if (killCount >= 3) nextStats.tripleKills += 1;
      nextStats.score += totalPointsAwarded;
      nextStats.accuracy =
        nextStats.totalAttacks > 0
          ? (nextStats.successfulAttacks / nextStats.totalAttacks) * 100
          : 100;

      const chal = activeChallengeRef.current;
      if (chal && !chal.completed) {
        let updatedProgress = chal.progress;
        if (chal.targetType === 'KILLS') updatedProgress += killCount;
        else if (chal.targetType === 'COMBO')
          updatedProgress = Math.max(updatedProgress, nextStats.currentCombo);
        else if (chal.targetType === 'DOUBLE_KILL' && killCount >= 2) updatedProgress += 1;

        const completedNow = updatedProgress >= chal.targetValue;
        const updatedChal: ActiveChallenge = {
          ...chal,
          progress: updatedProgress,
          completed: completedNow,
        };
        activeChallengeRef.current = updatedChal;
        setActiveChallenge(updatedChal);

        if (completedNow) {
          nextStats.score += chal.bonusPoints;
          soundMgrRef.current.playComboAchievement();
          pushEffect({
            kind: 'FLOAT_TEXT',
            x: 0.5,
            y: 0.28,
            createdAt: nowMs,
            durationMs: 1650,
            text: `CHALLENGE COMPLETE! +${chal.bonusPoints}`,
            subtext: chal.title,
            color: '#FF6B35',
          });
          window.setTimeout(() => {
            if (phaseRef.current === GamePhase.PLAYING) {
              llmRef.current.generatePersonalizedChallenge(statsRef.current).then((nextC) => {
                activeChallengeRef.current = nextC;
                setActiveChallenge(nextC);
              });
            }
          }, 2600);
        }
      }

      statsRef.current = nextStats;
      setStats(nextStats);

      soundMgrRef.current.playKillSound(killCount);
      if (resolution.comboBonus > 0) {
        soundMgrRef.current.playComboAchievement();
      }

      const bonusTags: string[] = [];
      if (rescuedZones.length > 0) {
        const zoneName = FACE_ZONE_LABELS[rescuedZones[0]].toUpperCase();
        bonusTags.push(
          rescuedZones.length === 1
            ? `${zoneName} SAVED +${faceSaveBonus}`
            : `FACE SAVED x${rescuedZones.length} +${faceSaveBonus}`,
        );
      }
      if (killCount === 2) bonusTags.push(`DOUBLE KILL +${resolution.multiKillBonus}`);
      else if (killCount >= 3) bonusTags.push(`TRIPLE KILL +${resolution.multiKillBonus}`);
      if (resolution.comboBonus > 0) {
        bonusTags.push(`${nextStats.currentCombo}x COMBO +${resolution.comboBonus}`);
      }

      pushEffect({
        kind: 'FLOAT_TEXT',
        x: Math.min(0.86, Math.max(0.14, attack.position.x)),
        y: Math.min(0.84, Math.max(0.18, attack.position.y)),
        createdAt: nowMs,
        durationMs: 1300,
        text: `+${totalPointsAwarded} POINTS`,
        subtext: bonusTags.length > 0 ? bonusTags.join(' · ') : llmRef.current.getKillQuip(),
        color: bonusTags.length > 0 ? '#FF6B35' : '#C8F542',
      });

      if (rescuedZones.length > 0) {
        setCommentary(
          `Quick reflex! Swatted a mosquito right off your ${FACE_ZONE_LABELS[rescuedZones[0]].toLowerCase()} (+${faceSaveBonus} Face Save)!`,
        );
      }

      if (killCount >= 2 || nextStats.currentCombo === 5 || nextStats.currentCombo === 10) {
        const desc =
          killCount >= 2
            ? `Player landed a ${killCount}-mosquito ${attack.kind.toLowerCase()} for +${totalPointsAwarded} points!`
            : `Player reached a ${nextStats.currentCombo}x kill combo at ${Math.round(nextStats.accuracy)}% accuracy!`;
        llmRef.current.getLiveCommentary(desc).then((line) => {
          if (line) setCommentary(line);
        });
      }

      if (settingsRef.current.autoDifficulty) {
        const nextDiff = computeAutoDifficulty(
          effDiffRef.current,
          nextStats.mosquitoesKilled,
          nextStats.accuracy,
          nextStats.currentCombo,
          nextStats.elapsedSeconds,
        );
        if (nextDiff !== effDiffRef.current) {
          effDiffRef.current = nextDiff;
          setEffectiveDifficulty(nextDiff);
          setCommentary(`Auto-Difficulty stepped to ${DIFFICULTY_PROFILES[nextDiff].label}!`);
        }
      }

      if (nextStats.mosquitoesRemaining === 0 && swarmClearTimerRef.current === null) {
        swarmClearTimerRef.current = window.setTimeout(() => {
          if (
            phaseRef.current === GamePhase.PLAYING &&
            mosquitoEngineRef.current.getLivingCount() === 0
          ) {
            finishGame(true);
          } else {
            swarmClearTimerRef.current = null;
          }
        }, 950);
      }
    },
    [finishGame, pushEffect],
  );

  // Start / Restart game helper
  const startNewGame = useCallback(() => {
    soundMgrRef.current.unlock();
    soundMgrRef.current.playGameStart();

    if (swarmClearTimerRef.current !== null) {
      window.clearTimeout(swarmClearTimerRef.current);
      swarmClearTimerRef.current = null;
    }

    const canvas = canvasRef.current;
    const vw = canvas?.width || 1280;
    const vh = canvas?.height || 720;
    const initialCount = settingsRef.current.initialMosquitoCount;
    const startDiff = settingsRef.current.difficulty;

    gestureFsmRef.current.reset();
    effectsRef.current = [];
    mosquitoEngineRef.current.setPatternBias({});
    mosquitoEngineRef.current.reset(initialCount, vw, vh, startDiff);

    const freshStats = createInitialStats(initialCount);
    statsRef.current = freshStats;
    setStats(freshStats);
    effDiffRef.current = startDiff;
    setEffectiveDifficulty(startDiff);
    setSwarmTacticName(null);
    setSwarmCleared(false);
    phaseRef.current = GamePhase.PLAYING;
    setPhase(GamePhase.PLAYING);
    setTvModalOpen(false);

    llmRef.current
      .getLiveCommentary(
        `New match started with ${initialCount} mosquitoes on ${startDiff} difficulty.`,
      )
      .then((line) => {
        if (line) setCommentary(line);
      });

    llmRef.current.generatePersonalizedChallenge(freshStats).then((chal) => {
      activeChallengeRef.current = chal;
      setActiveChallenge(chal);
    });
  }, []);

  const handleResetToCalibration = useCallback(() => {
    if (swarmClearTimerRef.current !== null) {
      window.clearTimeout(swarmClearTimerRef.current);
      swarmClearTimerRef.current = null;
    }
    soundMgrRef.current.stopBuzzing();
    gestureFsmRef.current.reset();
    effectsRef.current = [];
    const canvas = canvasRef.current;
    mosquitoEngineRef.current.reset(
      settingsRef.current.initialMosquitoCount,
      canvas?.width || 1280,
      canvas?.height || 720,
      settingsRef.current.difficulty,
    );
    const freshStats = createInitialStats(settingsRef.current.initialMosquitoCount);
    statsRef.current = freshStats;
    setStats(freshStats);
    calibrationRef.current = 0;
    setCalibrationProgress(0);
    setActiveChallenge(null);
    activeChallengeRef.current = null;
    phaseRef.current = GamePhase.CALIBRATION;
    setPhase(GamePhase.CALIBRATION);
  }, []);

  const handlePauseToggle = useCallback(() => {
    if (phaseRef.current === GamePhase.PLAYING) {
      phaseRef.current = GamePhase.PAUSED;
      setPhase(GamePhase.PAUSED);
      soundMgrRef.current.stopBuzzing();
    } else if (phaseRef.current === GamePhase.PAUSED) {
      soundMgrRef.current.unlock();
      phaseRef.current = GamePhase.PLAYING;
      setPhase(GamePhase.PLAYING);
    }
  }, []);

  const handleAddMosquitoes = useCallback((count: number) => {
    if (swarmClearTimerRef.current !== null) {
      window.clearTimeout(swarmClearTimerRef.current);
      swarmClearTimerRef.current = null;
    }
    const canvas = canvasRef.current;
    const added = mosquitoEngineRef.current.addMosquitoes(
      count,
      canvas?.width || 1280,
      canvas?.height || 720,
      effDiffRef.current,
    );
    if (added.length === 0) return;

    const nextStats = {
      ...statsRef.current,
      totalMosquitoesSpawned: statsRef.current.totalMosquitoesSpawned + added.length,
      mosquitoesRemaining: mosquitoEngineRef.current.getLivingCount(),
    };
    statsRef.current = nextStats;
    setStats(nextStats);
  }, []);

  const handleRemoveMosquitoes = useCallback((count: number) => {
    const removed = mosquitoEngineRef.current.removeMosquitoes(count);
    if (removed === 0) return;
    const nextStats = {
      ...statsRef.current,
      totalMosquitoesSpawned: Math.max(
        statsRef.current.mosquitoesKilled,
        statsRef.current.totalMosquitoesSpawned - removed,
      ),
      mosquitoesRemaining: mosquitoEngineRef.current.getLivingCount(),
    };
    statsRef.current = nextStats;
    setStats(nextStats);
  }, []);

  const handleFlipCamera = useCallback(() => {
    setSettings((prev) => {
      const nextFacing = prev.cameraFacing === 'user' ? 'environment' : 'user';
      return {
        ...prev,
        cameraFacing: nextFacing,
        cameraDeviceId: '',
        mirrorCamera: nextFacing === 'user',
      };
    });
  }, []);

  // Handle remote control commands sent from the paired Phone Camera Controller to the TV Display
  useEffect(() => {
    remoteCommandHandlerRef.current = (cmd: RemoteCommand) => {
      if (deviceRoleRef.current !== 'TV_DISPLAY') return;
      switch (cmd.action) {
        case 'START':
          startNewGame();
          break;
        case 'PAUSE_TOGGLE':
          handlePauseToggle();
          break;
        case 'RESTART':
          startNewGame();
          break;
        case 'RESET':
          handleResetToCalibration();
          break;
        case 'END_GAME':
          finishGame(false);
          break;
        case 'ADD_MOSQUITOES':
          handleAddMosquitoes(cmd.count);
          break;
        case 'REMOVE_MOSQUITOES':
          handleRemoveMosquitoes(cmd.count);
          break;
        case 'SET_DIFFICULTY':
          setSettings((prev) => ({ ...prev, difficulty: cmd.level }));
          setEffectiveDifficulty(cmd.level);
          break;
        case 'TOGGLE_MUTE':
          setSettings((prev) => ({ ...prev, muted: !prev.muted }));
          break;
        case 'TOGGLE_POINTER':
          setSettings((prev) => ({ ...prev, showHandPointer: !prev.showHandPointer }));
          break;
      }
    };
  }, [
    startNewGame,
    handlePauseToggle,
    handleResetToCalibration,
    finishGame,
    handleAddMosquitoes,
    handleRemoveMosquitoes,
  ]);

  // Companion Role transitions
  const handleSwitchStandalone = useCallback(() => {
    companionRef.current.disconnect();
    remoteVisionRef.current = null;
    remoteAttackQueueRef.current = [];
    remoteJpegImgRef.current = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCompanionError(null);
    setRoomCode(null);
    setTvHudSync(null);
    setDeviceRole('STANDALONE');
    deviceRoleRef.current = 'STANDALONE';
  }, []);

  const handleStartTvMode = useCallback(() => {
    setCompanionError(null);
    remoteVisionRef.current = null;
    remoteAttackQueueRef.current = [];
    setDeviceRole('TV_DISPLAY');
    deviceRoleRef.current = 'TV_DISPLAY';
    companionRef.current.connectAsTv(roomCode ?? undefined);
  }, [roomCode]);

  const handleRegenerateTvRoom = useCallback(() => {
    setCompanionError(null);
    setRoomCode(null);
    companionRef.current.connectAsTv();
  }, []);

  const handleJoinAsPhone = useCallback((code: string) => {
    setCompanionError(null);
    setRoomCode(code);
    setDeviceRole('PHONE_CAMERA');
    deviceRoleRef.current = 'PHONE_CAMERA';
    setTvModalOpen(false);
    soundMgrRef.current.stopBuzzing();
    companionRef.current.connectAsPhone(code);
  }, []);

  const handleRequestSwarmTactic = useCallback(() => {
    llmRef.current.suggestSwarmDirective(effDiffRef.current).then((directive) => {
      mosquitoEngineRef.current.setPatternBias(directive.patternBias);
      setSwarmTacticName(directive.name);
      setCommentary(directive.commentary);
    });
  }, []);

  const handleToggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await arenaRef.current?.requestFullscreen?.();
      } else {
        await document.exitFullscreen?.();
      }
    } catch {
      // Fullscreen may be restricted inside some iframes
    }
  }, []);

  // Keyboard shortcuts for snappy arcade feel
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setTvModalOpen(false);
        setDownloadsOpen(false);
        setAccountModalOpen(false);
        return;
      }
      if (
        accountModalOpenRef.current ||
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        if (phaseRef.current === GamePhase.PLAYING || phaseRef.current === GamePhase.PAUSED) {
          handlePauseToggle();
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (phaseRef.current !== GamePhase.CALIBRATION) startNewGame();
      } else if (e.key === 'm' || e.key === 'M') {
        setSettings((prev) => ({ ...prev, muted: !prev.muted }));
      } else if (e.key === 'f' || e.key === 'F') {
        void handleToggleFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlePauseToggle, startNewGame, handleToggleFullscreen]);

  // Spawn preview mosquitoes during calibration so the screen immediately feels alive
  useEffect(() => {
    const canvas = canvasRef.current;
    mosquitoEngineRef.current.reset(
      settings.initialMosquitoCount,
      canvas?.width || 1280,
      canvas?.height || 720,
      settings.difficulty,
    );
    // Only on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Main 60FPS decoupled Vision + Physics + Render + Companion Streaming loop
  useEffect(() => {
    let rafId = 0;
    let lastFrameTime = performance.now();
    let lastUiSyncTime = 0;
    let lastVisionEmitTime = 0;
    let lastTvHudEmitTime = 0;
    let timerAccumulator = 0;

    const tick = (nowMs: number) => {
      const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - lastFrameTime) / 1000));
      lastFrameTime = nowMs;

      const cfg = settingsRef.current;
      const curPhase = phaseRef.current;
      const role = deviceRoleRef.current;

      // === MODE A: PHONE CAMERA CONTROLLER ===
      if (role === 'PHONE_CAMERA') {
        const video = videoRef.current;
        const pCanvas = phonePreviewCanvasRef.current;
        const pCtx = pCanvas?.getContext('2d');

        let hands: TrackedHand[] = [];
        let faceAnchor = createDefaultFaceAnchor();

        if (video && video.readyState >= 2) {
          if (handTrackerRef.current) {
            hands = handTrackerRef.current.detectFrame(
              video,
              nowMs,
              cfg.mirrorCamera,
              cfg.handTrackingSensitivity,
            );
          }
          if (faceTrackerRef.current) {
            faceAnchor = faceTrackerRef.current.update(video, nowMs, cfg.mirrorCamera);
          }
        }
        latestHandsRef.current = hands;

        const refW = pCanvas?.width || 720;
        const gestureOut = gestureFsmRef.current.update(hands, nowMs, cfg, refW);

        if (gestureOut.attack) {
          companionRef.current.sendAttack(gestureOut.attack);
          phoneFxRef.current.push({
            id: `pfx-${++effectSeqRef.current}`,
            kind: gestureOut.attack.kind === 'CLAP' ? 'CLAP_RING' : 'SLAP_SWEEP',
            x: gestureOut.attack.position.x,
            y: gestureOut.attack.position.y,
            createdAt: nowMs,
            durationMs: 320,
            radius: gestureOut.attack.radius,
            trajectory: gestureOut.attack.trajectory,
            color: '#C8F542',
          });
        }

        // Stream live tracking payloads at ~30Hz to the paired TV
        if (nowMs - lastVisionEmitTime >= 33) {
          lastVisionEmitTime = nowMs;
          companionRef.current.sendVisionFrame({
            hands,
            faceAnchor,
            gestureState: gestureOut.state,
            clapReadiness: gestureOut.clapReadiness,
            mirrorCamera: cfg.mirrorCamera,
            cameraFacing: cfg.cameraFacing,
            sentAt: nowMs,
          });
        }

        phoneFxRef.current = phoneFxRef.current.filter((fx) => nowMs - fx.createdAt < fx.durationMs);

        // Render clean live camera framing preview on phone
        if (pCanvas && pCtx) {
          rendererRef.current.render({
            ctx: pCtx,
            width: pCanvas.width,
            height: pCanvas.height,
            video,
            backdropImage: null,
            mirrorCamera: cfg.mirrorCamera,
            practiceMode: false,
            mosquitoes: [],
            hands,
            faceAnchor,
            effects: phoneFxRef.current,
            showLandmarks: cfg.showLandmarks,
            showHandPointer: cfg.showHandPointer,
            showFaceZones: cfg.showFaceZones,
            showHitboxes: false,
            gestureState: gestureOut.state,
            clapReadiness: gestureOut.clapReadiness,
            practiceCursor: null,
            nowMs,
          });
        }

        // Keep audio quiet on phone so TV handles spatial speakers
        soundMgrRef.current.updateSwarmAudio(false, [], faceAnchor, nowMs);

        if (nowMs - lastUiSyncTime >= 120) {
          lastUiSyncTime = nowMs;
          setGestureState(gestureOut.state);
          setTrackedHandsUi(hands);
        }

        rafId = window.requestAnimationFrame(tick);
        return;
      }

      // === MODE B & C: STANDALONE & TV DISPLAY ===
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      const isTv = role === 'TV_DISPLAY';
      const activeVideo = isTv ? remoteVideoRef.current : videoRef.current;

      if (canvas && ctx) {
        let hands: TrackedHand[] = [];
        let faceAnchor = createDefaultFaceAnchor();
        let clapReadiness = 0;
        let currentGestureState = gestureFsmRef.current.getState();

        if (isTv) {
          // Consume real-time hand/face tracking streamed from paired Phone Camera
          const remoteFrame = remoteVisionRef.current;
          const isFresh = remoteFrame && nowMs - remoteVisionReceivedAtRef.current < 480;
          if (isFresh && remoteFrame) {
            hands = remoteFrame.hands;
            faceAnchor = remoteFrame.faceAnchor;
            clapReadiness = remoteFrame.clapReadiness;
            currentGestureState = remoteFrame.gestureState;
          } else {
            hands = [];
            currentGestureState = GestureState.IDLE;
          }

          // Process any queued clap/slap attacks sent by phone
          while (remoteAttackQueueRef.current.length > 0) {
            const remoteAtk = remoteAttackQueueRef.current.shift()!;
            if (curPhase === GamePhase.PLAYING) {
              resolveAttack(remoteAtk, nowMs);
            }
          }

          // Direct face/head smack-to-kill in TV Display mode (hitting forehead, cheek, nose, or head)
          if (curPhase === GamePhase.PLAYING && hands.length > 0 && faceAnchor.detected) {
            const tvFaceSmack = gestureFsmRef.current.evaluateFaceZoneSmack(
              hands,
              mosquitoEngineRef.current.getMosquitoes(),
              faceAnchor,
              nowMs,
              cfg,
              canvas.width,
            );
            if (tvFaceSmack) {
              resolveAttack(tvFaceSmack, nowMs);
            }
          }

          if (curPhase === GamePhase.CALIBRATION && hands.length > 0 && calibrationRef.current < 100) {
            calibrationRef.current = Math.min(100, calibrationRef.current + 45 * dtSec);
          }
        } else {
          // Standard local camera + MediaPipe tracking (cover-aligned to canvas pixels)
          if (!cfg.practiceMode && activeVideo && activeVideo.readyState >= 2) {
            if (handTrackerRef.current) {
              hands = handTrackerRef.current.detectFrame(
                activeVideo,
                nowMs,
                cfg.mirrorCamera,
                cfg.handTrackingSensitivity,
                canvas.width,
                canvas.height,
              );
            }
            if (faceTrackerRef.current) {
              faceAnchor = faceTrackerRef.current.update(
                activeVideo,
                nowMs,
                cfg.mirrorCamera,
                canvas.width,
                canvas.height,
              );
            }
          }

          if (!cfg.practiceMode) {
            const gestureOut = gestureFsmRef.current.update(
              hands,
              nowMs,
              cfg,
              canvas.width,
              curPhase === GamePhase.PLAYING ? mosquitoEngineRef.current.getMosquitoes() : undefined,
              faceAnchor,
            );
            clapReadiness = gestureOut.clapReadiness;
            currentGestureState = gestureOut.state;

            if (curPhase === GamePhase.PLAYING && gestureOut.attack) {
              resolveAttack(gestureOut.attack, nowMs);
            }

            if (curPhase === GamePhase.CALIBRATION && hands.length > 0 && calibrationRef.current < 100) {
              const gain = hands.length >= 2 ? 48 : 30;
              const speedBonus = hands.some((h) => h.speed > 0.35) ? 28 : 0;
              calibrationRef.current = Math.min(
                100,
                calibrationRef.current + (gain + speedBonus) * dtSec,
              );
            }
          } else {
            currentGestureState = GestureState.HAND_DETECTED;
          }
        }

        latestHandsRef.current = hands;

        // 3. Update 3D mosquito movement simulation (freezes cleanly when PAUSED)
        if (curPhase === GamePhase.PLAYING || curPhase === GamePhase.CALIBRATION) {
          const landingEvents = mosquitoEngineRef.current.update(
            dtSec,
            canvas.width,
            canvas.height,
            cfg,
            effDiffRef.current,
            hands,
            nowMs,
            faceAnchor,
            curPhase === GamePhase.PLAYING,
          );

          if (curPhase === GamePhase.PLAYING && landingEvents.length > 0) {
            for (const ev of landingEvents) {
              if (ev.type === 'LANDED') {
                soundMgrRef.current.playLandingTickle();
                setCommentary(`Mosquito landed on your ${ev.zoneLabel.toLowerCase()}! Swat it quick!`);
                pushEffect({
                  kind: 'FLOAT_TEXT',
                  x: Math.min(0.84, Math.max(0.16, ev.point.x)),
                  y: Math.min(0.82, Math.max(0.16, ev.point.y - 0.05)),
                  createdAt: nowMs,
                  durationMs: 1150,
                  text: `ON YOUR ${ev.zoneLabel.toUpperCase()}!`,
                  subtext: 'Swat for +15 Face Save',
                  color: '#FF6B35',
                });
              } else if (ev.type === 'TOOK_OFF') {
                soundMgrRef.current.playBiteEscapeLaugh();
              }
            }
          }
        }

        // 4. Periodic funny mosquito speech-bubble taunt during gameplay
        if (curPhase === GamePhase.PLAYING && nowMs - lastTauntTimeRef.current > 5200) {
          lastTauntTimeRef.current = nowMs;
          if (mosquitoEngineRef.current.getLivingCount() > 0) {
            mosquitoEngineRef.current.attachTaunt(llmRef.current.getMosquitoDialogue(), nowMs);
          }
        }

        // 5. Update game timer & realistic multi-mosquito spatial ear/face proximity audio
        if (curPhase === GamePhase.PLAYING) {
          timerAccumulator += dtSec;
          if (timerAccumulator >= 0.25) {
            statsRef.current = {
              ...statsRef.current,
              elapsedSeconds: statsRef.current.elapsedSeconds + timerAccumulator,
              mosquitoesRemaining: mosquitoEngineRef.current.getLivingCount(),
            };
            timerAccumulator = 0;
          }
          soundMgrRef.current.updateSwarmAudio(
            true,
            mosquitoEngineRef.current.getMosquitoes(),
            faceAnchor,
            nowMs,
            mosquitoEngineRef.current.getSwarmAcousticMetrics(),
          );
        } else {
          soundMgrRef.current.updateSwarmAudio(false, [], faceAnchor, nowMs);
        }

        // 6. Prune finished visual effects
        effectsRef.current = effectsRef.current.filter(
          (fx) => nowMs - fx.createdAt < fx.durationMs,
        );

        // 7. Render all layered canvas passes (Layer 6 HUD renders via React on top)
        rendererRef.current.render({
          ctx,
          width: canvas.width,
          height: canvas.height,
          video: activeVideo,
          remoteVideoImage: isTv ? remoteJpegImgRef.current : null,
          remoteVideoMirrored: isTv ? remoteMirrorRef.current : cfg.mirrorCamera,
          backdropImage: backdropImgRef.current,
          mirrorCamera: isTv ? remoteMirrorRef.current : cfg.mirrorCamera,
          practiceMode: isTv ? false : cfg.practiceMode,
          mosquitoes: mosquitoEngineRef.current.getMosquitoes(),
          hands,
          faceAnchor,
          effects: effectsRef.current,
          showLandmarks: cfg.showLandmarks,
          showHandPointer: cfg.showHandPointer,
          showFaceZones: cfg.showFaceZones,
          showHitboxes: cfg.showHitboxes,
          gestureState: currentGestureState,
          clapReadiness,
          practiceCursor: isTv ? null : practiceCursorRef.current,
          nowMs,
        });

        // 8. Push compact HUD sync back to Phone Camera Controller at ~6Hz when in TV Display Mode
        if (isTv && nowMs - lastTvHudEmitTime >= 165) {
          lastTvHudEmitTime = nowMs;
          const st = statsRef.current;
          companionRef.current.sendTvHud({
            phase: curPhase,
            score: st.score,
            mosquitoesKilled: st.mosquitoesKilled,
            mosquitoesRemaining: st.mosquitoesRemaining,
            totalMosquitoesSpawned: st.totalMosquitoesSpawned,
            currentCombo: st.currentCombo,
            highestCombo: st.highestCombo,
            accuracy: st.accuracy,
            elapsedSeconds: st.elapsedSeconds,
            difficulty: effDiffRef.current,
            muted: cfg.muted,
            showHandPointer: cfg.showHandPointer,
          });
        }

        // 9. Sync lightweight HUD telemetry to React at ~10Hz
        if (nowMs - lastUiSyncTime >= 110) {
          lastUiSyncTime = nowMs;
          setGestureState(currentGestureState);
          if (curPhase === GamePhase.CALIBRATION) {
            setTrackedHandsUi(hands);
            setCalibrationProgress(calibrationRef.current);
          }
          if (curPhase === GamePhase.PLAYING) {
            setStats({ ...statsRef.current });
          }
        }
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [resolveAttack]);

  // Practice Pointer Mode input handlers (ONLY active when settings.practiceMode is enabled in STANDALONE)
  const getNormalizedPointer = (e: PointerEvent<HTMLCanvasElement>): Point2D | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleCanvasPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (deviceRoleRef.current !== 'STANDALONE' || !settingsRef.current.practiceMode) return;
    const pt = getNormalizedPointer(e);
    if (!pt) return;
    const now = performance.now();
    practiceCursorRef.current = pt;

    const trail = practiceTrailRef.current;
    trail.push({ x: pt.x, y: pt.y, time: now });
    practiceTrailRef.current = trail.filter((p) => now - p.time <= 130).slice(-10);

    if (phaseRef.current === GamePhase.PLAYING && practiceTrailRef.current.length >= 3) {
      const first = practiceTrailRef.current[0];
      const dt = Math.max(0.015, (now - first.time) / 1000);
      const dist = Math.hypot(pt.x - first.x, pt.y - first.y);
      const speed = dist / dt;
      if (speed >= settingsRef.current.slapVelocityThreshold * 1.35 && dist >= 0.08) {
        const atk = gestureFsmRef.current.createPracticeAttack(
          'SLAP',
          practiceTrailRef.current.map((p) => ({ x: p.x, y: p.y })),
          now,
          settingsRef.current,
          canvasRef.current?.width || 1280,
        );
        if (atk) {
          soundMgrRef.current.unlock();
          resolveAttack(atk, now);
          practiceTrailRef.current = [];
        }
      }
    }
  };

  const handleCanvasPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (
      deviceRoleRef.current !== 'STANDALONE' ||
      !settingsRef.current.practiceMode ||
      phaseRef.current !== GamePhase.PLAYING
    ) {
      return;
    }
    const pt = getNormalizedPointer(e);
    if (!pt) return;
    const now = performance.now();
    const atk = gestureFsmRef.current.createPracticeAttack(
      'CLAP',
      [pt],
      now,
      settingsRef.current,
      canvasRef.current?.width || 1280,
    );
    if (atk) {
      soundMgrRef.current.unlock();
      resolveAttack(atk, now);
    }
  };

  const achievements = buildAchievements(stats);
  const isLoggedIn = Boolean(account);
  const playerDisplayName = account ? account.displayName : guestProfile.displayName;
  const playerUsername = account ? account.username : null;

  return (
    <>
      {/* Persistent hidden video sources (local camera & remote WebRTC phone camera) */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="pointer-events-none fixed h-px w-px opacity-0"
      />
      <video
        ref={remoteVideoRef}
        playsInline
        muted
        className="pointer-events-none fixed h-px w-px opacity-0"
      />

      <OfflineNotice />

      {deviceRole === 'PHONE_CAMERA' ? (
        <PhoneControllerView
          previewCanvasRef={phonePreviewCanvasRef}
          roomCode={roomCode}
          connectionState={companionState}
          transportMode={transportMode}
          companionError={companionError}
          webcamActive={webcamActive}
          webcamError={webcamError}
          cameraFacing={settings.cameraFacing}
          mirrorCamera={settings.mirrorCamera}
          handsCount={trackedHandsUi.length}
          gestureState={gestureState}
          tvHud={tvHudSync}
          onFlipCamera={handleFlipCamera}
          onToggleMirror={() =>
            setSettings((prev) => ({ ...prev, mirrorCamera: !prev.mirrorCamera }))
          }
          onRetryCamera={() => void initWebcam()}
          onSendCommand={(cmd) => companionRef.current.sendRemoteCommand(cmd)}
          onExitPhoneMode={handleSwitchStandalone}
          onChangeRoom={() => setTvModalOpen(true)}
        />
      ) : (
        <main
          ref={arenaRef}
          className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-[#0E1310] select-none"
        >
          {/* Full-Bleed Layered AR Canvas (Layers 1–5) */}
          <canvas
            ref={canvasRef}
            onPointerMove={handleCanvasPointerMove}
            onPointerDown={handleCanvasPointerDown}
            onContextMenu={(e) => {
              if (settings.practiceMode) e.preventDefault();
            }}
            className={`h-full w-full object-cover ${
              deviceRole === 'STANDALONE' && settings.practiceMode
                ? 'cursor-crosshair'
                : 'cursor-default'
            }`}
          />

          {/* Layer 6: Top Game HUD */}
          <GameHud
            phase={phase}
            stats={stats}
            effectiveDifficulty={effectiveDifficulty}
            autoDifficulty={settings.autoDifficulty}
            gestureState={gestureState}
            handsCount={latestHandsRef.current.length}
            visionMode={visionMode}
            llmStatus={llmStatus}
            commentary={commentary}
            activeChallenge={activeChallenge}
            swarmTacticName={swarmTacticName}
            deviceRole={deviceRole}
            roomCode={roomCode}
            companionState={companionState}
            transportMode={transportMode}
            playerDisplayName={playerDisplayName}
            isLoggedIn={isLoggedIn}
            onRequestSwarmTactic={handleRequestSwarmTactic}
            onOpenTvCast={() => setTvModalOpen(true)}
            onOpenAccount={() => openAccountModal('profile')}
          />

          {/* Calibration / Start Overlay */}
          {phase === GamePhase.CALIBRATION && (
            <CalibrationOverlay
              webcamActive={webcamActive}
              webcamError={webcamError}
              cameraResolutionLabel={cameraResLabel}
              cameraFacing={settings.cameraFacing}
              visionMode={visionMode}
              llmStatus={llmStatus}
              practiceMode={settings.practiceMode}
              hands={trackedHandsUi}
              calibrationProgress={calibrationProgress}
              difficulty={settings.difficulty}
              difficultyDescription={difficultyDesc}
              autoDifficulty={settings.autoDifficulty}
              initialMosquitoCount={settings.initialMosquitoCount}
              deviceRole={deviceRole}
              roomCode={roomCode}
              companionState={companionState}
              playerDisplayName={playerDisplayName}
              playerUsername={playerUsername}
              isLoggedIn={isLoggedIn}
              onDifficultyChange={(lvl) => {
                setSettings((prev) => ({ ...prev, difficulty: lvl }));
                setEffectiveDifficulty(lvl);
              }}
              onToggleAutoDifficulty={() =>
                setSettings((prev) => ({ ...prev, autoDifficulty: !prev.autoDifficulty }))
              }
              onStartGame={startNewGame}
              onRetryCamera={() => void initWebcam()}
              onFlipCamera={handleFlipCamera}
              onTogglePracticeMode={() =>
                setSettings((prev) => ({ ...prev, practiceMode: !prev.practiceMode }))
              }
              onOpenTvCast={() => setTvModalOpen(true)}
              onOpenDownloads={() => {
                setDownloadPlatformFocus(null);
                setDownloadsOpen(true);
              }}
              onOpenSettings={() => setSettingsOpen(true)}
              onOpenAccount={() => openAccountModal('profile')}
              onOpenLeaderboard={() => openAccountModal('leaderboard')}
            />
          )}

          {/* Paused Overlay */}
          {phase === GamePhase.PAUSED && (
            <div className="safe-x absolute inset-0 z-20 flex items-center justify-center overflow-y-auto bg-black/55 py-16 backdrop-blur-xs">
              <div className="my-auto w-full max-w-sm rounded-2xl border border-white/12 bg-[#121814]/95 p-5 text-center shadow-2xl sm:p-6">
                <h2 className="font-display text-xl font-extrabold text-[#F4F7F2] sm:text-2xl">
                  Game Paused
                </h2>
                <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">
                  {stats.mosquitoesRemaining} mosquito{stats.mosquitoesRemaining === 1 ? '' : 'es'}{' '}
                  still buzzing in mid-air.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={handlePauseToggle}
                    className="h-11 rounded-lg bg-[#C8F542] px-5 text-sm font-extrabold text-[#0E1310] hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={startNewGame}
                    className="h-11 rounded-lg border border-white/15 bg-[#1B231E] px-4 text-sm font-medium text-[#F4F7F2] hover:bg-[#26322B] whitespace-nowrap cursor-pointer"
                  >
                    Restart
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Game Over Modal */}
          {phase === GamePhase.GAME_OVER && (
            <GameOverModal
              stats={stats}
              achievements={achievements}
              aiDebrief={aiDebrief}
              swarmCleared={swarmCleared}
              scoreSyncStatus={scoreSyncStatus}
              playerDisplayName={playerDisplayName}
              playerUsername={playerUsername}
              isLoggedIn={isLoggedIn}
              onPlayAgain={startNewGame}
              onMainMenu={handleResetToCalibration}
              onOpenAccount={() => openAccountModal('profile')}
              onOpenLeaderboard={() => openAccountModal('leaderboard')}
            />
          )}

          {/* Bottom Interactive Control Dock */}
          <ControlDock
            phase={phase}
            difficulty={settings.difficulty}
            autoDifficulty={settings.autoDifficulty}
            muted={settings.muted}
            showHandPointer={settings.showHandPointer}
            isFullscreen={isFullscreen}
            livingCount={stats.mosquitoesRemaining}
            cameraFacing={settings.cameraFacing}
            deviceRole={deviceRole}
            roomCode={roomCode}
            companionConnected={companionState === 'CONNECTED'}
            playerDisplayName={playerDisplayName}
            isLoggedIn={isLoggedIn}
            onStart={startNewGame}
            onPauseToggle={handlePauseToggle}
            onRestart={startNewGame}
            onReset={handleResetToCalibration}
            onEndGame={() => finishGame(false)}
            onAddMosquitoes={handleAddMosquitoes}
            onRemoveMosquitoes={handleRemoveMosquitoes}
            onDifficultyChange={(lvl) => {
              setSettings((prev) => ({ ...prev, difficulty: lvl }));
              setEffectiveDifficulty(lvl);
            }}
            onToggleAutoDifficulty={() =>
              setSettings((prev) => ({ ...prev, autoDifficulty: !prev.autoDifficulty }))
            }
            onToggleMute={() => setSettings((prev) => ({ ...prev, muted: !prev.muted }))}
            onToggleHandPointer={() =>
              setSettings((prev) => ({ ...prev, showHandPointer: !prev.showHandPointer }))
            }
            onFlipCamera={handleFlipCamera}
            onOpenTvCast={() => setTvModalOpen(true)}
            onOpenDownloads={() => {
              setDownloadPlatformFocus(null);
              setDownloadsOpen(true);
            }}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenAccount={() => openAccountModal('profile')}
            onOpenLeaderboard={() => openAccountModal('leaderboard')}
            onToggleFullscreen={() => void handleToggleFullscreen()}
          />

          {/* Full Settings Configuration Drawer */}
          <SettingsDrawer
            open={settingsOpen}
            settings={settings}
            cameras={cameras}
            llmStatus={llmStatus}
            llmModels={llmModels}
            llmStatusMessage={llmStatusMsg}
            backendStatus={backendStatus}
            backendStatusMessage={backendStatusMsg}
            playerDisplayName={playerDisplayName}
            playerUsername={playerUsername}
            isLoggedIn={isLoggedIn}
            onClose={() => setSettingsOpen(false)}
            onOpenTvCast={() => setTvModalOpen(true)}
            onOpenDownloads={() => {
              setDownloadPlatformFocus(null);
              setDownloadsOpen(true);
            }}
            onOpenAccount={() => openAccountModal('profile')}
            onOpenLeaderboard={() => openAccountModal('leaderboard')}
            onChange={setSettings}
            onTestBackend={handleTestBackend}
            onTestLlm={testLlmConnection}
            onTestKillSound={() => soundMgrRef.current.playKillSound(1)}
            onTestMissSound={() => soundMgrRef.current.playMissSound()}
            onResetDefaults={() => setSettings(structuredClone(DEFAULT_SETTINGS))}
          />
        </main>
      )}

      {/* TV Display / Phone Camera Pairing Modal (accessible from all roles) */}
      <TvCastModal
        open={tvModalOpen}
        deviceRole={deviceRole}
        roomCode={roomCode}
        connectionState={companionState}
        transportMode={transportMode}
        companionError={companionError}
        backendConfig={settings.backend}
        onClose={() => setTvModalOpen(false)}
        onSwitchStandalone={handleSwitchStandalone}
        onStartTvMode={handleStartTvMode}
        onRegenerateTvRoom={handleRegenerateTvRoom}
        onJoinAsPhone={handleJoinAsPhone}
        onOpenDownloads={() => {
          setDownloadPlatformFocus(null);
          setDownloadsOpen(true);
        }}
      />

      {/* Android, Apple & Windows Download Hub */}
      <DownloadAppsModal
        open={downloadsOpen}
        initialPlatform={downloadPlatformFocus}
        downloads={settings.downloads}
        onChangeDownloads={(nextDownloads) =>
          setSettings((prev) => ({ ...prev, downloads: nextDownloads }))
        }
        onClose={() => setDownloadsOpen(false)}
      />

      {/* Optional Player Account, Guest Profile & Firebase Cloud Leaderboard Modal */}
      <AccountModal
        open={accountModalOpen}
        initialTab={accountModalTab}
        account={account}
        guestProfile={guestProfile}
        backendConfig={settings.backend}
        authReady={authReady}
        onClose={() => setAccountModalOpen(false)}
        onSignInWithGoogle={handleSignInWithGoogle}
        onSignOut={handleSignOut}
        onUpdateDisplayName={handleUpdateDisplayName}
        onImportGuestToAccount={handleImportGuestToAccount}
        onClearGuestHistory={handleClearGuestHistory}
      />

      {/* Vercel Web Analytics */}
      <Analytics />
    </>
  );
}
