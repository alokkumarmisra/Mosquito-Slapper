import { Tv, User } from 'lucide-react';
import {
  ActiveChallenge,
  CompanionConnectionState,
  DeviceRole,
  DifficultyLevel,
  GamePhase,
  GameStats,
  GestureState,
  VideoTransportMode,
  VisionEngineMode,
} from '../types/game';
import { LlmConnectionStatus } from '../ai/LocalLlmService';

interface GameHudProps {
  phase: GamePhase;
  stats: GameStats;
  effectiveDifficulty: DifficultyLevel;
  autoDifficulty: boolean;
  gestureState: GestureState;
  handsCount: number;
  visionMode: VisionEngineMode;
  llmStatus: LlmConnectionStatus;
  commentary: string;
  activeChallenge: ActiveChallenge | null;
  swarmTacticName: string | null;
  deviceRole: DeviceRole;
  roomCode: string | null;
  companionState: CompanionConnectionState;
  transportMode: VideoTransportMode;
  playerDisplayName: string;
  isLoggedIn: boolean;
  onRequestSwarmTactic: () => void;
  onOpenTvCast: () => void;
  onOpenAccount: () => void;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatGestureLabel(state: GestureState, handsCount: number): { text: string; tone: string } {
  switch (state) {
    case GestureState.ATTACK_CONFIRMED:
      return { text: 'Strike Confirmed', tone: 'text-[#C8F542]' };
    case GestureState.ATTACK_IN_PROGRESS:
      return { text: 'Attack Motion', tone: 'text-[#FF6B35]' };
    case GestureState.ATTACK_PREPARATION:
      return { text: 'Attack Ready', tone: 'text-[#FBBF24]' };
    case GestureState.ATTACK_COOLDOWN:
      return { text: 'Cooldown', tone: 'text-slate-300' };
    case GestureState.HAND_DETECTED:
      return {
        text: `${handsCount} Hand${handsCount === 1 ? '' : 's'} Tracked`,
        tone: 'text-[#C8F542]',
      };
    default:
      return { text: 'Idle · Show Hands', tone: 'text-slate-400' };
  }
}

export function GameHud({
  phase,
  stats,
  effectiveDifficulty,
  autoDifficulty,
  gestureState,
  handsCount,
  visionMode,
  llmStatus,
  commentary,
  activeChallenge,
  swarmTacticName,
  deviceRole,
  roomCode,
  companionState,
  transportMode,
  playerDisplayName,
  isLoggedIn,
  onRequestSwarmTactic,
  onOpenTvCast,
  onOpenAccount,
}: GameHudProps) {
  const gestureInfo = formatGestureLabel(gestureState, handsCount);
  const isTvMode = deviceRole === 'TV_DISPLAY';

  const tvStatusText =
    companionState === 'CONNECTED'
      ? transportMode === 'WEBRTC'
        ? 'Phone HD'
        : 'Phone Live'
      : 'Waiting for Phone';

  return (
    <header className="safe-top safe-x pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex w-full max-w-[2200px] flex-col gap-1.5 sm:gap-2">
      {/* Compact single-row HUD for portrait phones (< 640px) AND short landscape phones (<= 520px height) */}
      <div className="short-landscape-show pointer-events-auto flex h-11 items-center justify-between gap-1.5 rounded-xl border border-white/10 bg-[#111613]/84 px-2.5 backdrop-blur-md min-[380px]:gap-2 min-[380px]:px-3 sm:hidden">
        <div className="flex min-w-0 items-center gap-2 text-xs min-[380px]:gap-3">
          <CompactMetric label="Score" value={stats.score.toLocaleString()} accent="text-[#C8F542]" />
          <CompactMetric label="Killed" value={String(stats.mosquitoesKilled)} className="hidden min-[520px]:flex" />
          <CompactMetric label="Left" value={String(stats.mosquitoesRemaining)} />
          <CompactMetric
            label="Combo"
            value={`${stats.currentCombo}x`}
            accent={stats.currentCombo >= 3 ? 'text-[#FF6B35]' : 'text-[#F4F7F2]'}
          />
          <CompactMetric
            label="Acc"
            value={`${Math.round(stats.accuracy)}%`}
            className="hidden min-[620px]:flex"
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-300 tabular-nums">
            {formatTime(stats.elapsedSeconds)}
          </span>
          {isTvMode && roomCode && (
            <button
              type="button"
              onClick={onOpenTvCast}
              className="font-mono text-xs font-bold text-[#C8F542] underline decoration-[#C8F542]/40 underline-offset-2 whitespace-nowrap cursor-pointer"
            >
              TV {roomCode}
            </button>
          )}
          <button
            type="button"
            onClick={onOpenAccount}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
              isLoggedIn
                ? 'border-[#C8F542]/40 bg-[#1F2C22] text-[#C8F542]'
                : 'border-white/10 bg-[#1A221D] text-slate-300'
            }`}
            aria-label={isLoggedIn ? `Account profile: ${playerDisplayName}` : 'Guest profile and optional sign in'}
            title={isLoggedIn ? `${playerDisplayName} (Account)` : `${playerDisplayName} · Sign in optional`}
          >
            <User className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Full Tablet, Desktop & 10-Foot TV Scoreboard Strip (>= 640px and height > 520px) */}
      <div
        className={`short-landscape-hide pointer-events-auto hidden flex-wrap items-center justify-between gap-x-4 gap-y-1.5 rounded-xl border border-white/10 bg-[#111613]/82 backdrop-blur-md sm:flex xl:gap-x-6 ${
          isTvMode ? 'px-5 py-3' : 'px-3.5 py-2 lg:px-4 lg:py-2.5'
        }`}
      >
        {/* Brand & live state metadata (clean unboxed text with typographic separators) */}
        <div className="flex min-w-0 items-center gap-2.5 lg:gap-3">
          <span
            className={`font-display font-extrabold tracking-tight text-[#F4F7F2] whitespace-nowrap shrink-0 ${
              isTvMode ? 'text-base lg:text-lg 2xl:text-xl' : 'text-sm lg:text-base'
            }`}
          >
            AI Mosquito Slapper
          </span>
          <span className="hidden text-white/25 lg:inline" aria-hidden="true">
            /
          </span>
          <div className="hidden items-center gap-2 text-xs text-slate-300 lg:flex">
            {isTvMode ? (
              <button
                type="button"
                onClick={onOpenTvCast}
                className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-[#C8F542] transition-colors hover:text-[#dcfb7c] whitespace-nowrap cursor-pointer"
                title="Show TV Room QR code"
              >
                <Tv className="h-3.5 w-3.5" />
                Room {roomCode ?? '----'} · {tvStatusText}
              </button>
            ) : (
              <span className="font-medium text-[#F4F7F2] whitespace-nowrap">
                {effectiveDifficulty.charAt(0) + effectiveDifficulty.slice(1).toLowerCase()}
                {autoDifficulty ? ' (Auto)' : ''}
              </span>
            )}
            <span className="text-white/30" aria-hidden="true">·</span>
            <span className={`font-mono font-medium whitespace-nowrap ${gestureInfo.tone}`}>
              {gestureInfo.text}
            </span>
            <span className="text-white/30 hidden 2xl:inline" aria-hidden="true">·</span>
            <span className="hidden text-slate-400 whitespace-nowrap 2xl:inline">
              {isTvMode
                ? 'Phone Camera Tracker'
                : visionMode === 'PRACTICE_MOUSE'
                  ? 'Practice Pointer'
                  : visionMode === 'LOCAL_OPTICAL'
                    ? 'Local Optical CV'
                    : 'MediaPipe Hands'}
            </span>
          </div>
        </div>

        {/* All required HUD counters with tabular numerals & progressive width disclosure */}
        <div
          className={`flex flex-wrap items-center gap-y-1 ${
            isTvMode
              ? 'gap-x-4 text-sm lg:gap-x-5 xl:gap-x-6'
              : 'gap-x-3 text-xs md:gap-x-4 xl:gap-x-5'
          }`}
        >
          <MetricItem label="Score" value={stats.score.toLocaleString()} accent="text-[#C8F542]" large={isTvMode} />
          <MetricItem label="Killed" value={String(stats.mosquitoesKilled)} large={isTvMode} />
          <MetricItem
            label="Left"
            value={String(stats.mosquitoesRemaining)}
            accent={stats.mosquitoesRemaining === 0 ? 'text-[#C8F542]' : 'text-[#F4F7F2]'}
            large={isTvMode}
          />
          <MetricItem
            label="Total"
            value={String(stats.totalMosquitoesSpawned)}
            large={isTvMode}
            className="hidden xl:flex"
          />
          <MetricItem
            label="Missed"
            value={String(stats.missedAttacks)}
            accent={stats.missedAttacks > 0 ? 'text-[#FB7185]' : 'text-slate-200'}
            large={isTvMode}
            className="hidden lg:flex"
          />
          <MetricItem
            label="Accuracy"
            value={`${Math.round(stats.accuracy)}%`}
            large={isTvMode}
            className="hidden md:flex"
          />
          <MetricItem
            label="Combo"
            value={`${stats.currentCombo}x`}
            sub={`Best ${stats.highestCombo}x`}
            accent={stats.currentCombo >= 3 ? 'text-[#FF6B35]' : 'text-[#F4F7F2]'}
            large={isTvMode}
          />
          <MetricItem label="Time" value={formatTime(stats.elapsedSeconds)} large={isTvMode} />
          <button
            type="button"
            onClick={onOpenAccount}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isLoggedIn
                ? 'border-[#C8F542]/35 bg-[#1D2A20] text-[#C8F542] hover:bg-[#253628]'
                : 'border-white/10 bg-[#19211C] text-slate-200 hover:border-white/25 hover:text-white'
            }`}
            title={isLoggedIn ? `Signed in as ${playerDisplayName}` : 'Playing as Guest · Click to view profile or sign in'}
          >
            <User className="h-3.5 w-3.5 shrink-0" />
            <span className="max-w-[96px] truncate">{playerDisplayName}</span>
          </button>
        </div>
      </div>

      {/* Lightweight AI commentary & active challenge bar during play (desktop/TV with adequate height only) */}
      {phase === GamePhase.PLAYING && (
        <div className="short-landscape-hide hidden flex-wrap items-center justify-between gap-2.5 px-0.5 sm:flex lg:gap-3">
          {commentary ? (
            <div className="pointer-events-auto flex min-w-0 max-w-xl items-center gap-2 rounded-lg border border-white/10 bg-[#111613]/75 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-sm xl:max-w-2xl xl:gap-2.5">
              <span className="font-mono text-[11px] font-semibold text-[#C8F542] whitespace-nowrap shrink-0">
                {llmStatus === 'CONNECTED' ? 'Local AI' : 'Announcer'}
              </span>
              <span className="text-white/25" aria-hidden="true">·</span>
              <span className="min-w-0 truncate">{commentary}</span>
              {swarmTacticName && (
                <>
                  <span className="text-white/25 hidden md:inline" aria-hidden="true">·</span>
                  <span className="hidden text-[#FF6B35] font-medium whitespace-nowrap md:inline">
                    Swarm: {swarmTacticName}
                  </span>
                </>
              )}
              <button
                type="button"
                onClick={onRequestSwarmTactic}
                className="ml-1 text-[11px] font-medium text-slate-300 underline decoration-white/30 underline-offset-2 transition-colors hover:text-[#C8F542] whitespace-nowrap shrink-0 cursor-pointer"
              >
                New Tactic
              </button>
            </div>
          ) : <div />}

          {activeChallenge && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-white/10 bg-[#111613]/75 px-3 py-1.5 text-xs backdrop-blur-sm xl:gap-2.5">
              <span className="font-medium text-[#FF6B35] whitespace-nowrap shrink-0">
                Challenge: {activeChallenge.title}
              </span>
              <span className="text-white/25" aria-hidden="true">·</span>
              <span className="hidden text-slate-300 lg:inline">
                {activeChallenge.description}
              </span>
              <span className="font-mono font-semibold text-[#C8F542] tabular-nums whitespace-nowrap shrink-0">
                {activeChallenge.completed
                  ? `Done +${activeChallenge.bonusPoints}`
                  : `${Math.min(activeChallenge.progress, activeChallenge.targetValue)}/${activeChallenge.targetValue}`}
              </span>
            </div>
          )}
        </div>
      )}
    </header>
  );
}

interface MetricItemProps {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  large?: boolean;
  className?: string;
}

function MetricItem({
  label,
  value,
  sub,
  accent = 'text-[#F4F7F2]',
  large = false,
  className = 'flex',
}: MetricItemProps) {
  return (
    <div className={`${className} items-baseline gap-1.5 whitespace-nowrap`}>
      <span className={large ? 'text-xs font-medium text-slate-400' : 'text-[11px] font-medium text-slate-400'}>
        {label}
      </span>
      <span className={`font-mono font-bold tabular-nums ${large ? 'text-base' : 'text-sm'} ${accent}`}>
        {value}
      </span>
      {sub && (
        <span className="hidden font-mono text-[11px] text-slate-400 tabular-nums 2xl:inline">
          ({sub})
        </span>
      )}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  accent = 'text-[#F4F7F2]',
  className = 'flex',
}: {
  label: string;
  value: string;
  accent?: string;
  className?: string;
}) {
  return (
    <div className={`${className} items-baseline gap-1 whitespace-nowrap`}>
      <span className="text-[10px] font-medium text-slate-400">{label}</span>
      <span className={`font-mono text-xs font-bold tabular-nums ${accent}`}>{value}</span>
    </div>
  );
}
