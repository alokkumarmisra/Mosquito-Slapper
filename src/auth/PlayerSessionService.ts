import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  BLUEPRINT_LIMITS,
  clampInt,
  clampNum,
  db,
  formatFirebaseUserError,
  googleProvider,
  handleFirestoreError,
  isValidDocId,
  normalizeDifficulty,
  OperationType,
  sanitizeAchievements,
  sanitizeDisplayName,
  sanitizePhotoURL,
} from '../firebase';
import {
  DifficultyLevel,
  GameSettings,
  GameStats,
  GuestProfile,
  LeaderboardEntry,
  PlayerAccount,
  PlayerLifetimeStats,
} from '../types/game';

const GUEST_STORAGE_KEY = 'ai_mosquito_slapper_guest_v1';

export function createEmptyLifetimeStats(): PlayerLifetimeStats {
  return {
    gamesPlayed: 0,
    bestScore: 0,
    totalKills: 0,
    totalScore: 0,
    highestCombo: 0,
    bestAccuracy: 0,
    swarmsCleared: 0,
  };
}

function generateGuestId(): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `guest-${randomPart}`;
}

export function createDefaultGuestProfile(): GuestProfile {
  return {
    guestId: generateGuestId(),
    displayName: 'Guest',
    stats: createEmptyLifetimeStats(),
    unlockedAchievements: [],
    recentMatches: [],
  };
}

export function loadGuestProfile(): GuestProfile {
  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    if (!raw) {
      const fresh = createDefaultGuestProfile();
      saveGuestProfile(fresh);
      return fresh;
    }
    const parsed = JSON.parse(raw) as Partial<GuestProfile>;
    const defaults = createDefaultGuestProfile();
    return {
      guestId: typeof parsed.guestId === 'string' && parsed.guestId ? parsed.guestId : defaults.guestId,
      displayName: sanitizeDisplayName(parsed.displayName, 'Guest'),
      stats: {
        ...defaults.stats,
        ...(parsed.stats ?? {}),
      },
      unlockedAchievements: Array.isArray(parsed.unlockedAchievements)
        ? sanitizeAchievements(parsed.unlockedAchievements)
        : [],
      recentMatches: Array.isArray(parsed.recentMatches)
        ? (parsed.recentMatches as LeaderboardEntry[]).slice(0, 25)
        : [],
    };
  } catch {
    return createDefaultGuestProfile();
  }
}

export function saveGuestProfile(profile: GuestProfile): void {
  try {
    window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota errors
  }
}

export function updateGuestDisplayName(profile: GuestProfile, nextName: string): GuestProfile {
  const next: GuestProfile = {
    ...profile,
    displayName: sanitizeDisplayName(nextName, 'Guest'),
  };
  saveGuestProfile(next);
  return next;
}

export function recordGuestMatch(
  profile: GuestProfile,
  stats: GameStats,
  difficulty: DifficultyLevel,
  swarmCleared: boolean,
  unlockedAchievements: string[],
): GuestProfile {
  const accuracy = clampNum(stats.accuracy, 0, 100, 1);
  const elapsedSeconds = clampNum(stats.elapsedSeconds, 0, BLUEPRINT_LIMITS.ELAPSED_MAX, 1);
  const score = clampInt(stats.score, 0, BLUEPRINT_LIMITS.BEST_SCORE_MAX);
  const kills = clampInt(stats.mosquitoesKilled, 0, BLUEPRINT_LIMITS.MATCH_KILLS_MAX);
  const highestCombo = clampInt(stats.highestCombo, 0, BLUEPRINT_LIMITS.COMBO_MAX);

  const entry: LeaderboardEntry = {
    id: `local-${Date.now()}`,
    playerName: profile.displayName || 'Guest',
    isGuest: true,
    score,
    mosquitoesKilled: kills,
    totalMosquitoesSpawned: stats.totalMosquitoesSpawned,
    missedAttacks: stats.missedAttacks,
    accuracy,
    highestCombo,
    difficulty,
    swarmCleared,
    elapsedSeconds,
    savedAt: new Date().toISOString(),
  };

  const mergedAchievements = sanitizeAchievements([
    ...profile.unlockedAchievements,
    ...unlockedAchievements,
  ]);

  const next: GuestProfile = {
    ...profile,
    stats: {
      gamesPlayed: clampInt(profile.stats.gamesPlayed + 1, 0, BLUEPRINT_LIMITS.GAMES_MAX),
      bestScore: Math.max(profile.stats.bestScore, score),
      totalKills: clampInt(profile.stats.totalKills + kills, 0, BLUEPRINT_LIMITS.TOTAL_KILLS_MAX),
      totalScore: clampInt(profile.stats.totalScore + score, 0, BLUEPRINT_LIMITS.TOTAL_SCORE_MAX),
      highestCombo: Math.max(profile.stats.highestCombo, highestCombo),
      bestAccuracy: Math.max(profile.stats.bestAccuracy, accuracy),
      swarmsCleared: clampInt(
        profile.stats.swarmsCleared + (swarmCleared ? 1 : 0),
        0,
        BLUEPRINT_LIMITS.GAMES_MAX,
      ),
    },
    unlockedAchievements: mergedAchievements,
    recentMatches: [entry, ...profile.recentMatches].slice(0, 25),
  };

  saveGuestProfile(next);
  return next;
}

export function clearGuestStats(profile: GuestProfile): GuestProfile {
  const next: GuestProfile = {
    ...profile,
    stats: createEmptyLifetimeStats(),
    unlockedAchievements: [],
    recentMatches: [],
  };
  saveGuestProfile(next);
  return next;
}

// === Firebase Authentication & Cloud Firestore Helpers ===

function deriveHandleFromFirebaseUser(fbUser: FirebaseUser | null, displayName: string): string {
  const email = fbUser?.email || '';
  if (email.includes('@')) {
    return email.split('@')[0].replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 24) || 'google';
  }
  return displayName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'player';
}

function timestampToIso(val: unknown): string {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (val && typeof val === 'object' && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
    try {
      return (val as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return new Date().toISOString();
    }
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function mapDocToPlayerAccount(
  uid: string,
  data: Record<string, unknown>,
  fbUser: FirebaseUser | null,
): PlayerAccount {
  const displayName = sanitizeDisplayName(
    typeof data.displayName === 'string' ? data.displayName : fbUser?.displayName,
    'Player',
  );
  return {
    id: uid,
    username: deriveHandleFromFirebaseUser(fbUser, displayName),
    displayName,
    photoURL: sanitizePhotoURL(typeof data.photoURL === 'string' ? data.photoURL : fbUser?.photoURL),
    email: fbUser?.email ?? null,
    createdAt: timestampToIso(data.createdAt),
    stats: {
      gamesPlayed: clampInt(Number(data.gamesPlayed ?? 0), 0, BLUEPRINT_LIMITS.GAMES_MAX),
      bestScore: clampInt(Number(data.bestScore ?? 0), 0, BLUEPRINT_LIMITS.BEST_SCORE_MAX),
      totalKills: clampInt(Number(data.totalKills ?? 0), 0, BLUEPRINT_LIMITS.TOTAL_KILLS_MAX),
      totalScore: clampInt(Number(data.totalScore ?? 0), 0, BLUEPRINT_LIMITS.TOTAL_SCORE_MAX),
      highestCombo: clampInt(Number(data.highestCombo ?? 0), 0, BLUEPRINT_LIMITS.COMBO_MAX),
      bestAccuracy: clampNum(Number(data.bestAccuracy ?? 0), 0, 100, 1),
      swarmsCleared: clampInt(Number(data.swarmsCleared ?? 0), 0, BLUEPRINT_LIMITS.GAMES_MAX),
    },
    unlockedAchievements: Array.isArray(data.unlockedAchievements)
      ? sanitizeAchievements(data.unlockedAchievements.filter((v): v is string => typeof v === 'string'))
      : [],
  };
}

function buildMergedStats(
  base: PlayerLifetimeStats,
  guestStats?: PlayerLifetimeStats | null,
): PlayerLifetimeStats {
  if (!guestStats || guestStats.gamesPlayed <= 0) return { ...base };
  return {
    gamesPlayed: clampInt(base.gamesPlayed + guestStats.gamesPlayed, 0, BLUEPRINT_LIMITS.GAMES_MAX),
    bestScore: Math.max(base.bestScore, clampInt(guestStats.bestScore, 0, BLUEPRINT_LIMITS.BEST_SCORE_MAX)),
    totalKills: clampInt(base.totalKills + guestStats.totalKills, 0, BLUEPRINT_LIMITS.TOTAL_KILLS_MAX),
    totalScore: clampInt(base.totalScore + guestStats.totalScore, 0, BLUEPRINT_LIMITS.TOTAL_SCORE_MAX),
    highestCombo: Math.max(base.highestCombo, clampInt(guestStats.highestCombo, 0, BLUEPRINT_LIMITS.COMBO_MAX)),
    bestAccuracy: Math.max(base.bestAccuracy, clampNum(guestStats.bestAccuracy, 0, 100, 1)),
    swarmsCleared: clampInt(base.swarmsCleared + guestStats.swarmsCleared, 0, BLUEPRINT_LIMITS.GAMES_MAX),
  };
}

export function subscribeFirebaseAuth(
  callback: (fbUser: FirebaseUser | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}

export async function ensureFirestoreUserProfile(
  fbUser: FirebaseUser,
  guestImport?: { stats: PlayerLifetimeStats; unlockedAchievements: string[] } | null,
): Promise<PlayerAccount> {
  const uid = fbUser.uid;
  if (!isValidDocId(uid)) {
    throw new Error('Invalid user identifier.');
  }
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  let snap;
  try {
    snap = await getDoc(userRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, userPath);
  }

  const defaultDisplayName = sanitizeDisplayName(fbUser.displayName, 'Player');
  const defaultPhotoURL = sanitizePhotoURL(fbUser.photoURL);

  if (!snap.exists()) {
    const mergedStats = buildMergedStats(createEmptyLifetimeStats(), guestImport?.stats);
    const mergedAch = sanitizeAchievements(guestImport?.unlockedAchievements ?? []);

    const newProfilePayload = {
      uid,
      displayName: defaultDisplayName,
      photoURL: defaultPhotoURL,
      gamesPlayed: mergedStats.gamesPlayed,
      bestScore: mergedStats.bestScore,
      totalKills: mergedStats.totalKills,
      totalScore: mergedStats.totalScore,
      highestCombo: mergedStats.highestCombo,
      bestAccuracy: mergedStats.bestAccuracy,
      swarmsCleared: mergedStats.swarmsCleared,
      unlockedAchievements: mergedAch,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    try {
      await setDoc(userRef, newProfilePayload);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, userPath);
    }

    return {
      id: uid,
      username: deriveHandleFromFirebaseUser(fbUser, defaultDisplayName),
      displayName: defaultDisplayName,
      photoURL: defaultPhotoURL,
      email: fbUser.email ?? null,
      createdAt: new Date().toISOString(),
      stats: mergedStats,
      unlockedAchievements: mergedAch,
    };
  }

  const existingAccount = mapDocToPlayerAccount(uid, snap.data() as Record<string, unknown>, fbUser);

  if (guestImport && guestImport.stats.gamesPlayed > 0) {
    const mergedStats = buildMergedStats(existingAccount.stats, guestImport.stats);
    const mergedAch = sanitizeAchievements([
      ...existingAccount.unlockedAchievements,
      ...guestImport.unlockedAchievements,
    ]);

    try {
      await updateDoc(userRef, {
        gamesPlayed: mergedStats.gamesPlayed,
        bestScore: mergedStats.bestScore,
        totalKills: mergedStats.totalKills,
        totalScore: mergedStats.totalScore,
        highestCombo: mergedStats.highestCombo,
        bestAccuracy: mergedStats.bestAccuracy,
        swarmsCleared: mergedStats.swarmsCleared,
        unlockedAchievements: mergedAch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    }

    return {
      ...existingAccount,
      stats: mergedStats,
      unlockedAchievements: mergedAch,
    };
  }

  return existingAccount;
}

export function subscribeFirestoreUserProfile(
  fbUser: FirebaseUser,
  onProfile: (account: PlayerAccount) => void,
  onError?: (friendlyMsg: string) => void,
): () => void {
  const uid = fbUser.uid;
  const userPath = `users/${uid}`;
  const userRef = doc(db, 'users', uid);

  return onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) return;
      onProfile(mapDocToPlayerAccount(uid, snap.data() as Record<string, unknown>, fbUser));
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, userPath);
      } catch (wrapped) {
        onError?.(formatFirebaseUserError(wrapped));
      }
    },
  );
}

export async function signInWithGoogleAccount(
  guestImport?: { stats: PlayerLifetimeStats; unlockedAchievements: string[] } | null,
): Promise<{
  ok: boolean;
  account: PlayerAccount | null;
  savedPreferences?: Partial<GameSettings> | null;
  error?: string;
}> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const fbUser = result.user;
    const account = await ensureFirestoreUserProfile(fbUser, guestImport);
    const savedPreferences = await loadFirestoreUserPreferences(fbUser.uid).catch(() => null);
    return {
      ok: true,
      account,
      savedPreferences,
    };
  } catch (error) {
    return {
      ok: false,
      account: null,
      error: formatFirebaseUserError(error),
    };
  }
}

export async function signOutGoogleAccount(): Promise<void> {
  await signOut(auth);
}

export async function updateFirestoreDisplayName(
  uid: string,
  nextName: string,
): Promise<{ ok: boolean; displayName?: string; error?: string }> {
  const cleaned = sanitizeDisplayName(nextName, '');
  if (!cleaned) {
    return { ok: false, error: 'Display name cannot be empty.' };
  }
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: cleaned,
      updatedAt: serverTimestamp(),
    });
    return { ok: true, displayName: cleaned };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.UPDATE, userPath);
    } catch (wrapped) {
      return { ok: false, error: formatFirebaseUserError(wrapped) };
    }
  }
}

export async function importGuestProgressToCloud(
  fbUser: FirebaseUser,
  guestProfile: GuestProfile,
): Promise<{ ok: boolean; account: PlayerAccount | null; error?: string }> {
  if (guestProfile.stats.gamesPlayed <= 0) {
    return { ok: false, account: null, error: 'No local guest matches to import.' };
  }
  try {
    const updated = await ensureFirestoreUserProfile(fbUser, {
      stats: guestProfile.stats,
      unlockedAchievements: guestProfile.unlockedAchievements,
    });
    return { ok: true, account: updated };
  } catch (error) {
    return { ok: false, account: null, error: formatFirebaseUserError(error) };
  }
}

export async function loadFirestoreUserPreferences(
  uid: string,
): Promise<Partial<GameSettings> | null> {
  if (!isValidDocId(uid)) return null;
  const prefPath = `users/${uid}/preferences/default`;
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'preferences', 'default'));
    if (!snap.exists()) return null;
    const d = snap.data() as Record<string, unknown>;
    return {
      difficulty: normalizeDifficulty(typeof d.difficulty === 'string' ? d.difficulty : undefined),
      autoDifficulty: Boolean(d.autoDifficulty),
      initialMosquitoCount: clampInt(Number(d.initialMosquitoCount ?? 10), 1, 50),
      mosquitoSpeedMultiplier: clampNum(Number(d.mosquitoSpeedMultiplier ?? 1), 0.5, 2.0, 2),
      sfxVolume: clampNum(Number(d.sfxVolume ?? 0.8), 0, 1, 2),
      buzzVolume: clampNum(Number(d.buzzVolume ?? 0.35), 0, 1, 2),
      muted: Boolean(d.muted),
      enableMissVoice: Boolean(d.enableMissVoice),
      showLandmarks: Boolean(d.showLandmarks),
      showHandPointer: Boolean(d.showHandPointer),
      showFaceZones: Boolean(d.showFaceZones),
      enableFaceLanding: Boolean(d.enableFaceLanding),
      mirrorCamera: Boolean(d.mirrorCamera),
      practiceMode: Boolean(d.practiceMode),
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.GET, prefPath);
    } catch {
      return null;
    }
  }
}

export async function saveFirestoreUserPreferences(
  uid: string,
  settings: GameSettings,
): Promise<void> {
  if (!isValidDocId(uid)) return;
  const prefPath = `users/${uid}/preferences/default`;
  const payload = {
    uid,
    difficulty: normalizeDifficulty(settings.difficulty),
    autoDifficulty: Boolean(settings.autoDifficulty),
    initialMosquitoCount: clampInt(settings.initialMosquitoCount, 1, 50),
    mosquitoSpeedMultiplier: clampNum(settings.mosquitoSpeedMultiplier, 0.5, 2.0, 2),
    sfxVolume: clampNum(settings.sfxVolume, 0, 1, 2),
    buzzVolume: clampNum(settings.buzzVolume, 0, 1, 2),
    muted: Boolean(settings.muted),
    enableMissVoice: Boolean(settings.enableMissVoice),
    showLandmarks: Boolean(settings.showLandmarks),
    showHandPointer: Boolean(settings.showHandPointer),
    showFaceZones: Boolean(settings.showFaceZones),
    enableFaceLanding: Boolean(settings.enableFaceLanding),
    mirrorCamera: Boolean(settings.mirrorCamera),
    practiceMode: Boolean(settings.practiceMode),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'users', uid, 'preferences', 'default'), payload);
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, prefPath);
    } catch {
      // Non-fatal background preferences sync
    }
  }
}

export async function recordSignedInMatchToFirestore(
  fbUser: FirebaseUser,
  currentAccount: PlayerAccount,
  stats: GameStats,
  difficulty: DifficultyLevel,
  swarmCleared: boolean,
  unlockedAchievements: string[],
): Promise<{ ok: boolean; message: string; account?: PlayerAccount }> {
  const uid = fbUser.uid;
  const score = clampInt(stats.score, 0, BLUEPRINT_LIMITS.BEST_SCORE_MAX);
  const kills = clampInt(stats.mosquitoesKilled, 0, BLUEPRINT_LIMITS.MATCH_KILLS_MAX);
  const accuracy = clampNum(stats.accuracy, 0, 100, 1);
  const highestCombo = clampInt(stats.highestCombo, 0, BLUEPRINT_LIMITS.COMBO_MAX);
  const elapsedSeconds = clampNum(stats.elapsedSeconds, 0, BLUEPRINT_LIMITS.ELAPSED_MAX, 1);
  const safeDifficulty = normalizeDifficulty(difficulty);
  const safePlayerName = sanitizeDisplayName(currentAccount.displayName, 'Player');

  const nextStats: PlayerLifetimeStats = {
    gamesPlayed: clampInt(currentAccount.stats.gamesPlayed + 1, 0, BLUEPRINT_LIMITS.GAMES_MAX),
    bestScore: Math.max(currentAccount.stats.bestScore, score),
    totalKills: clampInt(currentAccount.stats.totalKills + kills, 0, BLUEPRINT_LIMITS.TOTAL_KILLS_MAX),
    totalScore: clampInt(currentAccount.stats.totalScore + score, 0, BLUEPRINT_LIMITS.TOTAL_SCORE_MAX),
    highestCombo: Math.max(currentAccount.stats.highestCombo, highestCombo),
    bestAccuracy: Math.max(currentAccount.stats.bestAccuracy, accuracy),
    swarmsCleared: clampInt(
      currentAccount.stats.swarmsCleared + (swarmCleared ? 1 : 0),
      0,
      BLUEPRINT_LIMITS.GAMES_MAX,
    ),
  };

  const mergedAchievements = sanitizeAchievements([
    ...currentAccount.unlockedAchievements,
    ...unlockedAchievements,
  ]);

  const randSuffix = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 8) || 'match';
  const scoreId = `score_${Date.now()}_${randSuffix}`;
  const userRef = doc(db, 'users', uid);
  const scoreRef = doc(db, 'leaderboard', scoreId);
  const batchPath = `users/${uid},leaderboard/${scoreId}`;

  try {
    const batch = writeBatch(db);
    batch.update(userRef, {
      gamesPlayed: nextStats.gamesPlayed,
      bestScore: nextStats.bestScore,
      totalKills: nextStats.totalKills,
      totalScore: nextStats.totalScore,
      highestCombo: nextStats.highestCombo,
      bestAccuracy: nextStats.bestAccuracy,
      swarmsCleared: nextStats.swarmsCleared,
      unlockedAchievements: mergedAchievements,
      updatedAt: serverTimestamp(),
    });
    batch.set(scoreRef, {
      uid,
      playerName: safePlayerName,
      score,
      mosquitoesKilled: kills,
      accuracy,
      highestCombo,
      difficulty: safeDifficulty,
      swarmCleared: Boolean(swarmCleared),
      elapsedSeconds,
      visibility: 'public',
      createdAt: serverTimestamp(),
    });
    await batch.commit();

    return {
      ok: true,
      message: `Synced to Firebase Cloud Leaderboard as ${safePlayerName}.`,
      account: {
        ...currentAccount,
        stats: nextStats,
        unlockedAchievements: mergedAchievements,
      },
    };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, batchPath);
    } catch (wrapped) {
      return {
        ok: false,
        message: formatFirebaseUserError(wrapped),
      };
    }
  }
}

/**
 * Fetches publicly visible Cloud Leaderboard scores from Firestore.
 * Works for BOTH unauthenticated Guest players and signed-in Google players.
 * Queries with where('visibility', '==', 'public') + limit(<= 50) (zero composite index required).
 */
export async function fetchCloudLeaderboard(limitCount = 40): Promise<{
  ok: boolean;
  entries: LeaderboardEntry[];
  error?: string;
}> {
  const safeLimit = clampInt(limitCount, 1, BLUEPRINT_LIMITS.LEADERBOARD_QUERY_LIMIT);
  const colPath = 'leaderboard';

  try {
    const q = query(
      collection(db, colPath),
      where('visibility', '==', 'public'),
      limit(safeLimit),
    );
    const snap = await getDocs(q);
    const entries: LeaderboardEntry[] = [];

    snap.forEach((docSnap) => {
      const d = docSnap.data() as Record<string, unknown>;
      entries.push({
        id: docSnap.id,
        playerName: sanitizeDisplayName(typeof d.playerName === 'string' ? d.playerName : 'Player', 'Player'),
        userId: typeof d.uid === 'string' ? d.uid : undefined,
        isGuest: false,
        score: clampInt(Number(d.score ?? 0), 0, BLUEPRINT_LIMITS.BEST_SCORE_MAX),
        mosquitoesKilled: clampInt(Number(d.mosquitoesKilled ?? 0), 0, BLUEPRINT_LIMITS.MATCH_KILLS_MAX),
        accuracy: clampNum(Number(d.accuracy ?? 0), 0, 100, 1),
        highestCombo: clampInt(Number(d.highestCombo ?? 0), 0, BLUEPRINT_LIMITS.COMBO_MAX),
        difficulty: normalizeDifficulty(typeof d.difficulty === 'string' ? d.difficulty : undefined),
        swarmCleared: Boolean(d.swarmCleared),
        elapsedSeconds: clampNum(Number(d.elapsedSeconds ?? 0), 0, BLUEPRINT_LIMITS.ELAPSED_MAX, 1),
        savedAt: timestampToIso(d.createdAt),
      });
    });

    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.highestCombo - a.highestCombo;
    });

    return { ok: true, entries };
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.LIST, colPath);
    } catch (wrapped) {
      return {
        ok: false,
        entries: [],
        error: formatFirebaseUserError(wrapped),
      };
    }
  }
}
