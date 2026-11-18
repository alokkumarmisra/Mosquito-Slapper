import { ChangeEvent, useRef, useState } from 'react';
import { Download, RefreshCw, Server, Trophy, Tv, Upload, User, Volume2, X } from 'lucide-react';
import { DEFAULT_BACKEND_CONFIG, DEFAULT_SETTINGS, RESOLUTION_MAP } from '../config/defaults';
import { resolveCompanionWsUrl } from '../network/BackendApiClient';
import {
  BackendApiConfig,
  BackendConnectionStatus,
  CameraDeviceOption,
  CameraResolutionPreset,
  GameSettings,
} from '../types/game';
import { LlmConnectionStatus } from '../ai/LocalLlmService';

interface SettingsDrawerProps {
  open: boolean;
  settings: GameSettings;
  cameras: CameraDeviceOption[];
  llmStatus: LlmConnectionStatus;
  llmModels: string[];
  llmStatusMessage: string;
  backendStatus: BackendConnectionStatus;
  backendStatusMessage: string;
  playerDisplayName: string;
  playerUsername?: string | null;
  isLoggedIn: boolean;
  onClose: () => void;
  onOpenTvCast: () => void;
  onOpenDownloads: () => void;
  onOpenAccount: () => void;
  onOpenLeaderboard: () => void;
  onChange: (next: GameSettings) => void;
  onTestBackend: () => Promise<void>;
  onTestLlm: () => Promise<void>;
  onTestKillSound: () => void;
  onTestMissSound: () => void;
  onResetDefaults: () => void;
}

export function SettingsDrawer({
  open,
  settings,
  cameras,
  llmStatus,
  llmModels,
  llmStatusMessage,
  backendStatus,
  backendStatusMessage,
  playerDisplayName,
  playerUsername,
  isLoggedIn,
  onClose,
  onOpenTvCast,
  onOpenDownloads,
  onOpenAccount,
  onOpenLeaderboard,
  onChange,
  onTestBackend,
  onTestLlm,
  onTestKillSound,
  onTestMissSound,
  onResetDefaults,
}: SettingsDrawerProps) {
  const [testingLlm, setTestingLlm] = useState(false);
  const [testingBackend, setTestingBackend] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!open) return null;

  const patch = (partial: Partial<GameSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const patchRewards = (key: keyof GameSettings['rewards'], value: number) => {
    onChange({
      ...settings,
      rewards: {
        ...settings.rewards,
        [key]: Math.max(0, Math.round(value)),
      },
    });
  };

  const patchLlm = (partial: Partial<GameSettings['llm']>) => {
    onChange({
      ...settings,
      llm: { ...settings.llm, ...partial },
    });
  };

  const patchBackend = (partial: Partial<BackendApiConfig>) => {
    onChange({
      ...settings,
      backend: { ...settings.backend, ...partial },
    });
  };

  const handleTestBackend = async () => {
    setTestingBackend(true);
    try {
      await onTestBackend();
    } finally {
      setTestingBackend(false);
    }
  };

  const handleTestLlm = async () => {
    setTestingLlm(true);
    try {
      await onTestLlm();
    } finally {
      setTestingLlm(false);
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai-mosquito-slapper-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportJson = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<GameSettings>;
        onChange({
          ...DEFAULT_SETTINGS,
          ...settings,
          ...parsed,
          rewards: { ...settings.rewards, ...(parsed.rewards ?? {}) },
          llm: { ...settings.llm, ...(parsed.llm ?? {}) },
          backend: { ...settings.backend, ...(parsed.backend ?? {}) },
          downloads: { ...settings.downloads, ...(parsed.downloads ?? {}) },
        });
        setImportError(null);
      } catch {
        setImportError('Invalid JSON configuration file.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/55 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="safe-right flex h-full w-full max-w-md flex-col border-l border-white/12 bg-[#121814] text-[#F4F7F2] shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Game Settings"
      >
        {/* Drawer Header */}
        <div className="safe-top flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-[#F4F7F2]">Settings</h2>
            <p className="text-xs text-slate-400">
              Camera, hand tracking, sensitivity, audio, backend API, and local LLM
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-slate-300 hover:bg-[#253029] hover:text-white cursor-pointer"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Settings Sections */}
        <div className="safe-bottom flex-1 space-y-6 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {/* 0. Player Profile & Optional Login */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <User className="h-4 w-4 text-[#C8F542]" />
                <h3 className="text-sm font-bold text-[#C8F542]">Player Profile</h3>
              </div>
              <span className="font-mono text-[11px] text-slate-400">
                {isLoggedIn && playerUsername ? `@${playerUsername}` : 'Guest Mode'}
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-300">
              {isLoggedIn
                ? `Signed in as ${playerDisplayName}. Your settings, match stats, and leaderboard identity sync automatically.`
                : `Playing as ${playerDisplayName} without login. Sign in anytime to sync scores and settings across sessions.`}
            </p>

            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAccount();
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1B281E] px-3 text-xs font-bold text-[#C8F542] hover:bg-[#243628] whitespace-nowrap cursor-pointer"
              >
                <User className="h-4 w-4 shrink-0" />
                {isLoggedIn ? 'Manage Account' : 'Sign In / Guest Name'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenLeaderboard();
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs font-semibold text-[#F4F7F2] hover:border-[#C8F542]/40 hover:bg-[#232E28] whitespace-nowrap cursor-pointer"
              >
                <Trophy className="h-4 w-4 shrink-0 text-[#FF6B35]" />
                Leaderboard
              </button>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 1. Camera & Display */}
          <section className="space-y-3">
            <h3 className="text-sm font-bold text-[#C8F542]">Camera &amp; Vision</h3>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-300">Mobile Camera Lens</span>
              <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      cameraFacing: 'user',
                      cameraDeviceId: '',
                      mirrorCamera: true,
                    })
                  }
                  className={`min-h-[44px] rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                    settings.cameraFacing === 'user'
                      ? 'border-[#C8F542]/50 bg-[#202C22] text-[#C8F542]'
                      : 'border-white/10 bg-[#1A221D] text-slate-300 hover:text-white'
                  }`}
                >
                  Front Camera (Selfie)
                </button>
                <button
                  type="button"
                  onClick={() =>
                    patch({
                      cameraFacing: 'environment',
                      cameraDeviceId: '',
                      mirrorCamera: false,
                    })
                  }
                  className={`min-h-[44px] rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
                    settings.cameraFacing === 'environment'
                      ? 'border-[#C8F542]/50 bg-[#202C22] text-[#C8F542]'
                      : 'border-white/10 bg-[#1A221D] text-slate-300 hover:text-white'
                  }`}
                >
                  Rear Camera (Wide)
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="camera-select" className="block text-xs font-medium text-slate-300">
                Specific Camera Device
              </label>
              <select
                id="camera-select"
                value={settings.cameraDeviceId}
                onChange={(e) => patch({ cameraDeviceId: e.target.value })}
                className="h-10 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              >
                <option value="">Auto (Follow Front / Rear Lens)</option>
                {cameras.map((cam) => (
                  <option key={cam.deviceId} value={cam.deviceId}>
                    {cam.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenTvCast();
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-[#C8F542]/40 bg-[#1B281E] px-3 text-xs font-bold text-[#C8F542] hover:bg-[#243628] cursor-pointer"
              >
                <Tv className="h-4 w-4" />
                Pair Phone Camera with TV Display
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenDownloads();
                }}
                className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs font-semibold text-[#F4F7F2] hover:border-[#C8F542]/40 hover:bg-[#232E28] cursor-pointer"
              >
                <Download className="h-4 w-4 text-[#C8F542]" />
                Download for Android, Apple &amp; Windows
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="res-select" className="block text-xs font-medium text-slate-300">
                Camera Resolution
              </label>
              <select
                id="res-select"
                value={settings.resolution}
                onChange={(e) => patch({ resolution: e.target.value as CameraResolutionPreset })}
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              >
                {(Object.keys(RESOLUTION_MAP) as CameraResolutionPreset[]).map((key) => (
                  <option key={key} value={key}>
                    {RESOLUTION_MAP[key].label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 gap-2 pt-1 min-[380px]:grid-cols-2">
              <ToggleRow
                label="Face Landing"
                checked={settings.enableFaceLanding}
                onToggle={() => patch({ enableFaceLanding: !settings.enableFaceLanding })}
              />
              <ToggleRow
                label="Face Zone Markers"
                checked={settings.showFaceZones}
                onToggle={() => patch({ showFaceZones: !settings.showFaceZones })}
              />
              <ToggleRow
                label="Hand Pointer Symbol"
                checked={settings.showHandPointer}
                onToggle={() => patch({ showHandPointer: !settings.showHandPointer })}
              />
              <ToggleRow
                label="Hand Landmarks"
                checked={settings.showLandmarks}
                onToggle={() => patch({ showLandmarks: !settings.showLandmarks })}
              />
              <ToggleRow
                label="Mirror Camera"
                checked={settings.mirrorCamera}
                onToggle={() => patch({ mirrorCamera: !settings.mirrorCamera })}
              />
              <ToggleRow
                label="Show Hitboxes"
                checked={settings.showHitboxes}
                onToggle={() => patch({ showHitboxes: !settings.showHitboxes })}
              />
              <ToggleRow
                label="Practice Pointer"
                checked={settings.practiceMode}
                onToggle={() => patch({ practiceMode: !settings.practiceMode })}
              />
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 2. Gesture & Hit Sensitivity */}
          <section className="space-y-3.5">
            <h3 className="text-sm font-bold text-[#C8F542]">Gesture & Collision Tuning</h3>

            <SliderField
              label="Hand Tracking Sensitivity"
              value={settings.handTrackingSensitivity}
              min={0.25}
              max={0.9}
              step={0.05}
              display={`${Math.round(settings.handTrackingSensitivity * 100)}%`}
              onChange={(v) => patch({ handTrackingSensitivity: v })}
            />

            <SliderField
              label="Clap Proximity Threshold"
              value={settings.clapProximityThreshold}
              min={0.07}
              max={0.24}
              step={0.005}
              display={`${Math.round(settings.clapProximityThreshold * 100)}% width`}
              onChange={(v) => patch({ clapProximityThreshold: v })}
            />

            <SliderField
              label="Clap Closing Velocity"
              value={settings.clapClosingSpeedThreshold}
              min={0.3}
              max={1.6}
              step={0.05}
              display={`${settings.clapClosingSpeedThreshold.toFixed(2)}/s`}
              onChange={(v) => patch({ clapClosingSpeedThreshold: v })}
            />

            <SliderField
              label="Single-Hand Slap Sensitivity (Min Speed)"
              value={settings.slapVelocityThreshold}
              min={0.7}
              max={3.0}
              step={0.05}
              display={`${settings.slapVelocityThreshold.toFixed(2)}/s`}
              onChange={(v) => patch({ slapVelocityThreshold: v })}
            />

            <SliderField
              label="Hit Detection Radius"
              value={settings.hitDetectionRadius}
              min={32}
              max={130}
              step={2}
              display={`${settings.hitDetectionRadius} px`}
              onChange={(v) => patch({ hitDetectionRadius: v })}
            />

            <SliderField
              label="Attack Cooldown"
              value={settings.attackCooldownMs}
              min={180}
              max={800}
              step={20}
              display={`${settings.attackCooldownMs} ms`}
              onChange={(v) => patch({ attackCooldownMs: v })}
            />
          </section>

          <hr className="border-white/10" />

          {/* 3. Mosquito Swarm & Rewards */}
          <section className="space-y-3.5">
            <h3 className="text-sm font-bold text-[#C8F542]">Swarm & Reward Points</h3>

            <SliderField
              label="Starting Mosquito Count"
              value={settings.initialMosquitoCount}
              min={1}
              max={50}
              step={1}
              display={`${settings.initialMosquitoCount}`}
              onChange={(v) => patch({ initialMosquitoCount: Math.round(v) })}
            />

            <SliderField
              label="Mosquito Flight Speed"
              value={settings.mosquitoSpeedMultiplier}
              min={0.5}
              max={2.0}
              step={0.05}
              display={`${settings.mosquitoSpeedMultiplier.toFixed(2)}x`}
              onChange={(v) => patch({ mosquitoSpeedMultiplier: v })}
            />

            <div className="grid grid-cols-1 gap-2.5 pt-1 min-[360px]:grid-cols-2">
              <NumberField
                label="Normal Kill"
                value={settings.rewards.normalKill}
                onChange={(v) => patchRewards('normalKill', v)}
              />
              <NumberField
                label="Double Kill Bonus"
                value={settings.rewards.doubleKillBonus}
                onChange={(v) => patchRewards('doubleKillBonus', v)}
              />
              <NumberField
                label="Triple Kill Bonus"
                value={settings.rewards.tripleKillBonus}
                onChange={(v) => patchRewards('tripleKillBonus', v)}
              />
              <NumberField
                label="5x Combo Bonus"
                value={settings.rewards.fiveComboBonus}
                onChange={(v) => patchRewards('fiveComboBonus', v)}
              />
              <NumberField
                label="10x Combo Bonus"
                value={settings.rewards.tenComboBonus}
                onChange={(v) => patchRewards('tenComboBonus', v)}
              />
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 4. Audio */}
          <section className="space-y-3.5">
            <h3 className="text-sm font-bold text-[#C8F542]">Audio</h3>

            <SliderField
              label="Sound Effects Volume"
              value={settings.sfxVolume}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(settings.sfxVolume * 100)}%`}
              onChange={(v) => patch({ sfxVolume: v })}
            />

            <SliderField
              label="Mosquito Buzzing Volume"
              value={settings.buzzVolume}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(settings.buzzVolume * 100)}%`}
              onChange={(v) => patch({ buzzVolume: v })}
            />
            <p className="text-[11px] leading-relaxed text-slate-400">
              Spatial stereo buzz scales with live mosquito count and intensifies sharply when a
              mosquito approaches your ears or face.
            </p>

            <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <ToggleRow
                label="Mute All"
                checked={settings.muted}
                onToggle={() => patch({ muted: !settings.muted })}
              />
              <ToggleRow
                label="Missed Voice Line"
                checked={settings.enableMissVoice}
                onToggle={() => patch({ enableMissVoice: !settings.enableMissVoice })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onTestKillSound}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-white/12 bg-[#1B231E] px-3 text-xs font-medium text-[#C8F542] hover:bg-[#253029] whitespace-nowrap cursor-pointer"
              >
                <Volume2 className="h-3.5 w-3.5 shrink-0" />
                Test Kill Sound
              </button>
              <button
                type="button"
                onClick={onTestMissSound}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-white/12 bg-[#1B231E] px-3 text-xs font-medium text-[#FF8A5C] hover:bg-[#253029] whitespace-nowrap cursor-pointer"
              >
                <Volume2 className="h-3.5 w-3.5 shrink-0" />
                Test Miss Sound
              </button>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 5. Backend API Configuration */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Server className="h-4 w-4 text-[#C8F542]" />
                <h3 className="text-sm font-bold text-[#C8F542]">Backend API</h3>
              </div>
              <span
                className={`font-mono text-[11px] font-medium ${
                  backendStatus === 'CONNECTED'
                    ? 'text-[#C8F542]'
                    : backendStatus === 'ERROR'
                      ? 'text-[#FDA4AF]'
                      : 'text-slate-400'
                }`}
              >
                {backendStatus === 'CONNECTED'
                  ? 'Connected'
                  : backendStatus === 'ERROR'
                    ? 'Unreachable'
                    : backendStatus === 'TESTING'
                      ? 'Testing...'
                      : 'Built-in Server'}
              </span>
            </div>

            <ToggleRow
              label="Use Custom Backend API Server"
              checked={settings.backend.enabled}
              onToggle={() => patchBackend({ enabled: !settings.backend.enabled })}
            />

            <div className="space-y-1.5">
              <label htmlFor="backend-base-url" className="block text-xs font-medium text-slate-300">
                Backend API Base URL
              </label>
              <input
                id="backend-base-url"
                type="url"
                value={settings.backend.baseUrl}
                onChange={(e) => patchBackend({ baseUrl: e.target.value })}
                placeholder="https://api.example.com or http://192.168.1.50:3000"
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="backend-ws-url" className="block text-xs font-medium text-slate-300">
                WebSocket URL Override (Optional for TV Pairing)
              </label>
              <input
                id="backend-ws-url"
                type="text"
                value={settings.backend.wsUrl}
                onChange={(e) => patchBackend({ wsUrl: e.target.value })}
                placeholder="Auto-derived as wss://<host>/ws"
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              />
              <p className="truncate font-mono text-[10px] text-slate-400">
                Active WS: {resolveCompanionWsUrl(settings.backend)}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-2 min-[380px]:grid-cols-3">
              <div className="space-y-1">
                <label htmlFor="backend-health-path" className="block text-[11px] font-medium text-slate-400">
                  Health Path
                </label>
                <input
                  id="backend-health-path"
                  type="text"
                  value={settings.backend.healthPath}
                  onChange={(e) => patchBackend({ healthPath: e.target.value })}
                  placeholder="/api/health"
                  className="h-9 w-full rounded-md border border-white/12 bg-[#1A221D] px-2 font-mono text-[11px] text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="backend-config-path" className="block text-[11px] font-medium text-slate-400">
                  Config Path
                </label>
                <input
                  id="backend-config-path"
                  type="text"
                  value={settings.backend.configPath}
                  onChange={(e) => patchBackend({ configPath: e.target.value })}
                  placeholder="/api/config"
                  className="h-9 w-full rounded-md border border-white/12 bg-[#1A221D] px-2 font-mono text-[11px] text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="backend-scores-path" className="block text-[11px] font-medium text-slate-400">
                  Scores Path
                </label>
                <input
                  id="backend-scores-path"
                  type="text"
                  value={settings.backend.scoresPath}
                  onChange={(e) => patchBackend({ scoresPath: e.target.value })}
                  placeholder="/api/scores"
                  className="h-9 w-full rounded-md border border-white/12 bg-[#1A221D] px-2 font-mono text-[11px] text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 pt-0.5 min-[380px]:grid-cols-2">
              <ToggleRow
                label="Sync Settings"
                checked={settings.backend.syncConfig}
                onToggle={() => patchBackend({ syncConfig: !settings.backend.syncConfig })}
              />
              <ToggleRow
                label="Sync Match Scores"
                checked={settings.backend.syncScores}
                onToggle={() => patchBackend({ syncScores: !settings.backend.syncScores })}
              />
              <ToggleRow
                label="Route LLM Proxy"
                checked={settings.backend.routeLlmProxy}
                onToggle={() => patchBackend({ routeLlmProxy: !settings.backend.routeLlmProxy })}
              />
              <ToggleRow
                label="TV / Phone WS Relay"
                checked={settings.backend.routeTvRelay}
                onToggle={() => patchBackend({ routeTvRelay: !settings.backend.routeTvRelay })}
              />
            </div>

            <ToggleRow
              label="Route Through Local CORS Proxy"
              checked={settings.backend.useServerProxy}
              onToggle={() => patchBackend({ useServerProxy: !settings.backend.useServerProxy })}
            />

            <p className="text-[11px] leading-relaxed text-slate-400">
              Enable Local CORS Proxy if your custom backend blocks browser cross-origin calls or
              requires a server-side Bearer token (configured via <code className="font-mono text-slate-300">BACKEND_API_TOKEN</code> in server env).
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleTestBackend()}
                  disabled={testingBackend}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#212D23] px-3.5 text-xs font-semibold text-[#C8F542] hover:bg-[#2A3B2C] disabled:opacity-60 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testingBackend ? 'animate-spin' : ''}`} />
                  {testingBackend ? 'Testing...' : 'Test Backend API'}
                </button>
                {settings.backend.enabled && (
                  <button
                    type="button"
                    onClick={() =>
                      patchBackend({
                        ...DEFAULT_BACKEND_CONFIG,
                        enabled: false,
                        baseUrl: '',
                        wsUrl: '',
                      })
                    }
                    className="inline-flex h-9 items-center rounded-lg border border-white/12 bg-[#1B231E] px-3 text-xs font-medium text-slate-300 hover:bg-[#253029] hover:text-white whitespace-nowrap cursor-pointer"
                  >
                    Use Built-in
                  </button>
                )}
              </div>
              <span className="text-[11px] text-slate-400">{backendStatusMessage}</span>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 6. Local LLM (LM Studio) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#C8F542]">Local LLM (LM Studio)</h3>
              <span className="font-mono text-[11px] text-slate-400">
                {llmStatus === 'CONNECTED'
                  ? 'Connected'
                  : llmStatus === 'DISABLED'
                    ? 'Disabled'
                    : 'Offline Mode'}
              </span>
            </div>

            <ToggleRow
              label="Enable Local LLM Commentary & Dialogue"
              checked={settings.llm.enabled}
              onToggle={() => patchLlm({ enabled: !settings.llm.enabled })}
            />

            <div className="space-y-1.5">
              <label htmlFor="llm-endpoint" className="block text-xs font-medium text-slate-300">
                OpenAI-Compatible Endpoint
              </label>
              <input
                id="llm-endpoint"
                type="text"
                value={settings.llm.endpoint}
                onChange={(e) => patchLlm({ endpoint: e.target.value })}
                placeholder="http://localhost:1234/v1"
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="llm-model" className="block text-xs font-medium text-slate-300">
                Model Name
              </label>
              <input
                id="llm-model"
                type="text"
                value={settings.llm.model}
                onChange={(e) => patchLlm({ model: e.target.value })}
                placeholder="local-model"
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              />
              {llmModels.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {llmModels.slice(0, 6).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => patchLlm({ model: m })}
                      className={`rounded-md border px-2 py-1 font-mono text-[11px] cursor-pointer ${
                        settings.llm.model === m
                          ? 'border-[#C8F542] bg-[#253328] text-[#C8F542]'
                          : 'border-white/10 bg-[#1B231E] text-slate-300 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="llm-apikey" className="block text-xs font-medium text-slate-300">
                Optional Local Token (Leave blank for default LM Studio)
              </label>
              <input
                id="llm-apikey"
                type="password"
                value={settings.llm.apiKey}
                onChange={(e) => patchLlm({ apiKey: e.target.value })}
                placeholder="lm-studio"
                className="h-9 w-full rounded-lg border border-white/12 bg-[#1A221D] px-3 font-mono text-xs text-[#F4F7F2] outline-none focus:border-[#C8F542]"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={handleTestLlm}
                disabled={testingLlm}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#212D23] px-3.5 text-xs font-semibold text-[#C8F542] hover:bg-[#2A3B2C] disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${testingLlm ? 'animate-spin' : ''}`} />
                {testingLlm ? 'Testing...' : 'Test LM Studio'}
              </button>
              <span className="truncate text-[11px] text-slate-400">{llmStatusMessage}</span>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* 6. Local JSON Config */}
          <section className="space-y-2.5 pb-4">
            <h3 className="text-sm font-bold text-[#C8F542]">Configuration File</h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleExportJson}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/12 bg-[#1B231E] px-3 text-xs font-medium text-slate-200 hover:bg-[#253029] cursor-pointer"
              >
                <Download className="h-3.5 w-3.5" />
                Export JSON
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/12 bg-[#1B231E] px-3 text-xs font-medium text-slate-200 hover:bg-[#253029] cursor-pointer"
              >
                <Upload className="h-3.5 w-3.5" />
                Import JSON
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                onChange={handleImportJson}
                className="hidden"
              />
              <button
                type="button"
                onClick={onResetDefaults}
                className="inline-flex h-8 items-center rounded-md border border-[#FB7185]/30 bg-[#27181B] px-3 text-xs font-medium text-[#FDA4AF] hover:bg-[#351F24] cursor-pointer"
              >
                Restore Defaults
              </button>
            </div>
            {importError && <p className="text-xs text-[#FDA4AF]">{importError}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono font-semibold text-[#C8F542] tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="arcade-slider w-full"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (val: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-[11px] font-medium text-slate-400">{label}</label>
      <input
        type="number"
        min={0}
        max={1000}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value || '0', 10))}
        className="h-8 w-full rounded-md border border-white/12 bg-[#1A221D] px-2.5 font-mono text-xs text-[#F4F7F2] tabular-nums outline-none focus:border-[#C8F542]"
      />
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      role="switch"
      aria-checked={checked}
      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
        checked
          ? 'border-[#C8F542]/45 bg-[#202C22] text-[#F4F7F2]'
          : 'border-white/10 bg-[#1A221D] text-slate-400 hover:text-slate-200'
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`shrink-0 font-mono text-[10px] font-bold ${checked ? 'text-[#C8F542]' : 'text-slate-500'}`}>
        {checked ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
