import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const CONFIG_DIR = path.resolve(__dirname, 'data');
const CONFIG_FILE = path.resolve(CONFIG_DIR, 'mosquito-slapper-config.json');
const SCORES_FILE = path.resolve(CONFIG_DIR, 'mosquito-slapper-scores.json');
const USERS_FILE = path.resolve(CONFIG_DIR, 'mosquito-slapper-users.json');
const SESSIONS_FILE = path.resolve(CONFIG_DIR, 'mosquito-slapper-sessions.json');
const SESSION_COOKIE_NAME = 'ms_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredLifetimeStats {
  gamesPlayed: number;
  bestScore: number;
  totalKills: number;
  totalScore: number;
  highestCombo: number;
  bestAccuracy: number;
  swarmsCleared: number;
}

interface StoredUserRecord {
  id: string;
  username: string;
  usernameLower: string;
  displayName: string;
  passwordSalt: string;
  passwordHash: string;
  createdAt: string;
  stats: StoredLifetimeStats;
  unlockedAchievements: string[];
  savedSettings?: Record<string, unknown> | null;
}

interface StoredSessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

interface StoredScoreEntry {
  id: string;
  playerName: string;
  username?: string;
  userId?: string;
  isGuest: boolean;
  score: number;
  mosquitoesKilled: number;
  totalMosquitoesSpawned?: number;
  missedAttacks?: number;
  accuracy: number;
  highestCombo: number;
  doubleKills?: number;
  tripleKills?: number;
  difficulty: string;
  swarmCleared: boolean;
  elapsedSeconds: number;
  unlockedAchievements?: string[];
  savedAt: string;
}

function emptyLifetimeStats(): StoredLifetimeStats {
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

function sanitizeDisplayName(raw: unknown, fallback = 'Guest'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 32);
  return cleaned || fallback;
}

function sanitizeUsername(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_.-]{3,24}$/.test(username);
}

function hashPassword(password: string, saltHex: string): string {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function verifyPassword(password: string, saltHex: string, expectedHashHex: string): boolean {
  try {
    const derived = crypto.scryptSync(password, saltHex, 64);
    const expected = Buffer.from(expectedHashHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function hashSessionToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function readJsonArray<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureConfigDir();
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

function toPublicUser(user: StoredUserRecord) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
    stats: user.stats ?? emptyLifetimeStats(),
    unlockedAchievements: Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : [],
  };
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(val);
      } catch {
        out[key] = val;
      }
    }
  }
  return out;
}

function extractRequestToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer && bearer.length >= 16) return bearer;
  }
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[SESSION_COOKIE_NAME];
  if (cookieToken && cookieToken.length >= 16) return cookieToken;
  return null;
}

function createSessionForUser(userId: string): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  const sessions = readJsonArray<StoredSessionRecord>(SESSIONS_FILE).filter(
    (s) => s && typeof s.expiresAt === 'number' && s.expiresAt > now,
  );
  sessions.push({
    tokenHash,
    userId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });
  // Cap total stored sessions to prevent unbounded growth
  writeJsonFile(SESSIONS_FILE, sessions.slice(-250));
  return rawToken;
}

function revokeSessionToken(rawToken: string | null): void {
  if (!rawToken) return;
  const targetHash = hashSessionToken(rawToken);
  const now = Date.now();
  const sessions = readJsonArray<StoredSessionRecord>(SESSIONS_FILE).filter(
    (s) => s && s.expiresAt > now && s.tokenHash !== targetHash,
  );
  writeJsonFile(SESSIONS_FILE, sessions);
}

function resolveSessionUser(req: express.Request): {
  user: StoredUserRecord | null;
  token: string | null;
} {
  const rawToken = extractRequestToken(req);
  if (!rawToken) return { user: null, token: null };
  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  const sessions = readJsonArray<StoredSessionRecord>(SESSIONS_FILE);
  const session = sessions.find((s) => s.tokenHash === tokenHash && s.expiresAt > now);
  if (!session) return { user: null, token: rawToken };
  const users = readJsonArray<StoredUserRecord>(USERS_FILE);
  const user = users.find((u) => u.id === session.userId) ?? null;
  return { user, token: rawToken };
}

function setSessionCookie(res: express.Response, rawToken: string): void {
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}`,
  );
}

function clearSessionCookie(res: express.Response): void {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

function mergeGuestImportIntoUser(
  user: StoredUserRecord,
  guestImport: unknown,
): StoredUserRecord {
  if (!guestImport || typeof guestImport !== 'object') return user;
  const imp = guestImport as {
    stats?: Partial<StoredLifetimeStats>;
    unlockedAchievements?: unknown;
    settings?: unknown;
  };
  const nextStats: StoredLifetimeStats = { ...(user.stats ?? emptyLifetimeStats()) };
  if (imp.stats && typeof imp.stats === 'object') {
    const g = imp.stats;
    const addGames = typeof g.gamesPlayed === 'number' && g.gamesPlayed > 0 ? Math.min(1000, Math.floor(g.gamesPlayed)) : 0;
    const addKills = typeof g.totalKills === 'number' && g.totalKills > 0 ? Math.min(100000, Math.floor(g.totalKills)) : 0;
    const addScore = typeof g.totalScore === 'number' && g.totalScore > 0 ? Math.min(10000000, Math.floor(g.totalScore)) : 0;
    const addClears = typeof g.swarmsCleared === 'number' && g.swarmsCleared > 0 ? Math.min(1000, Math.floor(g.swarmsCleared)) : 0;
    const gBestScore = typeof g.bestScore === 'number' && g.bestScore > 0 ? Math.min(1000000, Math.floor(g.bestScore)) : 0;
    const gCombo = typeof g.highestCombo === 'number' && g.highestCombo > 0 ? Math.min(1000, Math.floor(g.highestCombo)) : 0;
    const gAcc = typeof g.bestAccuracy === 'number' && g.bestAccuracy > 0 ? Math.min(100, Math.round(g.bestAccuracy * 10) / 10) : 0;

    nextStats.gamesPlayed += addGames;
    nextStats.totalKills += addKills;
    nextStats.totalScore += addScore;
    nextStats.swarmsCleared += addClears;
    nextStats.bestScore = Math.max(nextStats.bestScore, gBestScore);
    nextStats.highestCombo = Math.max(nextStats.highestCombo, gCombo);
    nextStats.bestAccuracy = Math.max(nextStats.bestAccuracy, gAcc);
  }

  const mergedAchievements = new Set<string>(
    Array.isArray(user.unlockedAchievements) ? user.unlockedAchievements : [],
  );
  if (Array.isArray(imp.unlockedAchievements)) {
    for (const item of imp.unlockedAchievements) {
      if (typeof item === 'string' && item.trim()) {
        mergedAchievements.add(item.trim().slice(0, 64));
      }
    }
  }

  const nextSettings =
    imp.settings && typeof imp.settings === 'object' && !Array.isArray(imp.settings)
      ? (imp.settings as Record<string, unknown>)
      : user.savedSettings ?? null;

  return {
    ...user,
    stats: nextStats,
    unlockedAchievements: Array.from(mergedAchievements).slice(0, 32),
    savedSettings: nextSettings,
  };
}

interface CompanionRoom {
  code: string;
  tv: WebSocket | null;
  phone: WebSocket | null;
  createdAt: number;
  lastActivity: number;
}

interface SocketMeta {
  role: 'tv' | 'phone' | null;
  roomCode: string | null;
}

const rooms = new Map<string, CompanionRoom>();
const socketMeta = new WeakMap<WebSocket, SocketMeta>();

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function normalizeEndpoint(rawEndpoint: string): string {
  return (rawEndpoint || 'http://localhost:1234/v1').trim().replace(/\/+$/, '');
}

function isAllowedLlmUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function resolvePublicOrigin(req: express.Request): string {
  const queryOrigin = typeof req.query.origin === 'string' ? req.query.origin.trim() : '';
  if (queryOrigin && isAllowedLlmUrl(queryOrigin)) {
    try {
      return new URL(queryOrigin).origin;
    } catch {
      // Fall through to headers
    }
  }

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const host = forwardedHost || req.headers.host || '';
  if (host) {
    const proto =
      forwardedProto === 'https' || forwardedProto === 'http'
        ? forwardedProto
        : req.protocol === 'https'
          ? 'https'
          : 'http';
    const candidate = `${proto}://${host}`;
    if (isAllowedLlmUrl(candidate)) {
      try {
        return new URL(candidate).origin;
      } catch {
        // Fall through
      }
    }
  }

  const envUrl = (process.env.APP_URL || '').trim();
  if (envUrl && isAllowedLlmUrl(envUrl)) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // Fall through
    }
  }

  return `http://localhost:${PORT}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function readAppleIconBase64(): string {
  const candidates = [
    path.resolve(__dirname, 'public/apple-touch-icon.png'),
    path.resolve(__dirname, 'dist/apple-touch-icon.png'),
    path.resolve(__dirname, 'public/pwa-192x192.png'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) {
      try {
        return fs.readFileSync(filePath).toString('base64');
      } catch {
        // Try next candidate
      }
    }
  }
  return '';
}

function getLanIpv4Addresses(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address) {
        ips.push(entry.address);
      }
    }
  }
  return ips;
}

function generateRoomCode(): string {
  for (let attempt = 0; attempt < 40; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(1000 + Math.random() * 9000));
}

function safeSend(ws: WebSocket | null, payload: Record<string, unknown>): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore transient send errors on closing sockets
  }
}

function detachSocketFromRoom(ws: WebSocket): void {
  const meta = socketMeta.get(ws);
  if (!meta || !meta.roomCode || !meta.role) return;

  const room = rooms.get(meta.roomCode);
  if (room) {
    if (meta.role === 'tv' && room.tv === ws) {
      room.tv = null;
      safeSend(room.phone, {
        type: 'peer:disconnected',
        code: room.code,
        peerRole: 'tv',
        reason: 'TV display disconnected',
      });
    } else if (meta.role === 'phone' && room.phone === ws) {
      room.phone = null;
      safeSend(room.tv, {
        type: 'peer:disconnected',
        code: room.code,
        peerRole: 'phone',
        reason: 'Phone camera disconnected',
      });
    }

    if (!room.tv && !room.phone) {
      rooms.delete(room.code);
    }
  }

  meta.role = null;
  meta.roomCode = null;
}

function attachCompanionWebSocket(server: http.Server): void {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 2 * 1024 * 1024,
  });

  server.on('upgrade', (request, socket, head) => {
    // Only intercept our /ws Companion endpoint; leave Vite HMR/ping upgrades untouched
    const protocol = request.headers['sec-websocket-protocol'];
    if (protocol === 'vite-hmr' || protocol === 'vite-ping') {
      return;
    }
    let pathname = '/';
    try {
      pathname = new URL(request.url || '/', 'http://localhost').pathname;
    } catch {
      return;
    }
    if (pathname !== '/ws') {
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    socketMeta.set(ws, { role: null, roomCode: null });

    ws.on('message', (rawData) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(rawData)) as Record<string, unknown>;
      } catch {
        return;
      }

      const type = typeof msg.type === 'string' ? msg.type : '';
      const meta = socketMeta.get(ws) ?? { role: null, roomCode: null };
      socketMeta.set(ws, meta);

      if (type === 'ping') {
        safeSend(ws, { type: 'pong', ts: Date.now() });
        return;
      }

      if (type === 'tv:create') {
        detachSocketFromRoom(ws);

        const requested =
          typeof msg.code === 'string' && /^\d{4}$/.test(msg.code.trim())
            ? msg.code.trim()
            : '';

        let code = requested;
        let room = code ? rooms.get(code) : undefined;
        if (room && room.tv && room.tv !== ws && room.tv.readyState === WebSocket.OPEN) {
          // Existing active TV already owns this code; issue a fresh code
          code = generateRoomCode();
          room = undefined;
        }

        if (!code) {
          code = generateRoomCode();
        }

        if (!room) {
          room = {
            code,
            tv: ws,
            phone: null,
            createdAt: Date.now(),
            lastActivity: Date.now(),
          };
          rooms.set(code, room);
        } else {
          room.tv = ws;
          room.lastActivity = Date.now();
        }

        meta.role = 'tv';
        meta.roomCode = code;

        const phoneAlive = Boolean(room.phone && room.phone.readyState === WebSocket.OPEN);
        safeSend(ws, {
          type: 'room:created',
          code,
          peerConnected: phoneAlive,
        });

        if (phoneAlive) {
          safeSend(ws, { type: 'peer:connected', code, peerRole: 'phone' });
          safeSend(room.phone, { type: 'peer:connected', code, peerRole: 'tv' });
        }
        return;
      }

      if (type === 'phone:join') {
        detachSocketFromRoom(ws);
        const code = typeof msg.code === 'string' ? msg.code.trim() : '';
        const room = /^\d{4}$/.test(code) ? rooms.get(code) : undefined;

        if (!room || !room.tv || room.tv.readyState !== WebSocket.OPEN) {
          safeSend(ws, {
            type: 'room:error',
            message: 'Room code not found. Open TV Display Mode on your TV first.',
          });
          return;
        }

        // Replace any previous phone controller cleanly
        if (room.phone && room.phone !== ws && room.phone.readyState === WebSocket.OPEN) {
          safeSend(room.phone, {
            type: 'room:error',
            message: 'Another phone connected to this TV room.',
          });
          const oldMeta = socketMeta.get(room.phone);
          if (oldMeta) {
            oldMeta.role = null;
            oldMeta.roomCode = null;
          }
        }

        room.phone = ws;
        room.lastActivity = Date.now();
        meta.role = 'phone';
        meta.roomCode = code;

        safeSend(ws, { type: 'room:joined', code });
        safeSend(ws, { type: 'peer:connected', code, peerRole: 'tv' });
        safeSend(room.tv, { type: 'peer:connected', code, peerRole: 'phone' });
        return;
      }

      // All remaining messages require an active room membership
      if (!meta.roomCode || !meta.role) return;
      const room = rooms.get(meta.roomCode);
      if (!room) return;
      room.lastActivity = Date.now();

      const target = meta.role === 'phone' ? room.tv : room.phone;
      if (!target || target.readyState !== WebSocket.OPEN) return;

      // Drop stale fallback JPEG video frames if socket send buffer is congested to keep latency near zero
      if (type === 'video:frame' && target.bufferedAmount > 512 * 1024) {
        return;
      }

      if (
        type === 'rtc:offer' ||
        type === 'rtc:answer' ||
        type === 'rtc:ice' ||
        type === 'vision:frame' ||
        type === 'vision:attack' ||
        type === 'video:frame' ||
        type === 'remote:command' ||
        type === 'tv:hud'
      ) {
        safeSend(target, msg);
      }
    });

    ws.on('close', () => {
      detachSocketFromRoom(ws);
    });

    ws.on('error', () => {
      detachSocketFromRoom(ws);
    });
  });

  // Periodic room cleanup for abandoned sessions
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      const tvOpen = room.tv && room.tv.readyState === WebSocket.OPEN;
      const phoneOpen = room.phone && room.phone.readyState === WebSocket.OPEN;
      if ((!tvOpen && !phoneOpen) || now - room.lastActivity > 30 * 60 * 1000) {
        rooms.delete(code);
      }
    }
  }, 30_000);
  cleanupTimer.unref();
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  // Serve local MediaPipe WASM files so hand tracking works without external WASM CDNs
  const localWasmPath = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm');
  if (fs.existsSync(localWasmPath)) {
    app.use('/mediapipe/wasm', express.static(localWasmPath, { maxAge: '7d' }));
  }
  app.use('/mediapipe/wasm', (_req, res) => {
    res.status(404).end();
  });

  // Serve local MediaPipe .task models with strict 404 so SPA middleware never returns index.html
  const localModelsPath = path.resolve(__dirname, 'models');
  if (fs.existsSync(localModelsPath)) {
    app.use(
      '/models',
      express.static(localModelsPath, {
        maxAge: '7d',
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.task') || filePath.endsWith('.tflite')) {
            res.setHeader('Content-Type', 'application/octet-stream');
          }
        },
      }),
    );
  }
  app.use('/models', (_req, res) => {
    res.status(404).end();
  });

  // Built-in backend health check (matches default /api/health path in Backend API settings)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'ai-mosquito-slapper',
      version: '1.0.0',
      wsPath: '/ws',
      timestamp: new Date().toISOString(),
    });
  });

  // Local network discovery helper for Phone-to-TV LAN pairing instructions
  app.get('/api/network-info', (_req, res) => {
    res.json({
      port: PORT,
      lanIps: getLanIpv4Addresses(),
    });
  });

  // Platform download catalog (Android, Apple iOS/macOS, Windows)
  app.get('/api/downloads/manifest', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const originQuery = `?origin=${encodeURIComponent(origin)}`;
    res.json({
      ok: true,
      appName: 'AI Mosquito Slapper',
      origin,
      platforms: {
        android: {
          installPageUrl: `${origin}/?install=android`,
          twaConfigUrl: `${origin}/api/downloads/android-twa${originQuery}`,
          customUrl: (process.env.VITE_ANDROID_DOWNLOAD_URL || '').trim() || null,
        },
        apple: {
          installPageUrl: `${origin}/?install=apple`,
          iosProfileUrl: `${origin}/api/downloads/apple-ios${originQuery}`,
          macosLauncherUrl: `${origin}/api/downloads/apple-macos${originQuery}`,
          macosShortcutUrl: `${origin}/api/downloads/apple-webloc${originQuery}`,
          customUrl: (process.env.VITE_APPLE_DOWNLOAD_URL || '').trim() || null,
        },
        windows: {
          installPageUrl: `${origin}/?install=windows`,
          installerUrl: `${origin}/api/downloads/windows${originQuery}`,
          shortcutUrl: `${origin}/api/downloads/windows-shortcut${originQuery}`,
          customUrl: (process.env.VITE_WINDOWS_DOWNLOAD_URL || '').trim() || null,
        },
      },
    });
  });

  // Windows standalone Desktop & Start Menu App Installer (.cmd)
  app.get('/api/downloads/windows', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const appUrl = `${origin}/`;
    const lines = [
      '@echo off',
      'setlocal',
      'title AI Mosquito Slapper - Windows App Installer',
      `set "APP_URL=${appUrl}"`,
      'set "APP_NAME=AI Mosquito Slapper"',
      'set "BROWSER_EXE="',
      '',
      'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER_EXE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not defined BROWSER_EXE if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" set "BROWSER_EXE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
      'if not defined BROWSER_EXE if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER_EXE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not defined BROWSER_EXE if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER_EXE=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
      'if not defined BROWSER_EXE if exist "%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER_EXE=%LOCALAPPDATA%\\Google\\Chrome\\Application\\chrome.exe"',
      '',
      'echo Installing %APP_NAME% shortcut to your Desktop and Start Menu...',
      'if defined BROWSER_EXE (',
      '  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; foreach ($dir in @([Environment]::GetFolderPath(\'Desktop\'), (Join-Path $env:APPDATA \'Microsoft\\Windows\\Start Menu\\Programs\'))) { if (Test-Path $dir) { $lnk = $ws.CreateShortcut((Join-Path $dir \'%APP_NAME%.lnk\')); $lnk.TargetPath = $env:BROWSER_EXE; $lnk.Arguments = \'--app=\' + $env:APP_URL; $lnk.Description = \'AI Mosquito Slapper Webcam AR Game\'; $lnk.Save() } }"',
      '  echo Installed! Launching %APP_NAME% in standalone App Mode...',
      '  start "" "%BROWSER_EXE%" --app="%APP_URL%"',
      ') else (',
      '  echo Opening %APP_NAME% in your default browser...',
      '  start "" "%APP_URL%"',
      ')',
      'endlocal',
      '',
    ];
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="Install-AI-Mosquito-Slapper-Windows.cmd"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(lines.join('\r\n'));
  });

  // Windows direct Internet Shortcut (.url)
  app.get('/api/downloads/windows-shortcut', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const content = [
      '[InternetShortcut]',
      `URL=${origin}/`,
      `IconFile=${origin}/pwa-192x192.png`,
      'IconIndex=0',
      '',
    ].join('\r\n');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AI-Mosquito-Slapper.url"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(content);
  });

  // Apple iOS / iPadOS Web Clip Configuration Profile (.mobileconfig)
  app.get('/api/downloads/apple-ios', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const appUrl = escapeXml(`${origin}/`);
    const iconBase64 = readAppleIconBase64();
    const iconSection = iconBase64
      ? `      <key>Icon</key>\n      <data>\n${iconBase64.replace(/(.{76})/g, '$1\n')}\n      </data>\n`
      : '';

    const mobileConfig = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>PayloadContent</key>
  <array>
    <dict>
      <key>FullScreen</key>
      <true/>
${iconSection}      <key>IgnoreManifestScope</key>
      <false/>
      <key>IsRemovable</key>
      <true/>
      <key>Label</key>
      <string>BugSlapper</string>
      <key>PayloadDescription</key>
      <string>Adds AI Mosquito Slapper as a fullscreen home screen app on iPhone and iPad.</string>
      <key>PayloadDisplayName</key>
      <string>AI Mosquito Slapper Web Clip</string>
      <key>PayloadIdentifier</key>
      <string>com.aimosquitoslapper.webclip</string>
      <key>PayloadType</key>
      <string>com.apple.webClip.managed</string>
      <key>PayloadUUID</key>
      <string>7B6E8C14-2B8D-4F18-9F92-21F9C20A88A1</string>
      <key>PayloadVersion</key>
      <integer>1</integer>
      <key>Precomposed</key>
      <true/>
      <key>URL</key>
      <string>${appUrl}</string>
    </dict>
  </array>
  <key>PayloadDescription</key>
  <string>Install AI Mosquito Slapper fullscreen app shortcut for iPhone and iPad.</string>
  <key>PayloadDisplayName</key>
  <string>AI Mosquito Slapper</string>
  <key>PayloadIdentifier</key>
  <string>com.aimosquitoslapper.profile</string>
  <key>PayloadOrganization</key>
  <string>AI Mosquito Slapper</string>
  <key>PayloadRemovalDisallowed</key>
  <false/>
  <key>PayloadType</key>
  <string>Configuration</string>
  <key>PayloadUUID</key>
  <string>4C32B87F-9A40-4E31-B99A-9D7C52B5C119</string>
  <key>PayloadVersion</key>
  <integer>1</integer>
</dict>
</plist>
`;
    res.setHeader('Content-Type', 'application/x-apple-aspen-config');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AI-Mosquito-Slapper-iOS.mobileconfig"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(mobileConfig);
  });

  // Apple macOS Standalone App Launcher (.command)
  app.get('/api/downloads/apple-macos', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const appUrl = `${origin}/`;
    const script = [
      '#!/bin/bash',
      `APP_URL="${appUrl}"`,
      '',
      'if [ -d "/Applications/Google Chrome.app" ]; then',
      '  open -na "Google Chrome" --args --app="$APP_URL"',
      'elif [ -d "/Applications/Microsoft Edge.app" ]; then',
      '  open -na "Microsoft Edge" --args --app="$APP_URL"',
      'elif [ -d "/Applications/Brave Browser.app" ]; then',
      '  open -na "Brave Browser" --args --app="$APP_URL"',
      'else',
      '  open -a "Safari" "$APP_URL"',
      'fi',
      '',
    ].join('\n');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AI-Mosquito-Slapper-macOS.command"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(script);
  });

  // Apple macOS Web Location Shortcut (.webloc)
  app.get('/api/downloads/apple-webloc', (req, res) => {
    const origin = resolvePublicOrigin(req);
    const webloc = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${escapeXml(`${origin}/`)}</string>
</dict>
</plist>
`;
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AI-Mosquito-Slapper.webloc"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(webloc);
  });

  // Android Trusted Web Activity (Bubblewrap) APK/AAB Build Manifest (.json)
  app.get('/api/downloads/android-twa', (req, res) => {
    const origin = resolvePublicOrigin(req);
    let host = 'localhost:3000';
    try {
      host = new URL(origin).host;
    } catch {
      // Keep default host
    }
    const twaManifest = {
      packageId: 'com.aimosquitoslapper.app',
      host,
      name: 'AI Mosquito Slapper',
      launcherName: 'BugSlapper',
      display: 'standalone',
      themeColor: '#0E1310',
      navigationColor: '#0E1310',
      backgroundColor: '#0E1310',
      enableNotifications: false,
      startUrl: '/',
      iconUrl: `${origin}/pwa-512x512.png`,
      maskableIconUrl: `${origin}/pwa-maskable-512x512.png`,
      splashScreenFadeOutDuration: 300,
      signingKey: {
        path: './android.keystore',
        alias: 'android',
      },
      appVersionName: '1.0.0',
      appVersionCode: 1,
      shortcuts: [],
      generatorApp: 'bubblewrap-cli',
      webManifestUrl: `${origin}/manifest.webmanifest`,
      fallbackType: 'customtabs',
      features: {
        locationDelegation: { enabled: false },
        playBilling: { enabled: false },
      },
      orientation: 'any',
      buildInstructions:
        'Run: npx @bubblewrap/cli update && npx @bubblewrap/cli build to generate a signed Android APK / AAB.',
    };
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="AI-Mosquito-Slapper-Android-TWA-Config.json"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(twaManifest, null, 2));
  });

  // === Optional Player Authentication & Profile Endpoints ===
  // All gameplay works without login (Guest Mode). Accounts are strictly opt-in for profile sync & leaderboard identity.
  app.get('/api/auth/me', (req, res) => {
    const { user } = resolveSessionUser(req);
    if (!user) {
      res.json({
        ok: true,
        authenticated: false,
        user: null,
        savedSettings: null,
      });
      return;
    }
    res.json({
      ok: true,
      authenticated: true,
      user: toPublicUser(user),
      savedSettings: user.savedSettings ?? null,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    try {
      const username = sanitizeUsername(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const displayName = sanitizeDisplayName(req.body?.displayName, username || 'Player');

      if (!isValidUsername(username)) {
        res.status(400).json({
          ok: false,
          error: 'Username must be 3–24 characters using letters, numbers, dots, underscores, or hyphens.',
        });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({
          ok: false,
          error: 'Password must be between 6 and 128 characters.',
        });
        return;
      }

      const users = readJsonArray<StoredUserRecord>(USERS_FILE);
      const usernameLower = username.toLowerCase();
      if (users.some((u) => u.usernameLower === usernameLower)) {
        res.status(409).json({
          ok: false,
          error: 'That username is already taken. Try another username or sign in.',
        });
        return;
      }

      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, passwordSalt);

      let newUser: StoredUserRecord = {
        id: `usr_${crypto.randomBytes(8).toString('hex')}`,
        username,
        usernameLower,
        displayName,
        passwordSalt,
        passwordHash,
        createdAt: new Date().toISOString(),
        stats: emptyLifetimeStats(),
        unlockedAchievements: [],
        savedSettings: null,
      };

      if (req.body?.guestImport) {
        newUser = mergeGuestImportIntoUser(newUser, req.body.guestImport);
      }

      users.push(newUser);
      writeJsonFile(USERS_FILE, users);

      const token = createSessionForUser(newUser.id);
      setSessionCookie(res, token);

      res.status(201).json({
        ok: true,
        token,
        user: toPublicUser(newUser),
        savedSettings: newUser.savedSettings ?? null,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to create account right now.',
      });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const username = sanitizeUsername(req.body?.username);
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!username || !password) {
        res.status(400).json({ ok: false, error: 'Enter both your username and password.' });
        return;
      }

      const users = readJsonArray<StoredUserRecord>(USERS_FILE);
      const idx = users.findIndex((u) => u.usernameLower === username.toLowerCase());
      if (idx < 0 || !verifyPassword(password, users[idx].passwordSalt, users[idx].passwordHash)) {
        res.status(401).json({ ok: false, error: 'Invalid username or password.' });
        return;
      }

      let matched = users[idx];
      if (req.body?.guestImport) {
        matched = mergeGuestImportIntoUser(matched, req.body.guestImport);
        users[idx] = matched;
        writeJsonFile(USERS_FILE, users);
      }

      const token = createSessionForUser(matched.id);
      setSessionCookie(res, token);

      res.json({
        ok: true,
        token,
        user: toPublicUser(matched),
        savedSettings: matched.savedSettings ?? null,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to sign in right now.',
      });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const rawToken = extractRequestToken(req);
    revokeSessionToken(rawToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.patch('/api/auth/profile', (req, res) => {
    const { user } = resolveSessionUser(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'Sign in required to update account profile.' });
      return;
    }

    try {
      const users = readJsonArray<StoredUserRecord>(USERS_FILE);
      const idx = users.findIndex((u) => u.id === user.id);
      if (idx < 0) {
        res.status(404).json({ ok: false, error: 'Account not found.' });
        return;
      }

      let updated = { ...users[idx] };
      if (typeof req.body?.displayName === 'string') {
        updated.displayName = sanitizeDisplayName(req.body.displayName, updated.displayName);
      }
      if (req.body?.settings && typeof req.body.settings === 'object' && !Array.isArray(req.body.settings)) {
        updated.savedSettings = req.body.settings as Record<string, unknown>;
      }
      if (req.body?.guestImport) {
        updated = mergeGuestImportIntoUser(updated, req.body.guestImport);
      }

      users[idx] = updated;
      writeJsonFile(USERS_FILE, users);
      res.json({
        ok: true,
        user: toPublicUser(updated),
        savedSettings: updated.savedSettings ?? null,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to update profile.',
      });
    }
  });

  // Built-in match score & leaderboard persistence (works for BOTH Guest and Signed-In players)
  app.get('/api/scores', (req, res) => {
    try {
      const filter = typeof req.query.filter === 'string' ? req.query.filter.toLowerCase() : 'all';
      const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 30;
      const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30;

      const rawList = readJsonArray<Record<string, unknown>>(SCORES_FILE);
      const normalized: StoredScoreEntry[] = rawList.map((item, index) => {
        const isGuest = typeof item.isGuest === 'boolean' ? item.isGuest : !item.userId;
        return {
          id: typeof item.id === 'string' ? item.id : `score-legacy-${index}`,
          playerName: sanitizeDisplayName(item.playerName, isGuest ? 'Guest' : 'Player'),
          username: typeof item.username === 'string' ? item.username : undefined,
          userId: typeof item.userId === 'string' ? item.userId : undefined,
          isGuest,
          score: typeof item.score === 'number' && Number.isFinite(item.score) ? item.score : 0,
          mosquitoesKilled:
            typeof item.mosquitoesKilled === 'number' && Number.isFinite(item.mosquitoesKilled)
              ? item.mosquitoesKilled
              : 0,
          totalMosquitoesSpawned:
            typeof item.totalMosquitoesSpawned === 'number' ? item.totalMosquitoesSpawned : undefined,
          missedAttacks: typeof item.missedAttacks === 'number' ? item.missedAttacks : undefined,
          accuracy:
            typeof item.accuracy === 'number' && Number.isFinite(item.accuracy) ? item.accuracy : 0,
          highestCombo:
            typeof item.highestCombo === 'number' && Number.isFinite(item.highestCombo)
              ? item.highestCombo
              : 0,
          difficulty: typeof item.difficulty === 'string' ? item.difficulty : 'NORMAL',
          swarmCleared: Boolean(item.swarmCleared),
          elapsedSeconds:
            typeof item.elapsedSeconds === 'number' && Number.isFinite(item.elapsedSeconds)
              ? item.elapsedSeconds
              : 0,
          savedAt: typeof item.savedAt === 'string' ? item.savedAt : new Date().toISOString(),
        };
      });

      const filtered = normalized.filter((entry) => {
        if (filter === 'members') return !entry.isGuest;
        if (filter === 'guests') return entry.isGuest;
        return true;
      });

      const leaderboard = [...filtered]
        .sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
          return b.highestCombo - a.highestCombo;
        })
        .slice(0, limit);

      res.json({
        ok: true,
        scores: filtered.slice(0, limit),
        leaderboard,
      });
    } catch {
      res.json({ ok: true, scores: [], leaderboard: [] });
    }
  });

  app.post('/api/scores', (req, res) => {
    try {
      ensureConfigDir();
      const { user } = resolveSessionUser(req);
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};

      const score = typeof body.score === 'number' && Number.isFinite(body.score) ? Math.max(0, Math.round(body.score)) : 0;
      const mosquitoesKilled =
        typeof body.mosquitoesKilled === 'number' && Number.isFinite(body.mosquitoesKilled)
          ? Math.max(0, Math.round(body.mosquitoesKilled))
          : 0;
      const accuracy =
        typeof body.accuracy === 'number' && Number.isFinite(body.accuracy)
          ? Math.min(100, Math.max(0, Math.round(body.accuracy * 10) / 10))
          : 0;
      const highestCombo =
        typeof body.highestCombo === 'number' && Number.isFinite(body.highestCombo)
          ? Math.max(0, Math.round(body.highestCombo))
          : 0;
      const elapsedSeconds =
        typeof body.elapsedSeconds === 'number' && Number.isFinite(body.elapsedSeconds)
          ? Math.max(0, Math.round(body.elapsedSeconds * 10) / 10)
          : 0;
      const difficulty = typeof body.difficulty === 'string' ? body.difficulty.slice(0, 16) : 'NORMAL';
      const swarmCleared = Boolean(body.swarmCleared);
      const unlockedAchievements = Array.isArray(body.unlockedAchievements)
        ? body.unlockedAchievements.filter((v): v is string => typeof v === 'string').slice(0, 20)
        : [];

      const existing = readJsonArray<StoredScoreEntry>(SCORES_FILE);
      const entry: StoredScoreEntry = {
        id: `score-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
        playerName: user
          ? user.displayName
          : sanitizeDisplayName(body.playerName, 'Guest'),
        ...(user ? { username: user.username, userId: user.id } : {}),
        isGuest: !user,
        score,
        mosquitoesKilled,
        totalMosquitoesSpawned:
          typeof body.totalMosquitoesSpawned === 'number' ? body.totalMosquitoesSpawned : undefined,
        missedAttacks: typeof body.missedAttacks === 'number' ? body.missedAttacks : undefined,
        accuracy,
        highestCombo,
        doubleKills: typeof body.doubleKills === 'number' ? body.doubleKills : undefined,
        tripleKills: typeof body.tripleKills === 'number' ? body.tripleKills : undefined,
        difficulty,
        swarmCleared,
        elapsedSeconds,
        unlockedAchievements,
        savedAt: new Date().toISOString(),
      };

      const updatedScores = [entry, ...existing].slice(0, 200);
      writeJsonFile(SCORES_FILE, updatedScores);

      // Automatically update verified lifetime stats when player is signed in
      let updatedPublicUser = null;
      if (user) {
        const users = readJsonArray<StoredUserRecord>(USERS_FILE);
        const idx = users.findIndex((u) => u.id === user.id);
        if (idx >= 0) {
          const cur = users[idx];
          const prevStats = cur.stats ?? emptyLifetimeStats();
          const mergedAch = new Set<string>(
            Array.isArray(cur.unlockedAchievements) ? cur.unlockedAchievements : [],
          );
          for (const a of unlockedAchievements) mergedAch.add(a);

          users[idx] = {
            ...cur,
            stats: {
              gamesPlayed: prevStats.gamesPlayed + 1,
              bestScore: Math.max(prevStats.bestScore, score),
              totalKills: prevStats.totalKills + mosquitoesKilled,
              totalScore: prevStats.totalScore + score,
              highestCombo: Math.max(prevStats.highestCombo, highestCombo),
              bestAccuracy: Math.max(prevStats.bestAccuracy, accuracy),
              swarmsCleared: prevStats.swarmsCleared + (swarmCleared ? 1 : 0),
            },
            unlockedAchievements: Array.from(mergedAch).slice(0, 32),
          };
          writeJsonFile(USERS_FILE, users);
          updatedPublicUser = toPublicUser(users[idx]);
        }
      }

      res.json({
        ok: true,
        entry,
        totalSaved: updatedScores.length,
        user: updatedPublicUser,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to save match score',
      });
    }
  });

  // Server-side proxy for user-configured custom Backend APIs (bypasses browser CORS & injects optional server-side BACKEND_API_TOKEN)
  app.post('/api/backend/proxy', async (req, res) => {
    const targetUrl = typeof req.body?.targetUrl === 'string' ? req.body.targetUrl.trim() : '';
    const rawMethod = typeof req.body?.method === 'string' ? req.body.method.toUpperCase() : 'GET';
    const method = ['GET', 'POST', 'PUT', 'PATCH'].includes(rawMethod) ? rawMethod : 'GET';
    const payloadBody = req.body?.body;

    if (!isAllowedLlmUrl(targetUrl)) {
      res.status(400).json({ ok: false, status: 400, error: 'Invalid backend target URL' });
      return;
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const serverToken = (process.env.BACKEND_API_TOKEN || '').trim();
      if (serverToken) {
        headers.Authorization = `Bearer ${serverToken}`;
      }

      const init: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };
      if (method !== 'GET' && payloadBody !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(payloadBody);
      }

      const upstream = await fetch(targetUrl, init);
      clearTimeout(timer);
      const latencyMs = Date.now() - startedAt;

      const contentType = upstream.headers.get('content-type') || '';
      let data: unknown = null;
      if (contentType.includes('application/json')) {
        data = await upstream.json().catch(() => null);
      } else {
        const text = await upstream.text().catch(() => '');
        data = text ? { text: text.slice(0, 1000) } : null;
      }

      res.json({
        ok: upstream.ok,
        status: upstream.status,
        latencyMs,
        data,
        error: upstream.ok ? undefined : `Upstream responded HTTP ${upstream.status}`,
      });
    } catch (err) {
      clearTimeout(timer);
      const latencyMs = Date.now() - startedAt;
      res.status(502).json({
        ok: false,
        status: 502,
        latencyMs,
        data: null,
        error: err instanceof Error ? err.message : 'Unable to reach custom backend API',
      });
    }
  });

  // Local JSON configuration storage endpoints (user-scoped when signed in, global/guest fallback otherwise)
  app.get('/api/config', (req, res) => {
    try {
      const { user } = resolveSessionUser(req);
      if (user && user.savedSettings) {
        res.json({ exists: true, config: user.savedSettings, scope: 'user' });
        return;
      }
      if (!fs.existsSync(CONFIG_FILE)) {
        res.json({ exists: false, config: null, scope: 'guest' });
        return;
      }
      const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
      res.json({ exists: true, config: JSON.parse(raw), scope: 'guest' });
    } catch {
      res.json({ exists: false, config: null });
    }
  });

  app.post('/api/config', (req, res) => {
    try {
      const { user } = resolveSessionUser(req);
      if (user && req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
        const users = readJsonArray<StoredUserRecord>(USERS_FILE);
        const idx = users.findIndex((u) => u.id === user.id);
        if (idx >= 0) {
          users[idx] = { ...users[idx], savedSettings: req.body as Record<string, unknown> };
          writeJsonFile(USERS_FILE, users);
          res.json({ ok: true, scope: 'user' });
          return;
        }
      }
      ensureConfigDir();
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(req.body ?? {}, null, 2), 'utf-8');
      res.json({ ok: true, scope: 'guest' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : 'Failed to save config' });
    }
  });

  // LM Studio / OpenAI-compatible local LLM proxy (prevents browser CORS blocks)
  app.post('/api/llm/models', async (req, res) => {
    const endpoint = normalizeEndpoint(req.body?.endpoint);
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';

    if (!isAllowedLlmUrl(endpoint)) {
      res.status(400).json({ ok: false, error: 'Invalid LLM endpoint URL', models: [] });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const upstream = await fetch(`${endpoint}/models`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        res.status(502).json({ ok: false, error: `LM Studio responded with HTTP ${upstream.status}`, models: [] });
        return;
      }

      const data = (await upstream.json()) as { data?: Array<{ id: string }> };
      const models = Array.isArray(data?.data) ? data.data.map((m) => m.id).filter(Boolean) : [];
      res.json({ ok: true, models });
    } catch (err) {
      clearTimeout(timer);
      res.status(503).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Unable to reach local LLM server',
        models: [],
      });
    }
  });

  app.post('/api/llm/chat', async (req, res) => {
    const endpoint = normalizeEndpoint(req.body?.endpoint);
    const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : 'local-model';
    const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const maxTokens = typeof req.body?.maxTokens === 'number' ? Math.min(Math.max(req.body.maxTokens, 24), 400) : 120;
    const temperature = typeof req.body?.temperature === 'number' ? req.body.temperature : 0.85;

    if (!isAllowedLlmUrl(endpoint)) {
      res.status(400).json({ ok: false, error: 'Invalid LLM endpoint URL' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const upstream = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          temperature,
          stream: false,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        res.status(502).json({
          ok: false,
          error: `LLM error ${upstream.status}: ${text.slice(0, 160)}`,
        });
        return;
      }

      const json = (await upstream.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = json?.choices?.[0]?.message?.content?.trim() ?? '';
      res.json({ ok: true, content });
    } catch (err) {
      clearTimeout(timer);
      res.status(503).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Local LLM request timed out or unavailable',
      });
    }
  });

  const httpServer = http.createServer(app);
  attachCompanionWebSocket(httpServer);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: !disableHmr,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`AI Mosquito Slapper server + Companion WS listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});
