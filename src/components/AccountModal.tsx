import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Award,
  Check,
  Cloud,
  LogOut,
  RefreshCw,
  Trophy,
  Upload,
  User,
  X,
} from 'lucide-react';
import { fetchCloudLeaderboard } from '../auth/PlayerSessionService';
import { fetchLeaderboard as fetchServerGuestLeaderboard } from '../network/BackendApiClient';
import {
  AccountModalTab,
  BackendApiConfig,
  GuestProfile,
  LeaderboardEntry,
  PlayerAccount,
} from '../types/game';

interface AccountModalProps {
  open: boolean;
  initialTab: AccountModalTab;
  account: PlayerAccount | null;
  guestProfile: GuestProfile;
  backendConfig: BackendApiConfig;
  authReady: boolean;
  onClose: () => void;
  onSignInWithGoogle: (importGuest: boolean) => Promise<{ ok: boolean; error?: string }>;
  onSignOut: () => Promise<void>;
  onUpdateDisplayName: (nextName: string) => Promise<{ ok: boolean; error?: string }>;
  onImportGuestToAccount: () => Promise<{ ok: boolean; error?: string }>;
  onClearGuestHistory: () => void;
}

type LeaderboardFilter = 'all' | 'cloud' | 'guests';

function getInitials(name: string): string {
  const parts = (name || 'G').trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return (parts[0] || 'G').slice(0, 2).toUpperCase();
}

function formatDifficulty(raw: string): string {
  if (!raw) return 'Normal';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function formatRelativeDate(iso: string): string {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export function AccountModal({
  open,
  initialTab,
  account,
  guestProfile,
  backendConfig,
  authReady,
  onClose,
  onSignInWithGoogle,
  onSignOut,
  onUpdateDisplayName,
  onImportGuestToAccount,
  onClearGuestHistory,
}: AccountModalProps) {
  const [activeTab, setActiveTab] = useState<AccountModalTab>(initialTab);
  const [importGuest, setImportGuest] = useState(true);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [avatarFailed, setAvatarFailed] = useState(false);

  // Display name editing (works for both Guest and Signed-In Account)
  const [nameInput, setNameInput] = useState(account ? account.displayName : guestProfile.displayName);
  const [savingName, setSavingName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);

  // Combined Cloud (Firebase) + Guest Leaderboard state
  const [lbFilter, setLbFilter] = useState<LeaderboardFilter>('all');
  const [lbLoading, setLbLoading] = useState(false);
  const [lbError, setLbError] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setAuthError(null);
      setAuthNotice(null);
      setAvatarFailed(false);
      setNameInput(account ? account.displayName : guestProfile.displayName);
      setNameSaved(false);
    }
  }, [open, initialTab, account, guestProfile.displayName]);

  const loadLeaderboardData = useCallback(async () => {
    setLbLoading(true);
    setLbError(null);

    const [cloudRes, guestServerRes] = await Promise.all([
      lbFilter === 'guests'
        ? Promise.resolve({ ok: true, entries: [] as LeaderboardEntry[], error: undefined })
        : fetchCloudLeaderboard(40),
      lbFilter === 'cloud'
        ? Promise.resolve({ ok: true, leaderboard: [] as LeaderboardEntry[], recent: [] as LeaderboardEntry[], error: undefined })
        : fetchServerGuestLeaderboard(backendConfig, 'guests', 30),
    ]);

    setLbLoading(false);

    const merged: LeaderboardEntry[] = [];
    const seenIds = new Set<string>();

    if (cloudRes.ok) {
      for (const item of cloudRes.entries) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          merged.push(item);
        }
      }
    }

    if (lbFilter !== 'cloud') {
      const serverGuests = guestServerRes.ok ? guestServerRes.leaderboard : [];
      for (const item of serverGuests) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          merged.push({ ...item, isGuest: true });
        }
      }
      // Include local browser guest matches if server didn't return them (offline guest play)
      if (serverGuests.length === 0 && guestProfile.recentMatches.length > 0) {
        for (const localMatch of guestProfile.recentMatches) {
          if (!seenIds.has(localMatch.id)) {
            seenIds.add(localMatch.id);
            merged.push({ ...localMatch, isGuest: true });
          }
        }
      }
    }

    merged.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.highestCombo - a.highestCombo;
    });

    setLeaderboard(merged.slice(0, 40));

    if (!cloudRes.ok && lbFilter !== 'guests') {
      setLbError(cloudRes.error || 'Could not reach Firebase cloud leaderboard.');
    }
  }, [backendConfig, lbFilter, guestProfile.recentMatches]);

  useEffect(() => {
    if (open && activeTab === 'leaderboard') {
      void loadLeaderboardData();
    }
  }, [open, activeTab, loadLeaderboardData]);

  if (!open) return null;

  const isLoggedIn = Boolean(account);
  const activeStats = account ? account.stats : guestProfile.stats;
  const activeAchievements = account ? account.unlockedAchievements : guestProfile.unlockedAchievements;
  const hasGuestProgress = guestProfile.stats.gamesPlayed > 0;

  const handleSaveName = async (e: FormEvent) => {
    e.preventDefault();
    const cleaned = nameInput.trim();
    if (!cleaned) return;
    setSavingName(true);
    setAuthError(null);
    const res = await onUpdateDisplayName(cleaned);
    setSavingName(false);
    if (res.ok) {
      setNameSaved(true);
      window.setTimeout(() => setNameSaved(false), 1800);
    } else if (res.error) {
      setAuthError(res.error);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const res = await onSignInWithGoogle(hasGuestProgress && importGuest);
      if (res.ok) {
        setAuthNotice('Signed in with Google. Your profile, settings, and scores now sync to Firebase.');
      } else if (res.error) {
        setAuthError(res.error);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleImportNow = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const res = await onImportGuestToAccount();
      if (res.ok) {
        setAuthNotice('Imported local Guest stats and badges into your Firebase account.');
      } else if (res.error) {
        setAuthError(res.error);
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOutClick = async () => {
    setAuthBusy(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      await onSignOut();
      setAuthNotice('Switched back to Guest Mode. Every game mode remains fully playable.');
    } finally {
      setAuthBusy(false);
    }
  };

  return (
    <div
      className="safe-top safe-bottom safe-x fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/70 py-4 backdrop-blur-sm sm:py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Player Profile and Leaderboard"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#121814]/98 text-[#F4F7F2] shadow-2xl sm:max-h-[calc(100dvh-4rem)]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-extrabold tracking-tight text-[#F4F7F2] sm:text-xl">
              Player Profile &amp; Leaderboard
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              {isLoggedIn
                ? `Signed in with Google as ${account!.displayName} · Cloud sync active`
                : 'Play immediately without login, or sign in with Google to sync progress across devices'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/12 bg-[#1B231E] text-slate-300 transition-colors hover:bg-[#253029] hover:text-white cursor-pointer"
            aria-label="Close player modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented Navigation Tabs */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 bg-[#101512] px-4 py-2.5 sm:px-6">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#18201B] p-1">
            <button
              type="button"
              onClick={() => setActiveTab('profile')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'profile'
                  ? 'bg-[#28362D] text-[#C8F542]'
                  : 'text-slate-400 hover:text-[#F4F7F2]'
              }`}
            >
              <User className="h-3.5 w-3.5 shrink-0" />
              {isLoggedIn ? 'Cloud Profile' : 'Guest & Sign In'}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('leaderboard')}
              className={`inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === 'leaderboard'
                  ? 'bg-[#28362D] text-[#C8F542]'
                  : 'text-slate-400 hover:text-[#F4F7F2]'
              }`}
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" />
              Leaderboard
            </button>
          </div>

          <span className="hidden text-xs text-slate-400 sm:inline">
            {isLoggedIn ? 'Firebase Synced' : 'Guest Mode · No Login Required'}
          </span>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
          {activeTab === 'profile' ? (
            <>
              {/* Current Player Identity Summary */}
              <div className="flex flex-col justify-between gap-4 border-b border-white/10 pb-5 sm:flex-row sm:items-center">
                <div className="flex items-center gap-3.5">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border font-display text-base font-extrabold ${
                      isLoggedIn
                        ? 'border-[#C8F542]/45 bg-[#1D2B20] text-[#C8F542]'
                        : 'border-white/12 bg-[#1A221D] text-slate-200'
                    }`}
                  >
                    {isLoggedIn && account!.photoURL && !avatarFailed ? (
                      <img
                        src={account!.photoURL}
                        alt={account!.displayName}
                        referrerPolicy="no-referrer"
                        onError={() => setAvatarFailed(true)}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      getInitials(isLoggedIn ? account!.displayName : guestProfile.displayName)
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="truncate font-display text-base font-bold text-[#F4F7F2]">
                        {isLoggedIn ? account!.displayName : guestProfile.displayName}
                      </span>
                      <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                      <span className="font-mono text-xs text-[#C8F542]">
                        {isLoggedIn ? 'Google Account' : 'Guest Player'}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {isLoggedIn
                        ? 'Stats, badges, preferences, and verified leaderboard entries sync automatically.'
                        : '100% playable without login. Local stats and badges save automatically in your browser.'}
                    </p>
                  </div>
                </div>

                {isLoggedIn && (
                  <button
                    type="button"
                    onClick={() => void handleSignOutClick()}
                    disabled={authBusy}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-white/12 bg-[#1B231E] px-3.5 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#26322B] hover:text-white disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign Out (Use Guest)
                  </button>
                )}
              </div>

              {authNotice && (
                <p className="text-xs font-medium text-[#C8F542]" role="status">
                  {authNotice}
                </p>
              )}

              {authError && (
                <p className="text-xs font-medium text-[#FDA4AF]" role="alert">
                  {authError}
                </p>
              )}

              {/* Editable Display Name (works in both Guest and Signed-In modes) */}
              <form onSubmit={(e) => void handleSaveName(e)} className="space-y-1.5">
                <label htmlFor="player-display-name" className="block text-xs font-semibold text-slate-300">
                  {isLoggedIn ? 'Public Display Name (Leaderboard & HUD)' : 'Guest Display Name (optional)'}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="player-display-name"
                    type="text"
                    maxLength={32}
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    placeholder={isLoggedIn ? 'Your display name' : 'Guest'}
                    className="h-11 min-w-0 flex-1 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-sm text-[#F4F7F2] outline-none focus:border-[#C8F542]"
                  />
                  <button
                    type="submit"
                    disabled={savingName || !nameInput.trim()}
                    className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-[#1E2A22] px-4 text-xs font-semibold text-[#C8F542] transition-colors hover:bg-[#27382C] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                  >
                    {nameSaved ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Saved
                      </>
                    ) : savingName ? (
                      'Saving...'
                    ) : (
                      'Save Name'
                    )}
                  </button>
                </div>
              </form>

              {/* Lifetime Statistics Strip */}
              <div className="space-y-2.5 border-y border-white/10 py-4">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-[#F4F7F2]">
                    {isLoggedIn ? 'Cloud Lifetime Stats' : 'Local Guest Stats'}
                  </span>
                  <span className="font-mono text-slate-400 tabular-nums">
                    {activeAchievements.length} badge{activeAchievements.length === 1 ? '' : 's'} unlocked
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <LifetimeMetric
                    label="Best Score"
                    value={activeStats.bestScore.toLocaleString()}
                    accent="text-[#C8F542]"
                  />
                  <LifetimeMetric label="Matches" value={String(activeStats.gamesPlayed)} />
                  <LifetimeMetric label="Total Kills" value={activeStats.totalKills.toLocaleString()} />
                  <LifetimeMetric
                    label="Best Combo"
                    value={`${activeStats.highestCombo}x`}
                    accent="text-[#FF6B35]"
                  />
                  <LifetimeMetric
                    label="Best Acc"
                    value={`${Math.round(activeStats.bestAccuracy)}%`}
                  />
                </div>

                {activeAchievements.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1 text-xs text-slate-300">
                    <Award className="h-3.5 w-3.5 shrink-0 text-[#FF6B35]" />
                    <span className="text-slate-400">Badges:</span>
                    <span>{activeAchievements.join(' · ')}</span>
                  </div>
                )}

                {!isLoggedIn && hasGuestProgress && (
                  <div className="flex items-center justify-between pt-1 text-xs">
                    <span className="text-slate-400">Stored locally in this browser.</span>
                    <button
                      type="button"
                      onClick={onClearGuestHistory}
                      className="text-xs font-medium text-slate-400 underline decoration-white/25 underline-offset-2 hover:text-[#FDA4AF] cursor-pointer"
                    >
                      Reset Guest Stats
                    </button>
                  </div>
                )}

                {isLoggedIn && hasGuestProgress && (
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-xs">
                    <span className="text-slate-300">
                      You have {guestProfile.stats.gamesPlayed} unsynced local Guest match
                      {guestProfile.stats.gamesPlayed === 1 ? '' : 'es'} (best{' '}
                      {guestProfile.stats.bestScore.toLocaleString()}).
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleImportNow()}
                      disabled={authBusy}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#C8F542]/40 bg-[#1E2B20] px-3 text-xs font-semibold text-[#C8F542] hover:bg-[#27392A] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import Guest Stats
                    </button>
                  </div>
                )}
              </div>

              {/* Optional Firebase Google Sign-In Section (Only shown in Guest Mode) */}
              {!isLoggedIn && (
                <div className="space-y-3.5">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <Cloud className="h-4 w-4 text-[#C8F542]" />
                      <h3 className="text-sm font-bold text-[#F4F7F2]">
                        Optional Cloud Sync with Google
                      </h3>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">
                      Sign in with Google to save your lifetime stats, badges, and settings across
                      devices and post verified scores to the Firebase Cloud Leaderboard. You can
                      also skip login and play every feature right away as a Guest.
                    </p>
                  </div>

                  {hasGuestProgress && (
                    <label className="flex cursor-pointer items-center gap-2.5 text-xs text-slate-300">
                      <input
                        type="checkbox"
                        checked={importGuest}
                        onChange={(e) => setImportGuest(e.target.checked)}
                        className="h-4 w-4 accent-[#C8F542]"
                      />
                      <span>
                        Import my Guest stats ({guestProfile.stats.gamesPlayed} match
                        {guestProfile.stats.gamesPlayed === 1 ? '' : 'es'}, best{' '}
                        {guestProfile.stats.bestScore.toLocaleString()}) when signing in
                      </span>
                    </label>
                  )}

                  <div className="flex flex-col-reverse gap-2.5 pt-1 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={onClose}
                      className="inline-flex h-11 items-center justify-center rounded-lg border border-white/12 bg-[#1A221D] px-4 text-xs font-semibold text-slate-200 transition-colors hover:bg-[#242F28] whitespace-nowrap cursor-pointer"
                    >
                      Continue as Guest
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleGoogleSignIn()}
                      disabled={authBusy || !authReady}
                      className="inline-flex h-11 items-center justify-center gap-2.5 rounded-lg bg-[#C8F542] px-5 text-xs font-extrabold text-[#0E1310] transition-transform duration-150 hover:bg-[#d7fb6a] active:scale-95 disabled:opacity-60 whitespace-nowrap cursor-pointer"
                    >
                      <GoogleGIcon />
                      {authBusy ? 'Signing In...' : 'Sign in with Google'}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            /* Live Combined Firebase Cloud + Guest Leaderboard Tab */
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-[#18201B] p-1">
                  {(
                    [
                      { key: 'all', label: 'All Players' },
                      { key: 'cloud', label: 'Cloud Accounts' },
                      { key: 'guests', label: 'Guests' },
                    ] as Array<{ key: LeaderboardFilter; label: string }>
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setLbFilter(item.key)}
                      className={`h-8 rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                        lbFilter === item.key
                          ? 'bg-[#28362D] text-[#C8F542]'
                          : 'text-slate-400 hover:text-[#F4F7F2]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => void loadLeaderboardData()}
                  disabled={lbLoading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/12 bg-[#1A221D] px-3 text-xs font-medium text-slate-200 hover:bg-[#243028] disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${lbLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>

              {lbError && (
                <p className="text-xs text-[#FDA4AF]">{lbError}</p>
              )}

              {lbLoading && leaderboard.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">
                  Loading leaderboard scores...
                </div>
              ) : leaderboard.length === 0 ? (
                <div className="rounded-xl border border-white/8 bg-[#171E1A] px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-[#F4F7F2]">No scores posted yet</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Finish a round as a Guest or signed-in Google player to claim the #1 spot.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-white/10 text-[11px] text-slate-400">
                        <th className="py-2 pr-2 font-medium">Rank</th>
                        <th className="py-2 pr-3 font-medium">Player</th>
                        <th className="py-2 pr-3 text-right font-medium">Score</th>
                        <th className="py-2 pr-3 text-right font-medium">Kills</th>
                        <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Acc</th>
                        <th className="hidden py-2 pr-3 text-right font-medium sm:table-cell">Combo</th>
                        <th className="py-2 text-right font-medium">Mode</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/6">
                      {leaderboard.map((entry, idx) => {
                        const isMine =
                          (account && entry.userId === account.id) ||
                          (!account && entry.isGuest && entry.playerName === guestProfile.displayName);
                        return (
                          <tr
                            key={entry.id}
                            className={isMine ? 'bg-[#1A261E]/75' : undefined}
                          >
                            <td className="py-2.5 pr-2 font-mono font-bold tabular-nums text-slate-300">
                              <span
                                className={
                                  idx === 0
                                    ? 'text-[#C8F542]'
                                    : idx < 3
                                      ? 'text-[#FF6B35]'
                                      : undefined
                                }
                              >
                                #{idx + 1}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3">
                              <div className="flex flex-wrap items-baseline gap-x-1.5">
                                <span className="font-semibold text-[#F4F7F2]">
                                  {entry.playerName}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {entry.isGuest ? '· Guest' : '· Verified'}
                                </span>
                              </div>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono font-bold tabular-nums text-[#C8F542]">
                              {entry.score.toLocaleString()}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-200">
                              {entry.mosquitoesKilled}
                            </td>
                            <td className="hidden py-2.5 pr-3 text-right font-mono tabular-nums text-slate-300 sm:table-cell">
                              {Math.round(entry.accuracy)}%
                            </td>
                            <td className="hidden py-2.5 pr-3 text-right font-mono tabular-nums text-[#FF6B35] sm:table-cell">
                              {entry.highestCombo}x
                            </td>
                            <td className="py-2.5 text-right text-[11px] text-slate-400 whitespace-nowrap">
                              {formatDifficulty(entry.difficulty)}
                              {entry.savedAt ? ` · ${formatRelativeDate(entry.savedAt)}` : ''}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LifetimeMetric({
  label,
  value,
  accent = 'text-[#F4F7F2]',
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium text-slate-400">{label}</div>
      <div className={`mt-0.5 font-mono text-base font-bold tabular-nums ${accent}`}>
        {value}
      </div>
    </div>
  );
}

function GoogleGIcon() {
  return (
    <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#0E1310"
        d="M21.35 11.1H12v2.92h5.35c-.23 1.52-1.74 4.46-5.35 4.46-3.22 0-5.85-2.67-5.85-5.98S8.78 6.52 12 6.52c1.83 0 3.06.78 3.76 1.45l2.56-2.48C16.68 3.96 14.55 3 12 3 7.03 3 3 7.03 3 12s4.03 9 9 9c5.19 0 8.63-3.65 8.63-8.79 0-.59-.07-1.04-.15-1.11h-.13z"
      />
    </svg>
  );
}
