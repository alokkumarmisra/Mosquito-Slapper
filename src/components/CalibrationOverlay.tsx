import { useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Download,
  Hand,
  MousePointerClick,
  Play,
  QrCode,
  RefreshCw,
  Settings,
  SwitchCamera,
  Trophy,
  Tv,
  User,
} from 'lucide-react';
import { DIFFICULTY_PROFILES } from '../config/defaults';
import {
  CameraFacingMode,
  CompanionConnectionState,
  DeviceRole,
  DifficultyLevel,
  TrackedHand,
  VisionEngineMode,
} from '../types/game';
import { LlmConnectionStatus } from '../ai/LocalLlmService';
import { PWAInstallButton } from './PWAInstallButton';

const MASCOT_IMAGE = '/src/assets/images/mosquito_arcade_mascot_1794931289859.jpg';

interface CalibrationOverlayProps {
  webcamActive: boolean;
  webcamError: string | null;
  cameraResolutionLabel: string;
  cameraFacing: CameraFacingMode;
  visionMode: VisionEngineMode;
  llmStatus: LlmConnectionStatus;
  practiceMode: boolean;
  hands: TrackedHand[];
  calibrationProgress: number; // 0..100
  difficulty: DifficultyLevel;
  difficultyDescription: string;
  autoDifficulty: boolean;
  initialMosquitoCount: number;
  deviceRole: DeviceRole;
  roomCode: string | null;
  companionState: CompanionConnectionState;
  playerDisplayName: string;
  playerUsername?: string | null;
  isLoggedIn: boolean;
  onDifficultyChange: (level: DifficultyLevel) => void;
  onToggleAutoDifficulty: () => void;
  onStartGame: () => void;
  onRetryCamera: () => void;
  onFlipCamera: () => void;
  onTogglePracticeMode: () => void;
  onOpenTvCast: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenLeaderboard: () => void;
}

const LEVELS: DifficultyLevel[] = [
  DifficultyLevel.EASY,
  DifficultyLevel.NORMAL,
  DifficultyLevel.HARD,
  DifficultyLevel.EXTREME,
];

export function CalibrationOverlay({
  webcamActive,
  webcamError,
  cameraResolutionLabel,
  cameraFacing,
  visionMode,
  llmStatus,
  practiceMode,
  hands,
  calibrationProgress,
  difficulty,
  difficultyDescription,
  autoDifficulty,
  initialMosquitoCount,
  deviceRole,
  roomCode,
  companionState,
  playerDisplayName,
  playerUsername,
  isLoggedIn,
  onDifficultyChange,
  onToggleAutoDifficulty,
  onStartGame,
  onRetryCamera,
  onFlipCamera,
  onTogglePracticeMode,
  onOpenTvCast,
  onOpenDownloads,
  onOpenSettings,
  onOpenAccount,
  onOpenLeaderboard,
}: CalibrationOverlayProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const leftHand = hands.find((h) => h.side === 'Left');
  const rightHand = hands.find((h) => h.side === 'Right');
  const isTvMode = deviceRole === 'TV_DISPLAY';
  const calibrated = calibrationProgress >= 100 || practiceMode;

  return (
    <div className="safe-x absolute inset-0 z-10 flex items-center justify-center overflow-y-auto pt-14 pb-16 sm:pt-20 sm:pb-20 [@media(max-height:520px)]:pt-14 [@media(max-height:520px)]:pb-16">
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-white/12 bg-[#111613]/90 p-3.5 shadow-2xl backdrop-blur-md min-[380px]:p-4 sm:p-7 [@media(max-height:520px)]:p-3.5">
        {/* Top intro lockup */}
        <div className="flex flex-col gap-3 min-[380px]:flex-row min-[380px]:items-center sm:gap-5">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-white/12 bg-[#1B241E] sm:h-20 sm:w-20 [@media(max-height:460px)]:hidden">
            {!imgFailed ? (
              <img
                src={MASCOT_IMAGE}
                alt="AI Mosquito Slapper mascot wearing aviator goggles"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[#C8F542]">
                <Hand className="h-7 w-7 sm:h-8 sm:w-8" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-[clamp(1.15rem,3.4vw,1.875rem)] leading-tight font-extrabold tracking-tight text-[#F4F7F2]">
              {isTvMode ? 'TV Arena Ready · Pair Your Phone' : 'Step In Front of Your Camera'}
            </h1>
            <p className="mt-1 text-xs leading-relaxed text-slate-300 sm:mt-1.5 sm:text-sm">
              {isTvMode
                ? 'Connect your phone camera with the room code below so your phone tracks both hands while the swarm plays on your TV.'
                : 'Clap both hands together or whip a fast single-hand slap to squash mosquitoes flying in 3D space between you and the camera.'}
            </p>
          </div>
        </div>

        {/* Camera / TV Companion Calibration Section */}
        <div className="mt-3.5 border-t border-white/10 pt-3.5 sm:mt-5 sm:pt-5">
          {isTvMode ? (
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-[#C8F542]/30 bg-[#17221B] p-3.5 sm:flex-row sm:items-center sm:gap-4 sm:p-4">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-semibold text-[#C8F542]">TV Display Mode</span>
                  <span className="text-white/25" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-200">
                    {companionState === 'CONNECTED'
                      ? 'Phone Camera Connected'
                      : 'Waiting for phone camera...'}
                  </span>
                </div>
                <div className="flex items-baseline gap-2.5 sm:gap-3">
                  <span className="text-xs text-slate-400">Room Code</span>
                  <span className="font-mono text-2xl font-extrabold tracking-[0.2em] text-[#C8F542] tabular-nums min-[380px]:text-3xl">
                    {roomCode ?? '----'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={onOpenTvCast}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-[#C8F542]/45 bg-[#203024] px-4 text-xs font-bold text-[#C8F542] hover:bg-[#293E2E] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <QrCode className="h-4 w-4" />
                Show QR Code
              </button>
            </div>
          ) : webcamError && !practiceMode ? (
            <div className="rounded-xl border border-[#FB7185]/35 bg-[#2A171B]/90 p-3.5 sm:p-4">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#FDA4AF]">Camera Not Active</p>
                  <p className="mt-0.5 text-xs text-slate-300">{webcamError}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={onRetryCamera}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-white/15 bg-[#1B231E] px-3 text-xs font-medium text-[#F4F7F2] hover:bg-[#27322B] whitespace-nowrap cursor-pointer"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry Camera
                  </button>
                  <button
                    type="button"
                    onClick={onOpenTvCast}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1E2B20] px-3 text-xs font-semibold text-[#C8F542] hover:bg-[#27392A] whitespace-nowrap cursor-pointer"
                  >
                    <Tv className="h-3.5 w-3.5" />
                    Use Phone Camera
                  </button>
                  <button
                    type="button"
                    onClick={onTogglePracticeMode}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-[#C8F542] px-3 text-xs font-bold text-[#0E1310] hover:bg-[#d7fb6a] whitespace-nowrap cursor-pointer"
                  >
                    <MousePointerClick className="h-3.5 w-3.5" />
                    Practice Mode
                  </button>
                </div>
              </div>
            </div>
          ) : practiceMode ? (
            <div className="flex flex-col justify-between gap-3 rounded-xl border border-white/10 bg-[#18201B] p-3.5 sm:flex-row sm:items-center sm:p-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#C8F542]">Practice Pointer Mode Active</p>
                <p className="mt-0.5 text-xs text-slate-300">
                  Swipe quickly across the screen to slap, or tap/click to trigger a two-hand clap
                  zone using the exact same collision engine.
                </p>
              </div>
              <button
                type="button"
                onClick={onTogglePracticeMode}
                className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-[#222C26] px-3 text-xs font-medium text-[#F4F7F2] hover:bg-[#2C3931] whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Camera className="h-3.5 w-3.5" />
                Switch to Camera
              </button>
            </div>
          ) : (
            <div className="space-y-2.5 sm:space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-slate-300">
                  <span className="font-semibold text-[#F4F7F2]">Hand Calibration</span>
                  <span className="text-white/30" aria-hidden="true">·</span>
                  <span className="font-mono text-slate-400">
                    {webcamActive ? cameraResolutionLabel : 'Starting camera...'}
                  </span>
                  <span className="text-white/30 hidden sm:inline" aria-hidden="true">·</span>
                  <span className="hidden text-slate-400 sm:inline">
                    {visionMode === 'INITIALIZING'
                      ? 'Loading MediaPipe...'
                      : visionMode === 'LOCAL_OPTICAL'
                        ? 'Local Optical CV'
                        : 'MediaPipe Hand Landmarker'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onFlipCamera}
                    className="inline-flex h-8 items-center gap-1 rounded-md border border-white/12 bg-[#1A231E] px-2.5 text-[11px] font-semibold text-slate-200 hover:bg-[#243029] whitespace-nowrap cursor-pointer"
                    title="Switch between Front and Rear camera"
                  >
                    <SwitchCamera className="h-3.5 w-3.5 text-[#C8F542]" />
                    {cameraFacing === 'user' ? 'Front Lens' : 'Rear Lens'}
                  </button>
                  <span className="font-mono font-semibold text-[#C8F542] tabular-nums">
                    {calibrated ? 'Calibrated' : `${Math.round(calibrationProgress)}%`}
                  </span>
                </div>
              </div>

              {/* Calibration Progress Track */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#1E2722]">
                <div
                  className="h-full rounded-full bg-[#C8F542] transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${Math.min(1, Math.max(0.03, calibrationProgress / 100))})` }}
                />
              </div>

              {/* Left & Right Hand live readout */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <HandReadout side="Left Hand" hand={leftHand} accent="text-[#38BDF8]" />
                <HandReadout side="Right Hand" hand={rightHand} accent="text-[#C8F542]" />
              </div>

              <p className="text-xs text-slate-400 [@media(max-height:460px)]:hidden">
                Raise one or both hands and move them briefly to confirm tracking, or start anytime.
              </p>
            </div>
          )}
        </div>

        {/* Difficulty & Swarm Setup */}
        <div className="mt-3.5 border-t border-white/10 pt-3.5 sm:mt-5 sm:pt-5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-3">
            <div className="grid w-full grid-cols-3 gap-1 rounded-lg border border-white/10 bg-[#18201B] p-1 min-[440px]:grid-cols-5 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              {LEVELS.map((lvl) => {
                const active = difficulty === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => onDifficultyChange(lvl)}
                    className={`h-9 rounded-md px-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer sm:h-8 sm:px-3 ${
                      active
                        ? 'bg-[#2B3931] text-[#C8F542]'
                        : 'text-slate-400 hover:text-[#F4F7F2]'
                    }`}
                  >
                    {DIFFICULTY_PROFILES[lvl].label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onToggleAutoDifficulty}
                className={`col-span-2 h-9 rounded-md px-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer min-[440px]:col-span-1 sm:h-8 sm:px-3 ${
                  autoDifficulty
                    ? 'bg-[#FF6B35] text-[#0E1310]'
                    : 'text-slate-400 hover:text-[#F4F7F2]'
                }`}
              >
                Auto Scale
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
              <span className="font-mono font-semibold text-[#F4F7F2] tabular-nums">
                {initialMosquitoCount} mosquitoes
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Local LLM:{' '}
                <strong className={llmStatus === 'CONNECTED' ? 'text-[#C8F542]' : 'text-slate-300'}>
                  {llmStatus === 'CONNECTED'
                    ? 'LM Studio Ready'
                    : llmStatus === 'DISABLED'
                      ? 'Disabled'
                      : 'Offline Fallback'}
                </strong>
              </span>
            </div>
          </div>

          <p className="mt-2 text-xs text-slate-300">{difficultyDescription}</p>
        </div>

        {/* Optional Player Identity Strip — Instant Guest Play or Optional Account Sync */}
        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 sm:mt-4 sm:pt-3.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            <User className={`h-3.5 w-3.5 shrink-0 ${isLoggedIn ? 'text-[#C8F542]' : 'text-slate-400'}`} />
            <span className="truncate font-semibold text-[#F4F7F2]">{playerDisplayName}</span>
            <span className="text-white/25" aria-hidden="true">·</span>
            <span className="text-slate-400">
              {isLoggedIn && playerUsername
                ? `@${playerUsername} · Synced`
                : 'Guest Mode · No login required'}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenLeaderboard}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-[#18201B] px-2.5 text-xs font-medium text-slate-200 transition-colors hover:border-[#C8F542]/40 hover:text-[#C8F542] whitespace-nowrap cursor-pointer"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0 text-[#FF6B35]" />
              Leaderboard
            </button>
            <button
              type="button"
              onClick={onOpenAccount}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-[#18201B] px-2.5 text-xs font-semibold text-[#C8F542] transition-colors hover:border-[#C8F542]/45 hover:bg-[#212E24] whitespace-nowrap cursor-pointer"
            >
              {isLoggedIn ? 'Profile' : 'Sign In (Optional)'}
            </button>
          </div>
        </div>

        {/* Primary CTA Row — Start Game prominent on top on mobile, right-aligned on desktop */}
        <div className="mt-4 flex flex-col-reverse gap-2.5 sm:mt-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            <button
              type="button"
              onClick={onOpenTvCast}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1B281E] px-3 text-xs font-bold text-[#C8F542] transition-colors hover:bg-[#243628] whitespace-nowrap cursor-pointer sm:gap-2 sm:px-3.5 sm:text-sm"
            >
              <Tv className="h-4 w-4 shrink-0" />
              {isTvMode ? 'TV Pairing & QR' : 'Play on TV'}
            </button>

            <button
              type="button"
              onClick={onOpenDownloads}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs font-semibold text-[#F4F7F2] transition-colors hover:border-[#C8F542]/40 hover:bg-[#232E28] whitespace-nowrap cursor-pointer sm:gap-2 sm:px-3.5 sm:text-sm"
              title="Download for Android, Apple (iOS/macOS), and Windows"
            >
              <Download className="h-4 w-4 shrink-0 text-[#C8F542]" />
              Download App
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-[#232E28] whitespace-nowrap cursor-pointer sm:gap-2 sm:px-3.5 sm:text-sm"
            >
              <Settings className="h-4 w-4 shrink-0" />
              Settings
            </button>

            <PWAInstallButton />
          </div>

          <button
            type="button"
            onClick={onStartGame}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2.5 rounded-lg bg-[#C8F542] px-6 text-sm font-extrabold text-[#0E1310] transition-transform duration-150 hover:bg-[#d7fb6a] active:scale-95 whitespace-nowrap cursor-pointer sm:w-auto"
          >
            <Play className="h-4 w-4 fill-current" />
            Start Game
          </button>
        </div>
      </div>
    </div>
  );
}

function HandReadout({
  side,
  hand,
  accent,
}: {
  side: string;
  hand: TrackedHand | undefined;
  accent: string;
}) {
  const poseText = !hand
    ? 'Waiting for hand...'
    : hand.pose === 'OPEN_PALM'
      ? 'Detected · Open Palm'
      : hand.pose === 'CLOSED_FIST'
        ? 'Detected · Closed Fist'
        : 'Detected · Tracking';

  return (
    <div className="flex items-center justify-between rounded-lg border border-white/8 bg-[#18201B] px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        {hand ? (
          <CheckCircle2 className={`h-4 w-4 shrink-0 ${accent}`} />
        ) : (
          <Hand className="h-4 w-4 shrink-0 text-slate-500" />
        )}
        <span className="font-medium text-[#F4F7F2]">{side}</span>
      </div>
      <span className={`font-mono text-[11px] ${hand ? accent : 'text-slate-400'}`}>
        {poseText}
      </span>
    </div>
  );
}
