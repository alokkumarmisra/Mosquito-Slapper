/**
 * Phase 0 Payload-First Security TDD specification for AI Mosquito Slapper Firestore Rules.
 * Verifies all 12 "Dirty Dozen" adversarial payloads return PERMISSION_DENIED and
 * legitimate Guest read + Verified Owner write flows succeed.
 *
 * Run against the Firebase Emulator Suite (`@firebase/rules-unit-testing`) when available.
 */

export interface SecurityTestCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  queryLimit?: number;
  expected: 'ALLOW' | 'PERMISSION_DENIED';
}

const VALID_PROFILE_BASE = {
  uid: 'user_alpha',
  displayName: 'Alpha Slapper',
  photoURL: 'https://lh3.googleusercontent.com/a/example',
  gamesPlayed: 1,
  bestScore: 240,
  totalKills: 12,
  totalScore: 240,
  highestCombo: 5,
  bestAccuracy: 85.5,
  swarmsCleared: 1,
  unlockedAchievements: ['First Blood', 'Mosquito Hunter'],
  createdAt: '__SERVER_TIMESTAMP__',
  updatedAt: '__SERVER_TIMESTAMP__',
};

const VALID_LEADERBOARD_BASE = {
  uid: 'user_alpha',
  playerName: 'Alpha Slapper',
  score: 240,
  mosquitoesKilled: 12,
  accuracy: 85.5,
  highestCombo: 5,
  difficulty: 'NORMAL',
  swarmCleared: true,
  elapsedSeconds: 42.5,
  visibility: 'public',
  createdAt: '__SERVER_TIMESTAMP__',
};

export const DIRTY_DOZEN_SECURITY_TESTS: SecurityTestCase[] = [
  {
    id: 1,
    name: 'Unauthenticated Guest cannot create a Firestore profile',
    operation: 'create',
    path: '/users/guest123',
    auth: null,
    payload: { ...VALID_PROFILE_BASE, uid: 'guest123' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified email account cannot write profile',
    operation: 'create',
    path: '/users/user_alpha',
    auth: { uid: 'user_alpha', email_verified: false },
    payload: VALID_PROFILE_BASE,
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Identity spoofing: user_alpha cannot create user_beta profile',
    operation: 'create',
    path: '/users/user_beta',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: { ...VALID_PROFILE_BASE, uid: 'user_beta' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Cross-user isolation: user_alpha cannot read user_beta profile',
    operation: 'get',
    path: '/users/user_beta',
    auth: { uid: 'user_alpha', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Blanket collection scrape on /users is blocked',
    operation: 'list',
    path: '/users',
    auth: { uid: 'user_alpha', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Shadow field injection (isAdmin: true) is rejected',
    operation: 'create',
    path: '/users/user_alpha',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: { ...VALID_PROFILE_BASE, isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable field tampering (mutating uid or createdAt on update) is rejected',
    operation: 'update',
    path: '/users/user_alpha',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: { ...VALID_PROFILE_BASE, uid: 'user_hijacked' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Value poisoning: oversized displayName and >12 achievements are rejected',
    operation: 'update',
    path: '/users/user_alpha',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: {
      ...VALID_PROFILE_BASE,
      displayName: 'A'.repeat(120),
      unlockedAchievements: Array.from({ length: 15 }, (_, i) => `Badge ${i}`),
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Client-forged createdAt timestamp on leaderboard is rejected',
    operation: 'create',
    path: '/leaderboard/score_001',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: { ...VALID_LEADERBOARD_BASE, createdAt: '2020-01-01T00:00:00.000Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Orphaned preferences write without existing parent user profile is rejected',
    operation: 'create',
    path: '/users/user_orphan/preferences/default',
    auth: { uid: 'user_orphan', email_verified: true },
    payload: {
      uid: 'user_orphan',
      difficulty: 'NORMAL',
      autoDifficulty: false,
      initialMosquitoCount: 10,
      mosquitoSpeedMultiplier: 1.0,
      sfxVolume: 0.8,
      buzzVolume: 0.35,
      muted: false,
      enableMissVoice: false,
      showLandmarks: true,
      showHandPointer: true,
      showFaceZones: true,
      enableFaceLanding: true,
      mirrorCamera: true,
      practiceMode: false,
      updatedAt: '__SERVER_TIMESTAMP__',
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Leaderboard score updates are forbidden (immutable entries)',
    operation: 'update',
    path: '/leaderboard/score_001',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: { ...VALID_LEADERBOARD_BASE, score: 999999 },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'ID poisoning and unbounded list queries on /leaderboard are rejected',
    operation: 'create',
    path: '/leaderboard/bad$id with spaces',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: VALID_LEADERBOARD_BASE,
    queryLimit: 500,
    expected: 'PERMISSION_DENIED',
  },
];

export const POSITIVE_ACCESS_TESTS: SecurityTestCase[] = [
  {
    id: 101,
    name: 'Unauthenticated Guest can read bounded public leaderboard entries',
    operation: 'list',
    path: '/leaderboard',
    auth: null,
    queryLimit: 30,
    expected: 'ALLOW',
  },
  {
    id: 102,
    name: 'Verified signed-in owner can create and read their own profile',
    operation: 'create',
    path: '/users/user_alpha',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: VALID_PROFILE_BASE,
    expected: 'ALLOW',
  },
  {
    id: 103,
    name: 'Verified signed-in owner can post an immutable public leaderboard score',
    operation: 'create',
    path: '/leaderboard/score_valid_1',
    auth: { uid: 'user_alpha', email_verified: true },
    payload: VALID_LEADERBOARD_BASE,
    expected: 'ALLOW',
  },
];
