import { DEFAULT_BACKEND_CONFIG, DIFFICULTY_PROFILES } from '../config/defaults';
import { backendRequest } from '../network/BackendApiClient';
import {
  ActiveChallenge,
  BackendApiConfig,
  DifficultyLevel,
  FlightPattern,
  GameStats,
  LlmConfig,
} from '../types/game';

export type LlmConnectionStatus = 'UNKNOWN' | 'CONNECTED' | 'OFFLINE' | 'DISABLED';

export interface SwarmDirective {
  name: string;
  commentary: string;
  patternBias: Partial<Record<FlightPattern, number>>;
}

const OFFLINE_MISS_TAUNTS = [
  'Oops! You missed me!',
  'Too slow, human!',
  'Haha! Better luck next time!',
  'Mosquito escaped!',
  'Swing and a miss!',
  'Nice breeze, try again!',
  'I dodged that in slow motion!',
  'Clapping at thin air!',
];

const OFFLINE_KILL_QUIPS = [
  'Direct hit! No more buzzing.',
  'Flattened mid-flight!',
  'Precision slap confirmed!',
  'Lights out for that bloodsucker!',
  'Reflexes like a ninja!',
  'Airspace slightly cleaner now!',
];

const OFFLINE_DIALOGUE = [
  'Bzzz... nice webcam lighting!',
  'Bet you cannot clap me!',
  'Zooming right past your nose!',
  'Watch the left flank!',
  'Too fast for your hands!',
  'Free buffet? Sign me up!',
  'Catch me if you can!',
];

const OFFLINE_COMMENTARY = [
  'Swarm airborne — line up those palms and strike clean!',
  'Stay light on your wrists: fast slaps beat reckless flailing.',
  'Wait for two bugs to cross paths for a big Double Kill clap!',
  'Watch the foreground layer — close mosquitoes are prime targets.',
];

const OFFLINE_SWARM_DIRECTIVES: SwarmDirective[] = [
  {
    name: 'Lens Dive-Bomb',
    commentary: 'Mosquitoes are swooping right up to the webcam lens!',
    patternBias: { APPROACH_CAMERA: 2.5, ZIGZAG: 1.6 },
  },
  {
    name: 'Figure-Eight Tease',
    commentary: 'The swarm is circling and hovering just out of reach.',
    patternBias: { CIRCULAR: 2.4, HOVERING: 1.8 },
  },
  {
    name: 'Evasive Scatter',
    commentary: 'Watch out — these bugs are darting wildly on every swing!',
    patternBias: { SUDDEN_ESCAPE: 2.4, ZIGZAG: 2.2 },
  },
];

const OFFLINE_CHALLENGES: Array<Omit<ActiveChallenge, 'id' | 'progress' | 'completed'>> = [
  {
    title: 'Quick Five',
    description: 'Swat 5 mosquitoes to lock in a streak bonus.',
    targetType: 'KILLS',
    targetValue: 5,
    bonusPoints: 40,
  },
  {
    title: 'Combo Architect',
    description: 'Hit a 4x consecutive combo without missing.',
    targetType: 'COMBO',
    targetValue: 4,
    bonusPoints: 60,
  },
  {
    title: 'Two Birds, One Clap',
    description: 'Score a Double Kill in a single clap or slap.',
    targetType: 'DOUBLE_KILL',
    targetValue: 1,
    bonusPoints: 75,
  },
];

/**
 * Local LM Studio OpenAI-compatible client.
 * Never invoked inside the frame loop; strictly asynchronous with aggressive
 * response caching and curated offline fallbacks so gameplay never stalls.
 */
export class LocalLlmService {
  private config: LlmConfig;
  private backendConfig: BackendApiConfig = { ...DEFAULT_BACKEND_CONFIG };
  private status: LlmConnectionStatus = 'UNKNOWN';
  private availableModels: string[] = [];
  private cache: Map<string, string[]> = new Map();
  private lastCallAt = 0;
  private inFlight = false;
  private challengeSeq = 0;

  constructor(config: LlmConfig, backendConfig?: BackendApiConfig) {
    this.config = { ...config };
    if (backendConfig) {
      this.backendConfig = { ...backendConfig };
    }
    if (!config.enabled) {
      this.status = 'DISABLED';
    }
  }

  public updateConfig(config: LlmConfig): void {
    const changed =
      config.endpoint !== this.config.endpoint ||
      config.model !== this.config.model ||
      config.enabled !== this.config.enabled;
    this.config = { ...config };
    if (!config.enabled) {
      this.status = 'DISABLED';
    } else if (changed) {
      this.status = 'UNKNOWN';
    }
  }

  public updateBackendConfig(backendConfig: BackendApiConfig): void {
    this.backendConfig = { ...backendConfig };
  }

  private getEffectiveBackend(): BackendApiConfig | null {
    return this.backendConfig.enabled && this.backendConfig.routeLlmProxy
      ? this.backendConfig
      : null;
  }

  public getStatus(): LlmConnectionStatus {
    return this.status;
  }

  public getAvailableModels(): string[] {
    return this.availableModels;
  }

  public async testConnection(): Promise<{
    ok: boolean;
    status: LlmConnectionStatus;
    models: string[];
    message: string;
  }> {
    if (!this.config.enabled) {
      this.status = 'DISABLED';
      return { ok: false, status: 'DISABLED', models: [], message: 'Local LLM is disabled in settings.' };
    }

    try {
      const res = await backendRequest<{ ok?: boolean; models?: string[]; error?: string }>(
        this.getEffectiveBackend(),
        '/api/llm/models',
        {
          method: 'POST',
          body: {
            endpoint: this.config.endpoint,
            apiKey: this.config.apiKey,
          },
          timeoutMs: 4500,
        },
      );
      const data = res.data ?? {};
      if (res.ok && data.ok) {
        this.status = 'CONNECTED';
        this.availableModels = data.models ?? [];
        const modelSummary =
          this.availableModels.length > 0
            ? `Connected to LM Studio (${this.availableModels.length} model${this.availableModels.length > 1 ? 's' : ''} loaded).`
            : 'Connected to local LLM endpoint.';
        return { ok: true, status: 'CONNECTED', models: this.availableModels, message: modelSummary };
      }
      this.status = 'OFFLINE';
      return {
        ok: false,
        status: 'OFFLINE',
        models: [],
        message: data.error || res.error || 'LM Studio not reachable — running in offline comedy mode.',
      };
    } catch {
      this.status = 'OFFLINE';
      return {
        ok: false,
        status: 'OFFLINE',
        models: [],
        message: 'Local LM Studio offline — using built-in witty dialogue cache.',
      };
    }
  }

  /**
   * Pre-warms cached funny lines asynchronously when LM Studio is connected.
   */
  public warmCachesAsync(): void {
    if (this.status !== 'CONNECTED' || !this.config.enabled) return;
    void this.fetchBatchIntoCache(
      'miss_taunts',
      'Write 6 very short, playful taunts (max 6 words each) a cartoon mosquito shouts when a human swings and misses. Return one per line without numbering.',
    );
    void this.fetchBatchIntoCache(
      'kill_quips',
      'Write 6 short punchy arcade announcer quips (max 8 words each) when a player successfully claps a mosquito. Return one per line without numbering.',
    );
    void this.fetchBatchIntoCache(
      'mosquito_dialogue',
      'Write 6 funny short speech-bubble lines (max 6 words each) from cheeky mosquitoes flying in front of a webcam. Return one per line without numbering.',
    );
  }

  public getMissTaunt(): string {
    return this.pickFromCacheOrFallback('miss_taunts', OFFLINE_MISS_TAUNTS);
  }

  public getKillQuip(): string {
    return this.pickFromCacheOrFallback('kill_quips', OFFLINE_KILL_QUIPS);
  }

  public getMosquitoDialogue(): string {
    return this.pickFromCacheOrFallback('mosquito_dialogue', OFFLINE_DIALOGUE);
  }

  public async getDifficultyDescription(level: DifficultyLevel): Promise<string> {
    const cacheKey = `diff_${level}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.length > 0) return cached[0];

    const fallback = DIFFICULTY_PROFILES[level].summary;
    const reply = await this.askLlm(
      `Write one punchy arcade sentence (max 16 words) describing ${level} difficulty in a webcam mosquito-slapping game.`,
      55,
    );
    if (reply) {
      this.cache.set(cacheKey, [reply]);
      return reply;
    }
    return fallback;
  }

  public async getLiveCommentary(eventSummary: string): Promise<string> {
    const fallback =
      OFFLINE_COMMENTARY[Math.floor(Math.random() * OFFLINE_COMMENTARY.length)];
    const reply = await this.askLlm(
      `You are a witty arcade sports commentator for AI Mosquito Slapper. React in 1 short energetic sentence (max 16 words) to this moment: ${eventSummary}`,
      60,
    );
    return reply || fallback;
  }

  public async suggestSwarmDirective(difficulty: DifficultyLevel): Promise<SwarmDirective> {
    const fallback =
      OFFLINE_SWARM_DIRECTIVES[Math.floor(Math.random() * OFFLINE_SWARM_DIRECTIVES.length)];

    const reply = await this.askLlm(
      `Pick one flight pattern from [ZIGZAG, CIRCULAR, HOVERING, SUDDEN_ESCAPE, APPROACH_CAMERA, RETREAT_CAMERA] for ${difficulty} mosquito swarm and respond strictly as: PATTERN | Short 3-word tactic name | Short 10-word warning.`,
      70,
    );

    if (!reply || !reply.includes('|')) return fallback;
    const parts = reply.split('|').map((s) => s.trim());
    const validPatterns: FlightPattern[] = [
      'ZIGZAG',
      'CIRCULAR',
      'HOVERING',
      'SUDDEN_ESCAPE',
      'APPROACH_CAMERA',
      'RETREAT_CAMERA',
    ];
    const matched = validPatterns.find((p) => parts[0].toUpperCase().includes(p));
    if (!matched) return fallback;

    return {
      name: parts[1]?.slice(0, 32) || fallback.name,
      commentary: parts[2]?.slice(0, 96) || fallback.commentary,
      patternBias: { [matched]: 2.6 },
    };
  }

  public async generatePersonalizedChallenge(stats: GameStats): Promise<ActiveChallenge> {
    const base = OFFLINE_CHALLENGES[this.challengeSeq % OFFLINE_CHALLENGES.length];
    this.challengeSeq++;

    const challenge: ActiveChallenge = {
      id: `chal-${this.challengeSeq}-${Date.now()}`,
      ...base,
      progress: 0,
      completed: false,
    };

    const reply = await this.askLlm(
      `Player has ${stats.mosquitoesKilled} kills, ${Math.round(stats.accuracy)}% accuracy, best combo ${stats.highestCombo}. Rewrite this challenge title and 1-sentence pep line as "TITLE | LINE": ${base.title} - ${base.description}`,
      65,
    );
    if (reply && reply.includes('|')) {
      const [title, desc] = reply.split('|').map((s) => s.trim());
      if (title) challenge.title = title.slice(0, 34);
      if (desc) challenge.description = desc.slice(0, 96);
    }

    return challenge;
  }

  public async generateGameOverDebrief(stats: GameStats, unlockedTitles: string[]): Promise<string> {
    const fallback =
      stats.accuracy >= 75
        ? `Clinical precision! ${stats.mosquitoesKilled} mosquitoes eliminated at ${Math.round(stats.accuracy)}% accuracy.`
        : stats.mosquitoesKilled >= 10
          ? `Solid swarm defense! You bagged ${stats.mosquitoesKilled} mosquitoes with a peak ${stats.highestCombo}x combo.`
          : `The mosquitoes put up a fight! Warm up those clapping hands and run it back.`;

    const reply = await this.askLlm(
      `Summarize an AI Mosquito Slapper game in 1 witty, upbeat sentence (max 22 words). Stats: ${stats.mosquitoesKilled} kills, ${stats.missedAttacks} misses, ${Math.round(stats.accuracy)}% accuracy, ${stats.highestCombo}x max combo, achievements: ${unlockedTitles.join(', ') || 'None'}.`,
      75,
    );
    return reply || fallback;
  }

  private pickFromCacheOrFallback(key: string, fallback: string[]): string {
    const list = this.cache.get(key);
    const source = list && list.length > 0 ? list : fallback;
    return source[Math.floor(Math.random() * source.length)];
  }

  private async fetchBatchIntoCache(key: string, prompt: string): Promise<void> {
    const existing = this.cache.get(key);
    if (existing && existing.length >= 4) return;
    const raw = await this.askLlm(prompt, 180, true);
    if (!raw) return;
    const lines = raw
      .split('\n')
      .map((line) => line.replace(/^[-*\d.)\s"]+/, '').replace(/"+$/, '').trim())
      .filter((line) => line.length >= 4 && line.length <= 68);
    if (lines.length > 0) {
      this.cache.set(key, lines);
    }
  }

  private async askLlm(prompt: string, maxTokens: number, allowParallel = false): Promise<string | null> {
    if (!this.config.enabled || this.status === 'OFFLINE' || this.status === 'DISABLED') {
      return null;
    }

    const now = Date.now();
    if (!allowParallel && (this.inFlight || now - this.lastCallAt < 2500)) {
      return null;
    }

    this.inFlight = true;
    this.lastCallAt = now;

    try {
      const res = await backendRequest<{ ok?: boolean; content?: string }>(
        this.getEffectiveBackend(),
        '/api/llm/chat',
        {
          method: 'POST',
          body: {
            endpoint: this.config.endpoint,
            model: this.config.model,
            apiKey: this.config.apiKey,
            maxTokens,
            temperature: 0.85,
            messages: [
              {
                role: 'system',
                content:
                  'You are the lively arcade announcer for AI Mosquito Slapper. Keep replies ultra-concise, funny, family-friendly, plain text only, no markdown.',
              },
              { role: 'user', content: prompt },
            ],
          },
          timeoutMs: 5000,
        },
      );

      if (!res.ok) {
        if (res.status === 503) this.status = 'OFFLINE';
        return null;
      }

      const data = res.data;
      if (!data?.ok || !data.content) return null;
      this.status = 'CONNECTED';
      return data.content.replace(/^["']|["']$/g, '').trim();
    } catch {
      this.status = 'OFFLINE';
      return null;
    } finally {
      this.inFlight = false;
    }
  }
}
