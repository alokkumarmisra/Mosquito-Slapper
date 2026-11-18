import { Award, Home, RotateCcw, Trophy, User } from 'lucide-react';
import { AchievementBadge, BiteStatistics, GameStats } from '../types/game';

interface GameOverModalProps {
  stats: GameStats;
  biteStats?: BiteStatistics;
  achievements: AchievementBadge[];
  aiDebrief: string;
  swarmCleared: boolean;
  scoreSyncStatus?: string | null;
  playerDisplayName: string;
  playerUsername?: string | null;
  isLoggedIn: boolean;
  onPlayAgain: () => void;
  onMainMenu: () => void;
  onOpenAccount: () => void;
  onOpenLeaderboard: () => void;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

export function GameOverModal({
  stats,
  biteStats,
  achievements,
  aiDebrief,
  swarmCleared,
  scoreSyncStatus,
  playerDisplayName,
  playerUsername,
  isLoggedIn,
  onPlayAgain,
  onMainMenu,
  onOpenAccount,
  onOpenLeaderboard,
}: GameOverModalProps) {
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <div className="safe-top safe-bottom safe-x absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/65 py-4 backdrop-blur-sm sm:py-8">
      <div
        className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#121814]/96 shadow-2xl sm:max-h-[calc(100dvh-4rem)]"
        role="dialog"
        aria-modal="true"
        aria-label="Game Results"
      >
        {/* Scrollable results body */}
        <div className="flex-1 overflow-y-auto p-4 min-[380px]:p-5 sm:p-7">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#C8F542]">
                {swarmCleared ? 'Swarm Eliminated' : 'Session Complete'}
              </p>
              <h2 className="mt-1 font-display text-[clamp(1.35rem,4.5vw,1.875rem)] leading-tight font-extrabold tracking-tight text-[#F4F7F2]">
                Final Score:{' '}
                <span className="font-mono tabular-nums text-[#C8F542]">
                  {stats.score.toLocaleString()}
                </span>
              </h2>
            </div>
            <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
              Time {formatDuration(stats.elapsedSeconds)}
            </span>
          </div>

          {/* AI Debrief */}
          <p className="mt-2.5 text-xs leading-relaxed text-slate-300 sm:mt-3 sm:text-sm">
            {aiDebrief}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
            <User className={`h-3.5 w-3.5 shrink-0 ${isLoggedIn ? 'text-[#C8F542]' : 'text-slate-400'}`} />
            <span className="font-medium text-slate-200">{playerDisplayName}</span>
            <span aria-hidden="true">·</span>
            <span>
              {isLoggedIn && playerUsername ? `@${playerUsername}` : 'Guest Mode'}
            </span>
            {scoreSyncStatus && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] text-slate-400">{scoreSyncStatus}</span>
              </>
            )}
            {!isLoggedIn && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={onOpenAccount}
                  className="font-semibold text-[#C8F542] underline decoration-[#C8F542]/45 underline-offset-2 hover:text-[#dcfb7c] whitespace-nowrap cursor-pointer"
                >
                  Sign in to sync
                </button>
              </>
            )}
          </div>

          {/* Final Statistics Grid */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 border-y border-white/10 py-3.5 sm:mt-5 sm:grid-cols-3 sm:gap-3 sm:py-4">
            <StatCell label="Total Mosquitoes" value={String(stats.totalMosquitoesSpawned)} />
            <StatCell label="Total Kills" value={String(stats.mosquitoesKilled)} accent="text-[#C8F542]" />
            <StatCell
              label="Missed Attacks"
              value={String(stats.missedAttacks)}
              accent={stats.missedAttacks > 0 ? 'text-[#FB7185]' : undefined}
            />
            <StatCell label="Accuracy" value={`${Math.round(stats.accuracy)}%`} />
            <StatCell label="Highest Combo" value={`${stats.highestCombo}x`} accent="text-[#FF6B35]" />
            <StatCell label="Playing Time" value={formatDuration(stats.elapsedSeconds)} />
            {biteStats && (
              <>
                <StatCell
                  label="Total Bites"
                  value={String(biteStats.totalBites)}
                  sub={
                    biteStats.mostBittenRegion
                      ? `Top: ${biteStats.mostBittenRegionLabel}`
                      : undefined
                  }
                  accent={biteStats.totalBites > 0 ? 'text-[#FB7185]' : undefined}
                />
                <StatCell
                  label="Mid-Bite Kills"
                  value={String(biteStats.bitingKills)}
                  accent={biteStats.bitingKills > 0 ? 'text-[#C8F542]' : undefined}
                />
              </>
            )}
          </div>

          {/* Achievement Badges */}
          <div className="mt-4 sm:mt-5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[#F4F7F2]">Achievement Badges</h3>
              <span className="font-mono text-xs text-slate-400 tabular-nums whitespace-nowrap">
                {unlockedCount}/{achievements.length} unlocked
              </span>
            </div>

            <div className="mt-2.5 grid grid-cols-1 gap-2 min-[380px]:grid-cols-2 sm:mt-3 sm:grid-cols-3 sm:gap-2.5">
              {achievements.map((badge) => (
                <div
                  key={badge.id}
                  className={`rounded-xl border px-3 py-2.5 ${
                    badge.unlocked
                      ? 'border-[#C8F542]/40 bg-[#1B261E]'
                      : 'border-white/8 bg-[#171D19] opacity-55'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-xs font-bold ${
                        badge.unlocked ? 'text-[#C8F542]' : 'text-slate-400'
                      }`}
                    >
                      {badge.title}
                    </span>
                    <Award
                      className={`h-3.5 w-3.5 shrink-0 ${
                        badge.unlocked ? 'text-[#FF6B35]' : 'text-slate-600'
                      }`}
                    />
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-slate-300">
                    {badge.description}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-slate-400">
                    {badge.unlocked ? 'Unlocked' : 'Locked'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sticky Action Footer — always reachable on small portrait & short landscape screens */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-t border-white/10 bg-[#101512]/95 px-4 py-3 sm:gap-3 sm:px-7 sm:py-4">
          <button
            type="button"
            onClick={onOpenLeaderboard}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1A221D] px-3.5 text-xs font-semibold text-slate-200 transition-colors hover:border-[#C8F542]/40 hover:text-[#C8F542] whitespace-nowrap cursor-pointer sm:text-sm"
          >
            <Trophy className="h-4 w-4 shrink-0 text-[#FF6B35]" />
            Leaderboard
          </button>

          <div className="flex flex-1 items-center justify-end gap-2.5 sm:flex-none sm:gap-3">
            <button
              type="button"
              onClick={onMainMenu}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-white/12 bg-[#1A221D] px-4 text-xs font-medium text-slate-200 transition-colors hover:bg-[#242F28] whitespace-nowrap cursor-pointer sm:flex-none sm:text-sm"
            >
              <Home className="h-4 w-4 shrink-0" />
              Main Menu
            </button>
            <button
              type="button"
              onClick={onPlayAgain}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#C8F542] px-6 text-xs font-extrabold text-[#0E1310] transition-transform duration-150 hover:bg-[#d7fb6a] active:scale-95 whitespace-nowrap cursor-pointer sm:flex-none sm:text-sm"
            >
              <RotateCcw className="h-4 w-4 shrink-0" />
              Play Again
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  sub,
  accent = 'text-[#F4F7F2]',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl ${accent}`}>
        {value}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}
