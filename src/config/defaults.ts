import { backendRequest, normalizeEndpointPath } from '../network/BackendApiClient';
import {
  BackendApiConfig,
  CameraResolutionPreset,
  DifficultyLevel,
  DifficultyProfile,
  DownloadLinksConfig,
  GameSettings,
} from '../types/game';

const ENV_BACKEND_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_BACKEND_API_URL === 'string'
    ? import.meta.env.VITE_BACKEND_API_URL.trim()
    : '';

const ENV_ANDROID_DOWNLOAD_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_ANDROID_DOWNLOAD_URL === 'string'
    ? import.meta.env.VITE_ANDROID_DOWNLOAD_URL.trim()
    : '';

const ENV_APPLE_DOWNLOAD_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_APPLE_DOWNLOAD_URL === 'string'
    ? import.meta.env.VITE_APPLE_DOWNLOAD_URL.trim()
    : '';

const ENV_WINDOWS_DOWNLOAD_URL =
  typeof import.meta !== 'undefined' &&
  typeof import.meta.env?.VITE_WINDOWS_DOWNLOAD_URL === 'string'
    ? import.meta.env.VITE_WINDOWS_DOWNLOAD_URL.trim()
    : '';

export const RESOLUTION_MAP: Record<CameraResolutionPreset, { width: number; height: number; label: string }> = {
  '1080p': { width: 1920, height: 1080, label: '1920 × 1080 (Full HD)' },
  '720p': { width: 1280, height: 720, label: '1280 × 720 (HD)' },
  '480p': { width: 640, height: 480, label: '640 × 480 (Performance)' },
};

export const DIFFICULTY_PROFILES: Record<DifficultyLevel, DifficultyProfile> = {
  [DifficultyLevel.EASY]: {
    label: 'Easy',
    summary: 'Slow, lazy mosquitoes with generous hitboxes and steady hovering.',
    speedScale: 0.65,
    hitboxScale: 1.35,
    turnFrequency: 0.55,
    escapeChance: 0.08,
    approachAggression: 0.2,
  },
  [DifficultyLevel.NORMAL]: {
    label: 'Normal',
    summary: 'Balanced flight speed, natural erratic turns, and standard hitboxes.',
    speedScale: 1.0,
    hitboxScale: 1.0,
    turnFrequency: 1.0,
    escapeChance: 0.25,
    approachAggression: 0.45,
  },
  [DifficultyLevel.HARD]: {
    label: 'Hard',
    summary: 'Swift zigzags, smaller hitboxes, and evasive dashes away from hands.',
    speedScale: 1.42,
    hitboxScale: 0.82,
    turnFrequency: 1.5,
    escapeChance: 0.55,
    approachAggression: 0.72,
  },
  [DifficultyLevel.EXTREME]: {
    label: 'Extreme',
    summary: 'Hyper-fast chaotic swarms with dive-bombing runs toward the lens.',
    speedScale: 1.85,
    hitboxScale: 0.68,
    turnFrequency: 2.1,
    escapeChance: 0.82,
    approachAggression: 0.95,
  },
};

export const DEFAULT_BACKEND_CONFIG: BackendApiConfig = {
  enabled: Boolean(ENV_BACKEND_URL),
  baseUrl: ENV_BACKEND_URL,
  wsUrl: '',
  healthPath: '/api/health',
  configPath: '/api/config',
  scoresPath: '/api/scores',
  syncConfig: true,
  syncScores: true,
  routeLlmProxy: true,
  routeTvRelay: true,
  useServerProxy: false,
};

export const DEFAULT_DOWNLOAD_LINKS: DownloadLinksConfig = {
  androidUrl: ENV_ANDROID_DOWNLOAD_URL,
  appleUrl: ENV_APPLE_DOWNLOAD_URL,
  windowsUrl: ENV_WINDOWS_DOWNLOAD_URL,
};

export const DEFAULT_SETTINGS: GameSettings = {
  cameraDeviceId: '',
  cameraFacing: 'user',
  resolution: '1080p',
  mirrorCamera: true,
  showLandmarks: false,
  showHandPointer: false,
  showFaceZones: false,
  enableFaceLanding: true,
  showHitboxes: false,
  practiceMode: false,

  handTrackingSensitivity: 0.65,
  clapProximityThreshold: 0.145,
  clapClosingSpeedThreshold: 0.62,
  slapVelocityThreshold: 1.45,
  hitDetectionRadius: 68,
  attackCooldownMs: 340,

  initialMosquitoCount: 10,
  mosquitoSpeedMultiplier: 1.0,
  difficulty: DifficultyLevel.NORMAL,
  autoDifficulty: false,

  rewards: {
    normalKill: 10,
    doubleKillBonus: 25,
    tripleKillBonus: 50,
    fiveComboBonus: 50,
    tenComboBonus: 100,
  },

  sfxVolume: 0.8,
  buzzVolume: 0.35,
  muted: false,
  enableMissVoice: false,

  llm: {
    enabled: true,
    endpoint: 'http://localhost:1234/v1',
    model: 'local-model',
    apiKey: '',
  },

  backend: { ...DEFAULT_BACKEND_CONFIG },
  downloads: { ...DEFAULT_DOWNLOAD_LINKS },
};

const STORAGE_KEY = 'ai_mosquito_slapper_settings_v1';
const OVERLAY_DEFAULTS_MIGRATION_KEY = 'ai_mosquito_slapper_overlay_defaults_off_v1';

export function loadLocalSettings(): GameSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      window.localStorage.setItem(OVERLAY_DEFAULTS_MIGRATION_KEY, '1');
      return structuredClone(DEFAULT_SETTINGS);
    }
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    const merged = mergeSettings(DEFAULT_SETTINGS, parsed);

    // One-time migration so browsers with old auto-saved defaults start with overlays OFF
    if (!window.localStorage.getItem(OVERLAY_DEFAULTS_MIGRATION_KEY)) {
      merged.showLandmarks = false;
      merged.showHandPointer = false;
      merged.showFaceZones = false;
      window.localStorage.setItem(OVERLAY_DEFAULTS_MIGRATION_KEY, '1');
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    }

    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveLocalSettings(
  settings: GameSettings,
  authToken?: string | null,
): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota errors
  }

  if (!settings.backend.syncConfig) return;

  const configPath = normalizeEndpointPath(settings.backend.configPath, '/api/config');
  void backendRequest(settings.backend, configPath, {
    method: 'POST',
    body: settings,
    timeoutMs: 4000,
    authToken: authToken ?? null,
  });
}

export async function loadServerConfig(
  backend: BackendApiConfig = DEFAULT_BACKEND_CONFIG,
  authToken?: string | null,
): Promise<Partial<GameSettings> | null> {
  if (!backend.syncConfig) return null;
  try {
    const configPath = normalizeEndpointPath(backend.configPath, '/api/config');
    const res = await backendRequest<{ exists?: boolean; config?: Partial<GameSettings> }>(
      backend,
      configPath,
      { method: 'GET', timeoutMs: 3500, authToken: authToken ?? null },
    );
    if (!res.ok || !res.data) return null;
    if (res.data.exists && res.data.config) {
      return res.data.config;
    }
    return null;
  } catch {
    return null;
  }
}

export function mergeSettings(base: GameSettings, partial: Partial<GameSettings>): GameSettings {
  return {
    ...base,
    ...partial,
    rewards: {
      ...base.rewards,
      ...(partial.rewards ?? {}),
    },
    llm: {
      ...base.llm,
      ...(partial.llm ?? {}),
    },
    backend: {
      ...base.backend,
      ...(partial.backend ?? {}),
    },
    downloads: {
      ...base.downloads,
      ...(partial.downloads ?? {}),
    },
  };
}
