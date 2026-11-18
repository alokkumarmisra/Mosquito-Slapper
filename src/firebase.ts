import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { DifficultyLevel } from './types/game';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export { firebaseConfig };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function formatFirebaseUserError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (raw.includes("Free daily read units per project")) {
    const upgradeUrl = `https://console.firebase.google.com/project/${firebaseConfig.projectId}/firestore/databases/${firebaseConfig.firestoreDatabaseId}/data?openUpgradeDialog=true`;
    return `Firestore daily free-tier read quota reached. Quota resets tomorrow, or upgrade in Firebase Console (${upgradeUrl}). You can still play immediately in Guest Mode.`;
  }
  if (raw.includes('Quota exceeded') || raw.includes('resource-exhausted')) {
    return 'Cloud database quota exceeded for today. Quota resets tomorrow; Guest Mode remains 100% playable offline.';
  }
  if (raw.includes('auth/popup-closed-by-user')) {
    return 'Google sign-in window was closed. You can try again or continue playing as Guest.';
  }
  if (raw.includes('auth/popup-blocked')) {
    return 'Sign-in popup was blocked by your browser. Allow popups for this site or continue playing as Guest.';
  }
  if (raw.includes('auth/cancelled-popup-request')) {
    return 'Sign-in request was cancelled. Try clicking Sign in with Google again.';
  }
  if (raw.includes('auth/network-request-failed')) {
    return 'Network unavailable for Google sign-in. Guest Mode continues to work offline.';
  }
  if (raw.includes('Missing or insufficient permissions')) {
    return 'Cloud permission check failed. Please sign out and sign in again with a verified Google account.';
  }
  return raw;
}

// Blueprint-synchronized constants (verbatim match with firebase-blueprint.json & firestore.rules)
export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_-]+$/,
  ID_MAX_LENGTH: 128,
  DISPLAY_NAME_MIN: 1,
  DISPLAY_NAME_MAX: 32,
  PHOTO_URL_MAX: 512,
  ACHIEVEMENTS_MAX_ITEMS: 12,
  ACHIEVEMENT_ITEM_MAX: 48,
  GAMES_MAX: 1_000_000,
  BEST_SCORE_MAX: 10_000_000,
  TOTAL_KILLS_MAX: 10_000_000,
  TOTAL_SCORE_MAX: 100_000_000,
  MATCH_KILLS_MAX: 10_000,
  COMBO_MAX: 10_000,
  ELAPSED_MAX: 86_400,
  LEADERBOARD_QUERY_LIMIT: 50,
} as const;

export function isValidDocId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length >= 1 &&
    id.length <= BLUEPRINT_LIMITS.ID_MAX_LENGTH &&
    BLUEPRINT_LIMITS.ID_PATTERN.test(id)
  );
}

export function sanitizeDisplayName(raw: string | null | undefined, fallback = 'Player'): string {
  const cleaned = (raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, BLUEPRINT_LIMITS.DISPLAY_NAME_MAX);
  return cleaned.length >= BLUEPRINT_LIMITS.DISPLAY_NAME_MIN ? cleaned : fallback;
}

export function sanitizePhotoURL(raw: string | null | undefined): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('https://') && !trimmed.startsWith('http://')) return '';
  return trimmed.slice(0, BLUEPRINT_LIMITS.PHOTO_URL_MAX);
}

export function sanitizeAchievements(items: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const item of items) {
    if (typeof item !== 'string') continue;
    const cleaned = item.replace(/[\r\n\t]+/g, ' ').trim().slice(0, BLUEPRINT_LIMITS.ACHIEVEMENT_ITEM_MAX);
    if (cleaned) unique.add(cleaned);
    if (unique.size >= BLUEPRINT_LIMITS.ACHIEVEMENTS_MAX_ITEMS) break;
  }
  return Array.from(unique);
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampNum(value: number, min: number, max: number, decimals = 2): number {
  if (!Number.isFinite(value)) return min;
  const factor = Math.pow(10, decimals);
  return Math.min(max, Math.max(min, Math.round(value * factor) / factor));
}

export function normalizeDifficulty(raw: string | undefined): DifficultyLevel {
  if (
    raw === DifficultyLevel.EASY ||
    raw === DifficultyLevel.NORMAL ||
    raw === DifficultyLevel.HARD ||
    raw === DifficultyLevel.EXTREME
  ) {
    return raw;
  }
  return DifficultyLevel.NORMAL;
}

// Validate Firestore connectivity once on startup (per Firebase SDK guidelines)
async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();
