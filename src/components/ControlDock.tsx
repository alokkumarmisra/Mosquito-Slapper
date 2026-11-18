import { useState } from 'react';
import {
  Crosshair,
  Download,
  Flag,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  SwitchCamera,
  Trophy,
  Tv,
  User,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { CameraFacingMode, DeviceRole, DifficultyLevel, GamePhase } from '../types/game';
import { PWAInstallButton } from './PWAInstallButton';

interface ControlDockProps {
  phase: GamePhase;
  difficulty: DifficultyLevel;
  autoDifficulty: boolean;
  muted: boolean;
  showHandPointer: boolean;
  isFullscreen: boolean;
  livingCount: number;
  totalBites: number;
  activeBiteMarks: number;
  cameraFacing: CameraFacingMode;
  deviceRole: DeviceRole;
  roomCode: string | null;
  companionConnected: boolean;
  playerDisplayName: string;
  isLoggedIn: boolean;
  onStart: () => void;
  onPauseToggle: () => void;
  onRestart: () => void;
  onReset: () => void;
  onEndGame: () => void;
  onAddMosquitoes: (count: number) => void;
  onRemoveMosquitoes: (count: number) => void;
  onDifficultyChange: (level: DifficultyLevel) => void;
  onToggleAutoDifficulty: () => void;
  onToggleMute: () => void;
  onToggleHandPointer: () => void;
  onFlipCamera: () => void;
  onOpenBiteHistory: () => void;
  onOpenTvCast: () => void;
  onOpenDownloads: () => void;
  onOpenSettings: () => void;
  onOpenAccount: () => void;
  onOpenLeaderboard: () => void;
  onToggleFullscreen: () => void;
}

const DIFFICULTIES: Array<{ value: DifficultyLevel; label: string }> = [
  { value: DifficultyLevel.EASY, label: 'Easy' },
  { value: DifficultyLevel.NORMAL, label: 'Normal' },
  { value: DifficultyLevel.HARD, label: 'Hard' },
  { value: DifficultyLevel.EXTREME, label: 'Extreme' },
];

export function ControlDock({
  phase,
  difficulty,
  autoDifficulty,
  muted,
  showHandPointer,
  isFullscreen,
  livingCount,
  totalBites,
  activeBiteMarks,
  cameraFacing,
  deviceRole,
  roomCode,
  companionConnected,
  playerDisplayName,
  isLoggedIn,
  onStart,
  onPauseToggle,
  onRestart,
  onReset,
  onEndGame,
  onAddMosquitoes,
  onRemoveMosquitoes,
  onDifficultyChange,
  onToggleAutoDifficulty,
  onToggleMute,
  onToggleHandPointer,
  onFlipCamera,
  onOpenBiteHistory,
  onOpenTvCast,
  onOpenDownloads,
  onOpenSettings,
  onOpenAccount,
  onOpenLeaderboard,
  onToggleFullscreen,
}: ControlDockProps) {
  const [customCount, setCustomCount] = useState('15');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);

  const handleAddCustom = () => {
    const parsed = parseInt(customCount, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      onAddMosquitoes(Math.min(100, parsed));
      setShowCustomInput(false);
    }
  };

  const tvLabel =
    deviceRole === 'TV_DISPLAY' && roomCode
      ? companionConnected
        ? `TV · ${roomCode}`
        : `Pair · ${roomCode}`
      : 'Play on TV';

  return (
    <>
      <footer className="safe-bottom safe-x pointer-events-none absolute inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[2200px]">
        {/* Compact Thumb-Zone Bar (< 1024px OR short landscape <= 520px height) — >= 44px touch targets */}
        <div className="short-landscape-show pointer-events-auto flex items-center justify-between gap-1.5 rounded-xl border border-white/10 bg-[#111613]/88 p-1.5 backdrop-blur-md min-[380px]:gap-2 lg:hidden">
          {phase === GamePhase.CALIBRATION || phase === GamePhase.GAME_OVER ? (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#C8F542] px-3 text-xs font-extrabold text-[#0E1310] active:scale-95 whitespace-nowrap cursor-pointer min-[380px]:gap-2 min-[380px]:px-4"
            >
              <Play className="h-4 w-4 shrink-0 fill-current" />
              <span>Start</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPauseToggle}
              className="inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#C8F542] px-3 text-xs font-extrabold text-[#0E1310] active:scale-95 whitespace-nowrap cursor-pointer min-[380px]:gap-2 min-[380px]:px-4"
            >
              {phase === GamePhase.PAUSED ? (
                <>
                  <Play className="h-4 w-4 shrink-0 fill-current" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4 shrink-0" />
                  <span>Pause</span>
                </>
              )}
            </button>
          )}

          {deviceRole === 'STANDALONE' && (
            <button
              type="button"
              onClick={onFlipCamera}
              className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-semibold text-[#F4F7F2] whitespace-nowrap shrink-0 cursor-pointer min-[380px]:px-3"
              aria-label="Flip between front and rear camera"
              title={cameraFacing === 'user' ? 'Switch to Rear Camera' : 'Switch to Front Camera'}
            >
              <SwitchCamera className="h-4 w-4 text-[#C8F542]" />
              <span className="hidden min-[380px]:inline">
                {cameraFacing === 'user' ? 'Rear' : 'Front'}
              </span>
            </button>
          )}

          {/* Extra one-tap tablet & wide landscape controls (>= 640px) */}
          <button
            type="button"
            onClick={onToggleHandPointer}
            aria-pressed={showHandPointer}
            className={`hidden h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer sm:inline-flex ${
              showHandPointer
                ? 'border-[#C8F542]/40 bg-[#202C22] text-[#C8F542]'
                : 'border-white/12 bg-[#1B231E] text-slate-300'
            }`}
            title={showHandPointer ? 'Hide hand pointer' : 'Show hand pointer'}
            aria-label={showHandPointer ? 'Hide hand pointer' : 'Show hand pointer'}
          >
            <Crosshair className="h-4 w-4" />
            <span className="hidden md:inline">{showHandPointer ? 'Pointer' : 'No Pointer'}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            className="hidden h-11 w-11 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-200 shrink-0 cursor-pointer sm:inline-flex"
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
            title={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted ? <VolumeX className="h-4 w-4 text-[#FB7185]" /> : <Volume2 className="h-4 w-4 text-[#C8F542]" />}
          </button>

          <button
            type="button"
            onClick={onOpenTvCast}
            className={`inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer min-[380px]:px-3 ${
              deviceRole === 'TV_DISPLAY'
                ? 'border-[#C8F542]/50 bg-[#202D22] text-[#C8F542]'
                : 'border-white/12 bg-[#1B231E] text-[#F4F7F2]'
            }`}
            aria-label="Play on TV setup"
            title="Pair phone camera with TV"
          >
            <Tv className="h-4 w-4" />
            <span className={deviceRole === 'TV_DISPLAY' && roomCode ? 'inline' : 'hidden min-[380px]:inline'}>
              {deviceRole === 'TV_DISPLAY' && roomCode ? roomCode : 'TV'}
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            className="hidden h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-3 text-xs font-semibold text-[#F4F7F2] whitespace-nowrap shrink-0 cursor-pointer sm:inline-flex"
            aria-label="Open settings"
            title="Settings"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden md:inline">Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileSheetOpen(true)}
            className="inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-semibold text-[#F4F7F2] whitespace-nowrap shrink-0 cursor-pointer min-[380px]:px-3"
            aria-label="Open swarm, difficulty, and game controls"
            title="Game Controls"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span className="hidden min-[380px]:inline">Controls</span>
          </button>
        </div>

        {/* Full Desktop & TV Control Dock (>= 1024px and height > 520px) */}
        <div className="short-landscape-hide pointer-events-auto hidden flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#111613]/86 px-3 py-2 backdrop-blur-md lg:flex xl:gap-3 xl:px-3.5 xl:py-2.5">
          {/* Left: Core Game State Controls */}
          <div className="flex flex-wrap items-center gap-1.5 xl:gap-2">
            {phase === GamePhase.CALIBRATION || phase === GamePhase.GAME_OVER ? (
              <button
                type="button"
                onClick={onStart}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#C8F542] px-3.5 text-xs font-bold text-[#0E1310] transition-transform duration-150 hover:bg-[#d7fb6a] active:scale-95 whitespace-nowrap shrink-0 cursor-pointer xl:px-4"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                Start Game
              </button>
            ) : (
              <button
                type="button"
                onClick={onPauseToggle}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#C8F542] px-3.5 text-xs font-bold text-[#0E1310] transition-transform duration-150 hover:bg-[#d7fb6a] active:scale-95 whitespace-nowrap shrink-0 cursor-pointer xl:px-4"
              >
                {phase === GamePhase.PAUSED ? (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Resume
                  </>
                ) : (
                  <>
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onRestart}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-medium text-[#F4F7F2] transition-colors hover:bg-[#253029] whitespace-nowrap shrink-0 cursor-pointer xl:px-3"
              title="Restart game immediately with fresh mosquitoes"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Restart</span>
            </button>

            <button
              type="button"
              onClick={onReset}
              className="inline-flex h-9 items-center rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-medium text-slate-200 transition-colors hover:bg-[#253029] whitespace-nowrap shrink-0 cursor-pointer xl:px-3"
              title="Reset score and return to calibration"
            >
              Reset
            </button>

            {(phase === GamePhase.PLAYING || phase === GamePhase.PAUSED) && (
              <button
                type="button"
                onClick={onEndGame}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#FF6B35]/35 bg-[#FF6B35]/15 px-2.5 text-xs font-semibold text-[#FF8A5C] transition-colors hover:bg-[#FF6B35]/25 whitespace-nowrap shrink-0 cursor-pointer xl:px-3"
              >
                <Flag className="h-3.5 w-3.5" />
                End Game
              </button>
            )}
          </div>

          {/* Center: Add / Remove Mosquitoes */}
          <div className="flex flex-wrap items-center gap-1 xl:gap-1.5">
            <span className="mr-1 hidden text-[11px] font-medium text-slate-400 whitespace-nowrap 2xl:inline">
              Mosquitoes:
            </span>
            {[1, 5, 10, 20].map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => onAddMosquitoes(amt)}
                className={`${
                  amt === 20 ? 'hidden xl:inline-flex' : 'inline-flex'
                } h-8 items-center gap-0.5 rounded-md border border-white/10 bg-[#1C2520] px-2 font-mono text-xs font-semibold text-[#C8F542] tabular-nums transition-colors hover:border-[#C8F542]/40 hover:bg-[#243029] whitespace-nowrap shrink-0 cursor-pointer xl:px-2.5`}
              >
                <Plus className="h-3 w-3" />
                {amt}
              </button>
            ))}

            {showCustomInput ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={customCount}
                  onChange={(e) => setCustomCount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleAddCustom();
                  }}
                  aria-label="Custom mosquito count"
                  className="h-8 w-14 rounded-md border border-[#C8F542]/50 bg-[#0E1310] px-2 font-mono text-xs text-[#F4F7F2] tabular-nums outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddCustom}
                  className="h-8 rounded-md bg-[#C8F542] px-2.5 text-xs font-bold text-[#0E1310] hover:bg-[#d7fb6a] whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Add
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowCustomInput(true)}
                className="inline-flex h-8 items-center rounded-md border border-white/10 bg-[#1C2520] px-2 text-xs font-medium text-slate-200 transition-colors hover:bg-[#243029] whitespace-nowrap shrink-0 cursor-pointer xl:px-2.5"
              >
                Custom
              </button>
            )}

            <span className="mx-0.5 text-white/20" aria-hidden="true">|</span>

            <button
              type="button"
              onClick={() => onRemoveMosquitoes(1)}
              disabled={livingCount <= 0}
              className="inline-flex h-8 items-center gap-0.5 rounded-md border border-white/10 bg-[#1C2520] px-2 font-mono text-xs font-medium text-slate-300 transition-colors hover:bg-[#2A2022] hover:text-[#FB7185] disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              title="Remove 1 mosquito"
            >
              <Minus className="h-3 w-3" />
              1
            </button>
            <button
              type="button"
              onClick={() => onRemoveMosquitoes(5)}
              disabled={livingCount <= 0}
              className="inline-flex h-8 items-center gap-0.5 rounded-md border border-white/10 bg-[#1C2520] px-2 font-mono text-xs font-medium text-slate-300 transition-colors hover:bg-[#2A2022] hover:text-[#FB7185] disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              title="Remove 5 mosquitoes"
            >
              <Minus className="h-3 w-3" />
              5
            </button>
          </div>

          {/* Right: Difficulty Selector + TV Cast, Pointer, Audio, Settings & Fullscreen */}
          <div className="flex flex-wrap items-center gap-1.5 xl:gap-2">
            <div className="flex items-center rounded-lg border border-white/10 bg-[#161D19] p-0.5">
              {DIFFICULTIES.map((d) => {
                const active = difficulty === d.value;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => onDifficultyChange(d.value)}
                    className={`h-7 rounded-md px-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer xl:px-2.5 ${
                      active
                        ? 'bg-[#28352D] text-[#C8F542]'
                        : 'text-slate-400 hover:text-[#F4F7F2]'
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={onToggleAutoDifficulty}
                className={`ml-0.5 h-7 rounded-md px-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer xl:px-2.5 ${
                  autoDifficulty
                    ? 'bg-[#FF6B35] text-[#0E1310]'
                    : 'text-slate-400 hover:text-[#F4F7F2]'
                }`}
                title="Automatically scale difficulty based on your performance"
              >
                Auto
              </button>
            </div>

            <button
              type="button"
              onClick={onOpenTvCast}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer xl:px-3 ${
                deviceRole === 'TV_DISPLAY'
                  ? 'border-[#C8F542]/50 bg-[#202D22] text-[#C8F542]'
                  : 'border-white/12 bg-[#1B231E] text-[#F4F7F2] hover:bg-[#253029]'
              }`}
              title="Pair phone camera with a Smart TV or big screen"
            >
              <Tv className="h-3.5 w-3.5" />
              <span>{tvLabel}</span>
            </button>

            <button
              type="button"
              onClick={onOpenDownloads}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-2.5 text-xs font-semibold text-[#F4F7F2] transition-colors hover:border-[#C8F542]/40 hover:bg-[#253029] whitespace-nowrap shrink-0 cursor-pointer xl:px-3"
              title="Download for Android, Apple, and Windows"
              aria-label="Download for Android, Apple, and Windows"
            >
              <Download className="h-3.5 w-3.5 text-[#C8F542]" />
              <span className="hidden xl:inline">Get App</span>
            </button>

            <PWAInstallButton compact />

            <button
              type="button"
              onClick={onToggleHandPointer}
              aria-pressed={showHandPointer}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer xl:px-3 ${
                showHandPointer
                  ? 'border-[#C8F542]/40 bg-[#202C22] text-[#C8F542]'
                  : 'border-white/10 bg-[#1B231E] text-slate-400 hover:bg-[#253029] hover:text-[#F4F7F2]'
              }`}
              title={showHandPointer ? 'Hide hand tracker pointer symbol' : 'Show hand tracker pointer symbol'}
              aria-label={showHandPointer ? 'Hide hand tracker pointer symbol' : 'Show hand tracker pointer symbol'}
            >
              <Crosshair className="h-3.5 w-3.5" />
              <span className="hidden 2xl:inline">
                {showHandPointer ? 'Pointer On' : 'Pointer Off'}
              </span>
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-slate-200 transition-colors hover:bg-[#253029] shrink-0 cursor-pointer"
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              title={muted ? 'Unmute audio' : 'Mute audio'}
            >
              {muted ? <VolumeX className="h-4 w-4 text-[#FB7185]" /> : <Volume2 className="h-4 w-4 text-[#C8F542]" />}
            </button>

            <button
              type="button"
              onClick={onOpenBiteHistory}
              className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeBiteMarks > 0
                  ? 'border-[#FB7185]/45 bg-[#2A171C] text-[#FDA4AF] hover:bg-[#381E24]'
                  : 'border-white/10 bg-[#1B231E] text-slate-200 hover:bg-[#253029]'
              }`}
              aria-label="Open mosquito bite counter and history"
              title={`Bite Counter & History (${totalBites} total, ${activeBiteMarks} active)`}
            >
              <ShieldAlert className={`h-3.5 w-3.5 shrink-0 ${activeBiteMarks > 0 ? 'text-[#FB7185]' : 'text-slate-300'}`} />
              <span className="font-mono tabular-nums">{totalBites}</span>
            </button>

            <button
              type="button"
              onClick={onOpenLeaderboard}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-[#FF8A5C] transition-colors hover:bg-[#253029] shrink-0 cursor-pointer"
              aria-label="Open leaderboard"
              title="Leaderboard"
            >
              <Trophy className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onOpenAccount}
              className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors shrink-0 cursor-pointer ${
                isLoggedIn
                  ? 'border-[#C8F542]/40 bg-[#202C22] text-[#C8F542] hover:bg-[#28392B]'
                  : 'border-white/10 bg-[#1B231E] text-slate-200 hover:bg-[#253029]'
              }`}
              aria-label={isLoggedIn ? `Account: ${playerDisplayName}` : 'Guest Profile and Sign In'}
              title={isLoggedIn ? `${playerDisplayName} (Account)` : 'Guest Profile & Optional Sign In'}
            >
              <User className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={onOpenSettings}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-[#1B231E] px-2.5 text-xs font-medium text-[#F4F7F2] transition-colors hover:bg-[#253029] whitespace-nowrap shrink-0 cursor-pointer xl:px-3"
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">Settings</span>
            </button>

            <button
              type="button"
              onClick={onToggleFullscreen}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-slate-200 transition-colors hover:bg-[#253029] shrink-0 cursor-pointer"
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
              title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </footer>

      {/* Mobile / Tablet / Short-Landscape Slide-Up Controls Sheet (>= 44px touch targets) */}
      {mobileSheetOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/65 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-label="Game Controls"
          onClick={(e) => {
            if (e.target === e.currentTarget) setMobileSheetOpen(false);
          }}
        >
          <div className="safe-bottom max-h-[88dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl border-t border-x border-white/12 bg-[#121814] px-4 pt-5 pb-5 text-[#F4F7F2] shadow-2xl min-[380px]:px-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-display text-lg font-extrabold text-[#F4F7F2]">Game Controls</h2>
              <button
                type="button"
                onClick={() => setMobileSheetOpen(false)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-300 cursor-pointer"
                aria-label="Close controls"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Session actions */}
            <div className="mt-4 grid grid-cols-3 gap-1.5 min-[380px]:gap-2">
              <button
                type="button"
                onClick={() => {
                  onRestart();
                  setMobileSheetOpen(false);
                }}
                className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-white/12 bg-[#1B231E] px-2 text-[11px] font-semibold text-[#F4F7F2] whitespace-nowrap cursor-pointer min-[380px]:gap-1.5 min-[380px]:text-xs"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                Restart
              </button>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setMobileSheetOpen(false);
                }}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] px-2 text-[11px] font-semibold text-slate-200 whitespace-nowrap cursor-pointer min-[380px]:text-xs"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={() => {
                  onEndGame();
                  setMobileSheetOpen(false);
                }}
                className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-[#FF6B35]/35 bg-[#FF6B35]/15 px-2 text-[11px] font-semibold text-[#FF8A5C] whitespace-nowrap cursor-pointer min-[380px]:gap-1.5 min-[380px]:text-xs"
              >
                <Flag className="h-3.5 w-3.5 shrink-0" />
                End Game
              </button>
            </div>

            {/* Mosquito count adjustments */}
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-300">
                <span className="font-semibold text-[#F4F7F2]">Add or Remove Mosquitoes</span>
                <span className="font-mono text-[#C8F542] tabular-nums whitespace-nowrap">{livingCount} active</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 min-[380px]:gap-2">
                {[1, 5, 10, 20].map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => onAddMosquitoes(amt)}
                    className="inline-flex h-11 items-center justify-center gap-0.5 rounded-lg border border-white/12 bg-[#1B2520] font-mono text-xs font-bold text-[#C8F542] cursor-pointer min-[380px]:gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {amt}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-1.5 min-[380px]:gap-2">
                <button
                  type="button"
                  onClick={() => onRemoveMosquitoes(1)}
                  disabled={livingCount <= 0}
                  className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-white/10 bg-[#1B231E] font-mono text-xs font-semibold text-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <Minus className="h-3.5 w-3.5" />
                  1
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveMosquitoes(5)}
                  disabled={livingCount <= 0}
                  className="inline-flex h-11 items-center justify-center gap-1 rounded-lg border border-white/10 bg-[#1B231E] font-mono text-xs font-semibold text-slate-300 disabled:opacity-40 cursor-pointer"
                >
                  <Minus className="h-3.5 w-3.5" />
                  5
                </button>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={customCount}
                    onChange={(e) => setCustomCount(e.target.value)}
                    aria-label="Custom mosquito count"
                    className="h-11 w-full min-w-0 rounded-lg border border-white/15 bg-[#0E1310] px-1.5 text-center font-mono text-xs text-[#F4F7F2] tabular-nums outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustom}
                    className="h-11 shrink-0 rounded-lg bg-[#C8F542] px-2.5 text-xs font-extrabold text-[#0E1310] cursor-pointer min-[380px]:px-3"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Difficulty selector — 3+2 grid on tiny phones (< 400px), 5-col bar on >= 400px */}
            <div className="mt-5 space-y-2">
              <span className="block text-xs font-semibold text-[#F4F7F2]">Difficulty</span>
              <div className="grid grid-cols-3 gap-1.5 min-[400px]:grid-cols-5">
                {DIFFICULTIES.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => onDifficultyChange(d.value)}
                    className={`h-11 rounded-lg px-1.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                      difficulty === d.value
                        ? 'bg-[#28352D] text-[#C8F542]'
                        : 'border border-white/10 bg-[#18201B] text-slate-400'
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onToggleAutoDifficulty}
                  className={`h-11 rounded-lg px-1.5 text-xs font-bold whitespace-nowrap cursor-pointer ${
                    autoDifficulty
                      ? 'bg-[#FF6B35] text-[#0E1310]'
                      : 'border border-white/10 bg-[#18201B] text-slate-400'
                  }`}
                >
                  Auto
                </button>
              </div>
            </div>

            {/* Toggles & Settings */}
            <div className="mt-5 grid grid-cols-1 gap-2 min-[360px]:grid-cols-2">
              <button
                type="button"
                onClick={onToggleHandPointer}
                className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  showHandPointer
                    ? 'border-[#C8F542]/40 bg-[#202C22] text-[#C8F542]'
                    : 'border-white/10 bg-[#1B231E] text-slate-300'
                }`}
              >
                <Crosshair className="h-4 w-4 shrink-0" />
                {showHandPointer ? 'Pointer On' : 'Pointer Off'}
              </button>

              <button
                type="button"
                onClick={onToggleMute}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-[#1B231E] px-3 text-xs font-semibold text-slate-200 whitespace-nowrap cursor-pointer"
              >
                {muted ? <VolumeX className="h-4 w-4 shrink-0 text-[#FB7185]" /> : <Volume2 className="h-4 w-4 shrink-0 text-[#C8F542]" />}
                {muted ? 'Unmute Sound' : 'Mute Sound'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onOpenAccount();
                }}
                className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  isLoggedIn
                    ? 'border-[#C8F542]/40 bg-[#1E2B20] text-[#C8F542]'
                    : 'border-white/12 bg-[#1B231E] text-[#F4F7F2]'
                }`}
              >
                <User className="h-4 w-4 shrink-0" />
                <span className="truncate">
                  {isLoggedIn ? playerDisplayName : 'Guest · Sign In'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onOpenLeaderboard();
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-3 text-xs font-semibold text-[#F4F7F2] whitespace-nowrap cursor-pointer"
              >
                <Trophy className="h-4 w-4 shrink-0 text-[#FF6B35]" />
                Leaderboard
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onOpenBiteHistory();
                }}
                className={`inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                  activeBiteMarks > 0
                    ? 'border-[#FB7185]/45 bg-[#2A171C] text-[#FDA4AF]'
                    : 'border-white/12 bg-[#1B231E] text-[#F4F7F2]'
                }`}
              >
                <ShieldAlert className="h-4 w-4 shrink-0 text-[#FB7185]" />
                Bite History ({totalBites})
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onOpenSettings();
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-3 text-xs font-semibold text-[#F4F7F2] whitespace-nowrap cursor-pointer"
              >
                <Settings className="h-4 w-4 shrink-0" />
                All Settings
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileSheetOpen(false);
                  onOpenDownloads();
                }}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1B281E] px-3 text-xs font-semibold text-[#C8F542] whitespace-nowrap cursor-pointer"
              >
                <Download className="h-4 w-4 shrink-0" />
                Download App
              </button>
            </div>

            <div className="mt-2">
              <PWAInstallButton className="w-full" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
