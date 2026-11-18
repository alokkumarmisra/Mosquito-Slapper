import {
  BackendApiConfig,
  DifficultyLevel,
  GameStats,
  LeaderboardEntry,
  PlayerAccount,
} from '../types/game';

export interface BackendResponse<T = unknown> {
  ok: boolean;
  status: number;
  latencyMs: number;
  data: T | null;
  error?: string;
}

export interface BackendTestResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  resolvedUrl: string;
  message: string;
  suggestProxy?: boolean;
}

export function normalizeBaseUrl(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.origin + parsed.pathname.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeEndpointPath(raw: string, fallback: string): string {
  const trimmed = (raw || '').trim();
  if (!trimmed) return fallback;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function isCustomBackendActive(backend?: BackendApiConfig | null): boolean {
  return Boolean(backend && backend.enabled && normalizeBaseUrl(backend.baseUrl));
}

export function buildTargetUrl(backend: BackendApiConfig | null | undefined, path: string): string {
  const normalizedPath = normalizeEndpointPath(path, '/');
  if (!isCustomBackendActive(backend)) {
    return normalizedPath;
  }
  const base = normalizeBaseUrl(backend!.baseUrl);
  return `${base}${normalizedPath}`;
}

/**
 * Resolves the WebSocket URL for Phone-to-TV Companion pairing.
 * Uses explicit wsUrl override, or derives ws(s)://<customBase>/ws when custom backend TV relay is enabled,
 * otherwise falls back to the built-in /ws endpoint on the current host.
 */
export function resolveCompanionWsUrl(backend?: BackendApiConfig | null): string {
  const defaultProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = typeof window !== 'undefined' ? window.location.host : 'localhost:3000';
  const builtIn = `${defaultProtocol}//${defaultHost}/ws`;

  if (!backend || !backend.enabled || !backend.routeTvRelay) {
    return builtIn;
  }

  const explicitWs = (backend.wsUrl || '').trim();
  if (explicitWs) {
    try {
      const parsed = new URL(explicitWs);
      if (parsed.protocol === 'ws:' || parsed.protocol === 'wss:') {
        return parsed.toString();
      }
    } catch {
      // Fall through to baseUrl derivation
    }
  }

  const base = normalizeBaseUrl(backend.baseUrl);
  if (!base) return builtIn;

  try {
    const parsed = new URL(base);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = parsed.pathname.replace(/\/+$/, '');
    return `${wsProto}//${parsed.host}${basePath}/ws`;
  } catch {
    return builtIn;
  }
}

export async function backendRequest<T = unknown>(
  backend: BackendApiConfig | null | undefined,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
    body?: unknown;
    timeoutMs?: number;
    forceProxy?: boolean;
    authToken?: string | null;
  } = {},
): Promise<BackendResponse<T>> {
  const method = options.method ?? 'GET';
  const timeoutMs = options.timeoutMs ?? 5000;
  const customActive = isCustomBackendActive(backend);
  const targetUrl = buildTargetUrl(backend, path);
  const startedAt = performance.now();

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Route cross-origin custom API calls via built-in Express proxy when enabled
    if (customActive && (backend?.useServerProxy || options.forceProxy)) {
      const proxyRes = await fetch('/api/backend/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          targetUrl,
          method,
          body: options.body,
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - startedAt);
      const envelope = (await proxyRes.json().catch(() => null)) as {
        ok?: boolean;
        status?: number;
        latencyMs?: number;
        data?: T;
        error?: string;
      } | null;

      if (!envelope) {
        return {
          ok: false,
          status: proxyRes.status,
          latencyMs,
          data: null,
          error: `Proxy error HTTP ${proxyRes.status}`,
        };
      }
      return {
        ok: Boolean(envelope.ok),
        status: envelope.status ?? proxyRes.status,
        latencyMs: envelope.latencyMs ?? latencyMs,
        data: (envelope.data ?? null) as T | null,
        error: envelope.error,
      };
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.authToken) {
      headers.Authorization = `Bearer ${options.authToken}`;
    }
    const fetchInit: RequestInit = {
      method,
      headers,
      credentials: customActive ? 'omit' : 'same-origin',
      signal: controller.signal,
    };

    if (options.body !== undefined && method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      fetchInit.body = JSON.stringify(options.body);
    }

    const res = await fetch(targetUrl, fetchInit);
    window.clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startedAt);

    let data: T | null = null;
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      data = (await res.json().catch(() => null)) as T | null;
    } else {
      const text = await res.text().catch(() => '');
      data = (text ? ({ text } as unknown as T) : null);
    }

    return {
      ok: res.ok,
      status: res.status,
      latencyMs,
      data,
      error: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (err) {
    window.clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - startedAt);
    const isAbort = err instanceof DOMException && err.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      latencyMs,
      data: null,
      error: isAbort
        ? `Timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'Network request failed',
    };
  }
}

export async function testBackendConnection(backend: BackendApiConfig): Promise<BackendTestResult> {
  const healthPath = normalizeEndpointPath(backend.healthPath, '/api/health');

  if (backend.enabled && !normalizeBaseUrl(backend.baseUrl)) {
    return {
      ok: false,
      status: 0,
      latencyMs: 0,
      resolvedUrl: backend.baseUrl,
      message: 'Enter a valid http:// or https:// Backend API base URL.',
    };
  }

  const resolvedUrl = buildTargetUrl(backend, healthPath);
  const res = await backendRequest<{ service?: string; status?: string; ok?: boolean }>(
    backend,
    healthPath,
    { method: 'GET', timeoutMs: 4500 },
  );

  if (res.ok) {
    const label = backend.enabled ? 'Custom Backend' : 'Built-in Server';
    const serviceSuffix =
      res.data && typeof res.data === 'object' && 'service' in res.data && res.data.service
        ? ` (${res.data.service})`
        : '';
    return {
      ok: true,
      status: res.status,
      latencyMs: res.latencyMs,
      resolvedUrl,
      message: `${label}${serviceSuffix} online · ${res.latencyMs}ms`,
    };
  }

  const suggestProxy = Boolean(backend.enabled && !backend.useServerProxy && res.status === 0);
  return {
    ok: false,
    status: res.status,
    latencyMs: res.latencyMs,
    resolvedUrl,
    suggestProxy,
    message: suggestProxy
      ? 'Could not reach endpoint directly (CORS or network blocked). Try enabling Local CORS Proxy.'
      : `Backend responded with ${res.error || `HTTP ${res.status}`}.`,
  };
}

export async function submitMatchScore(
  backend: BackendApiConfig,
  stats: GameStats,
  difficulty: DifficultyLevel,
  swarmCleared: boolean,
  unlockedAchievements: string[],
  playerMeta?: {
    playerName: string;
    isGuest: boolean;
    authToken?: string | null;
  },
): Promise<{
  ok: boolean;
  message: string;
  entry?: LeaderboardEntry | null;
  user?: PlayerAccount | null;
}> {
  if (!backend.syncScores) {
    return { ok: false, message: '' };
  }

  const scoresPath = normalizeEndpointPath(backend.scoresPath, '/api/scores');
  const payload = {
    playerName: playerMeta?.playerName || 'Guest',
    isGuest: playerMeta ? playerMeta.isGuest : true,
    score: stats.score,
    mosquitoesKilled: stats.mosquitoesKilled,
    totalMosquitoesSpawned: stats.totalMosquitoesSpawned,
    missedAttacks: stats.missedAttacks,
    accuracy: Math.round(stats.accuracy * 10) / 10,
    highestCombo: stats.highestCombo,
    doubleKills: stats.doubleKills,
    tripleKills: stats.tripleKills,
    elapsedSeconds: Math.round(stats.elapsedSeconds * 10) / 10,
    difficulty,
    swarmCleared,
    unlockedAchievements,
    timestamp: new Date().toISOString(),
  };

  const res = await backendRequest<{
    ok?: boolean;
    entry?: LeaderboardEntry;
    user?: PlayerAccount | null;
  }>(backend, scoresPath, {
    method: 'POST',
    body: payload,
    timeoutMs: 4500,
    authToken: playerMeta?.authToken ?? null,
  });

  if (res.ok) {
    const dest = isCustomBackendActive(backend) ? 'custom backend API' : 'leaderboard';
    const who = playerMeta && !playerMeta.isGuest ? `as ${playerMeta.playerName}` : 'as Guest';
    return {
      ok: true,
      message: `Saved ${who} to ${dest} (${res.latencyMs}ms).`,
      entry: res.data?.entry ?? null,
      user: res.data?.user ?? null,
    };
  }
  return {
    ok: false,
    message: `Saved locally · server sync offline (${res.error || `HTTP ${res.status}`}).`,
  };
}

export async function fetchLeaderboard(
  backend: BackendApiConfig,
  filter: 'all' | 'members' | 'guests' = 'all',
  limit = 30,
): Promise<{
  ok: boolean;
  leaderboard: LeaderboardEntry[];
  recent: LeaderboardEntry[];
  error?: string;
}> {
  const basePath = normalizeEndpointPath(backend.scoresPath, '/api/scores');
  const sep = basePath.includes('?') ? '&' : '?';
  const queryPath = `${basePath}${sep}filter=${encodeURIComponent(filter)}&limit=${limit}`;

  const res = await backendRequest<{
    ok?: boolean;
    leaderboard?: LeaderboardEntry[];
    scores?: LeaderboardEntry[];
  }>(backend, queryPath, {
    method: 'GET',
    timeoutMs: 4500,
  });

  if (!res.ok || !res.data) {
    return {
      ok: false,
      leaderboard: [],
      recent: [],
      error: res.error || `HTTP ${res.status}`,
    };
  }

  const recent = Array.isArray(res.data.scores) ? res.data.scores : [];
  const leaderboard = Array.isArray(res.data.leaderboard)
    ? res.data.leaderboard
    : [...recent].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  return {
    ok: true,
    leaderboard,
    recent,
  };
}
