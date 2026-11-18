# Firestore Security Specification — AI Mosquito Slapper

## 1. Data Invariants

1. **Zero-Friction Guest Play & Zero PII Exposure**:
   - Guest players (unauthenticated, `request.auth == null`) never need to write to Firestore to play 100% of the game; they can read explicitly public leaderboard documents (`visibility == 'public'`) with a bounded query limit (`<= 50`) while all local guest progression stays in `localStorage`.
   - No PII (`email`, `phone`, `address`) is stored in any Firestore collection.
2. **Strict Owner Isolation (`/users/{userId}`)**:
   - A `PlayerProfile` can only be read, created, updated, or deleted by the verified authenticated user whose `request.auth.uid == userId`.
   - Blanket collection listing on `/users` is strictly denied (`allow list: if false`).
   - `uid` and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must strictly equal `request.time`.
3. **Master Gate Relational Integrity (`/users/{userId}/preferences/{prefId}`)**:
   - Preferences can only be written if the parent `/users/{userId}` document exists (`exists(...)`) and belongs to `request.auth.uid == userId`.
   - `prefId` must match `isValidId(prefId)` (`^[a-zA-Z0-9_\-]+$`, max 128 chars).
4. **Immutable Verified Leaderboard Entries (`/leaderboard/{scoreId}`)**:
   - Only verified authenticated users (`request.auth.token.email_verified == true`) with an existing parent profile (`/users/{uid}`) may create a leaderboard entry with `incoming().uid == request.auth.uid`, `visibility == 'public'`, and `createdAt == request.time`.
   - Leaderboard entries are immutable (`allow update: if false`) to prevent retroactive score tampering.
   - Only the owning player may delete their own leaderboard entry.
   - `allow list` strictly requires `resource.data.visibility == 'public' && request.query.limit <= 50`.
5. **Strict Volumetric & Schema Enforcement**:
   - Every string checks `.size()` bounds matching `firebase-blueprint.json` (`displayName` 1..32, `photoURL` <= 512, `uid` 1..128 + regex).
   - `unlockedAchievements` is strictly bounded to `<= 12` elements with type and length validation.
   - Every create checks `hasAll` + `hasOnly`; every update begins with `isValid[Entity](incoming())` and restricts mutated keys with `affectedKeys().hasOnly(...)`.

## 2. The "Dirty Dozen" Adversarial Payloads (All Must Return `PERMISSION_DENIED`)

1. **Unauthenticated Profile Creation (Guest Write Attempt)**:
   - Target: `CREATE /users/guest123` with `auth = null`.
   - Payload: `{ "uid": "guest123", "displayName": "Hacker", "photoURL": "", "gamesPlayed": 1, "bestScore": 999, "totalKills": 10, "totalScore": 999, "highestCombo": 5, "bestAccuracy": 90, "swarmsCleared": 1, "unlockedAchievements": [], "createdAt": "<request.time>", "updatedAt": "<request.time>" }`
2. **Unverified Email Write Spoof**:
   - Target: `CREATE /users/userA` with `auth = { uid: "userA", token: { email_verified: false } }`.
   - Payload: Valid `PlayerProfile` shape, but `email_verified` is `false`.
3. **Cross-User Profile Hijack (Identity Spoofing)**:
   - Target: `CREATE /users/userB` as verified `userA` with `{ "uid": "userB", ... }`.
4. **Cross-User Profile Read (PII / Privacy Leak)**:
   - Target: `GET /users/userB` as verified `userA`.
5. **Blanket User Directory Scrape**:
   - Target: `LIST /users` as verified `userA`.
6. **Shadow Field Injection on Profile Create**:
   - Target: `CREATE /users/userA` as verified `userA` including ghost field `"isAdmin": true` or `"role": "admin"`.
7. **Immutable Field Mutation (`createdAt` / `uid` tampering on Update)**:
   - Target: `UPDATE /users/userA` as verified `userA` changing `createdAt` or `uid`.
8. **Value Poisoning / Volumetric Overflow on Update**:
   - Target: `UPDATE /users/userA` as verified `userA` setting `displayName` to a 500-character string or `unlockedAchievements` to a 25-item array or `bestScore` to `-50` / `"9999"`.
9. **Client-Forged Timestamp**:
   - Target: `CREATE /leaderboard/score_1` as verified `userA` with `createdAt` set to a past client date instead of `request.time`.
10. **Orphaned Preferences Write (Bypassing Master Gate)**:
    - Target: `CREATE /users/userA/preferences/default` before `/users/userA` exists.
11. **Leaderboard Retroactive Score Tampering**:
    - Target: `UPDATE /leaderboard/score_1` as verified owner `userA` attempting to change `score` from `120` to `999999`.
12. **ID Poisoning & Unbounded Leaderboard Scrape**:
    - Target A: `CREATE /leaderboard/bad$id..with spaces` as verified `userA`.
    - Target B: `LIST /leaderboard` without `visibility == 'public'` filter or with `limit(500)` exceeding `50`.
