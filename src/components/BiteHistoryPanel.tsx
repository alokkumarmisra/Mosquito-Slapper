import { Activity, Bug, Eraser, ShieldAlert, X } from 'lucide-react';
import { BITE_STYLE_LABELS } from '../game/BiteLocationManager';
import { BiteRecord, BiteStatistics } from '../types/game';

interface BiteHistoryPanelProps {
  open: boolean;
  stats: BiteStatistics;
  bites: BiteRecord[];
  bodyTrackingActive: boolean;
  visibleRegionCount: number;
  onResetBiteMarks: () => void;
  onClose: () => void;
}

function formatBiteClock(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatHealingLabel(bite: BiteRecord): { text: string; tone: string } {
  if (bite.animationState === 'HEALED' || bite.healingStatus === 'HEALED') {
    return { text: 'Cleared', tone: 'text-slate-500' };
  }
  if (bite.healingStatus === 'FADING') {
    return { text: 'Healing', tone: 'text-[#FBBF24]' };
  }
  if (bite.healingStatus === 'FRESH') {
    return { text: 'Fresh Bite', tone: 'text-[#FB7185]' };
  }
  return { text: 'Swollen', tone: 'text-[#FF8A5C]' };
}

export function BiteHistoryPanel({
  open,
  stats,
  bites,
  bodyTrackingActive,
  visibleRegionCount,
  onResetBiteMarks,
  onClose,
}: BiteHistoryPanelProps) {
  if (!open) return null;

  const mosquitoLeaderboard = Object.entries(stats.bitesPerMosquito)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

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
        aria-label="Mosquito Bite Counter and History"
      >
        {/* Header */}
        <div className="safe-top flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 shrink-0 text-[#FB7185]" />
              <h2 className="font-display text-lg font-bold text-[#F4F7F2]">
                Bite Counter &amp; History
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {bodyTrackingActive
                ? `Local body tracker active · ${visibleRegionCount} visible region${visibleRegionCount === 1 ? '' : 's'}`
                : 'Local face & body landmark tracking'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-[#1B231E] text-slate-300 hover:bg-[#253029] hover:text-white cursor-pointer"
            aria-label="Close bite history"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {/* Primary Counters */}
          <section className="space-y-3">
            <div className="grid grid-cols-3 gap-3 border-b border-white/10 pb-3.5">
              <SummaryCell
                label="Total Bites"
                value={String(stats.totalBites)}
                accent={stats.totalBites > 0 ? 'text-[#FB7185]' : 'text-[#F4F7F2]'}
              />
              <SummaryCell
                label="Active Marks"
                value={String(stats.activeBiteMarks)}
                accent={stats.activeBiteMarks > 0 ? 'text-[#FF8A5C]' : 'text-slate-300'}
              />
              <SummaryCell
                label="Mid-Bite Kills"
                value={String(stats.bitingKills)}
                accent={stats.bitingKills > 0 ? 'text-[#C8F542]' : 'text-slate-300'}
              />
            </div>

            {/* Per-Body-Area Counters */}
            <div className="grid grid-cols-5 gap-2 border-b border-white/10 pb-3.5 text-center">
              <RegionCount label="Face" value={stats.faceBites} />
              <RegionCount label="Arms" value={stats.armBites} />
              <RegionCount label="Neck" value={stats.neckBites} />
              <RegionCount label="Hands" value={stats.handBites} />
              <RegionCount label="Legs" value={stats.legBites} />
            </div>

            {/* Most Bitten Region */}
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-400">Most Bitten Region</span>
              <span className="font-mono font-bold text-[#FF8A5C] tabular-nums">
                {stats.mostBittenRegion
                  ? `${stats.mostBittenRegionLabel} (${stats.mostBittenRegionCount})`
                  : 'None yet'}
              </span>
            </div>
          </section>

          {/* Bites Per Mosquito */}
          {mosquitoLeaderboard.length > 0 && (
            <section className="space-y-2 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#C8F542]">
                  <Bug className="h-3.5 w-3.5" />
                  <h3>Bites per Mosquito</h3>
                </div>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  {Object.keys(stats.bitesPerMosquito).length} biters
                </span>
              </div>
              <div className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#171E1A]">
                {mosquitoLeaderboard.map(([mosqId, count]) => (
                  <div
                    key={mosqId}
                    className="flex items-center justify-between px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-slate-300">
                      Mosquito #{mosqId.replace(/^m-/, '')}
                    </span>
                    <span className="font-mono font-bold text-[#FB7185] tabular-nums">
                      {count} bite{count === 1 ? '' : 's'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Chronological Bite Location History */}
          <section className="space-y-2.5 border-t border-white/10 pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[#F4F7F2]">
                <Activity className="h-3.5 w-3.5 text-[#FB7185]" />
                <h3>Bite Location History</h3>
              </div>
              <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                {bites.length} logged
              </span>
            </div>

            {bites.length === 0 ? (
              <div className="rounded-xl border border-white/8 bg-[#161D19] px-4 py-6 text-center">
                <p className="text-xs font-medium text-slate-300">No mosquito bites recorded yet.</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  When a mosquito lands on your face, neck, arms, hands, or legs and finishes biting,
                  its exact landmark-anchored mark appears here.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-white/8 rounded-xl border border-white/10 bg-[#161D19]">
                {bites.map((bite) => {
                  const status = formatHealingLabel(bite);
                  return (
                    <li key={bite.id} className="px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-[#F4F7F2]">
                          {bite.regionLabel}
                        </span>
                        <span className={`font-mono text-[11px] font-semibold ${status.tone}`}>
                          {status.text}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-400">
                        <span>{BITE_STYLE_LABELS[bite.visualStyle]}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {Math.round(bite.normalizedX * 100)}%, {Math.round(bite.normalizedY * 100)}%
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          #{bite.mosquitoId.replace(/^m-/, '')}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">{formatBiteClock(bite.timestamp)}</span>
                      </div>
                      {bite.killedDuringBite && (
                        <p className="mt-1 font-mono text-[11px] font-semibold text-[#C8F542]">
                          Swatted during bite · Bonus awarded
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        {/* Sticky Footer with Reset Bite Marks Button */}
        <div className="safe-bottom flex shrink-0 items-center justify-between gap-2.5 border-t border-white/10 bg-[#101512]/95 px-4 py-3 sm:px-5 sm:py-3.5">
          <button
            type="button"
            onClick={onResetBiteMarks}
            disabled={stats.activeBiteMarks === 0}
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-[#FB7185]/40 bg-[#2A171C] px-4 text-xs font-bold text-[#FDA4AF] transition-colors hover:bg-[#381E24] disabled:opacity-45 whitespace-nowrap cursor-pointer"
          >
            <Eraser className="h-4 w-4 shrink-0" />
            Reset Bite Marks ({stats.activeBiteMarks})
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] px-4 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#253029] whitespace-nowrap cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-0.5 font-mono text-xl font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  );
}

function RegionCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] font-medium text-slate-400">{label}</div>
      <div
        className={`mt-0.5 font-mono text-sm font-bold tabular-nums ${
          value > 0 ? 'text-[#FDA4AF]' : 'text-slate-400'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
