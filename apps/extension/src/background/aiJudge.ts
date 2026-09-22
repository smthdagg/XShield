/**
 * AI 判断引擎 — TypeSafe System One (Jev) client.
 *
 * Docs: https://docs.typesafe.ai/introduction · HTTP API: https://docs.typesafe.ai/api.md
 * Endpoint: POST https://api.typesafe.ai/v1/systemone · Bearer auth.
 *
 * One call evaluates three atomic questions in parallel against the reply
 * text (the docs' "atomic question" principle — each question asks one thing,
 * the code combines the answers):
 *   category (choice) — 黄推 / 诈骗 / 纯广告 / 人机 / 正常
 *   severity (score)  — 0–3 垃圾程度
 *   is_spam  (noul)   — 是否垃圾内容
 *
 * Decision rule: noul ≥ 0.5 ∧ category enabled ∧ choice-confidence ≥ threshold.
 *
 * Transport hardening for timeline-scale use: module-level FIFO queue
 * (concurrency cap + min interval), in-flight dedupe, LRU verdict cache,
 * exponential backoff on 429/529/network errors, fail-fast on bad API key.
 * The module is side-effect free at import time so tests can load it directly.
 */
import { normalizeHitText } from '../store/blockerStorage';

export type AiCategory = 'porn' | 'scam' | 'ad' | 'bot' | 'normal';

export const AI_API_URL = 'https://api.typesafe.ai/v1/systemone';
export const AI_DEFAULT_MODEL = 'jev-latest';
/**
 * 官方定价（docs.typesafe.ai/models，Jev 1.13）：$42 / Btok（十亿 token），
 * 仅输入 token 计费，输出免费 —— 即 $0.042 / Mtok。
 */
export const PRICE_USD_PER_BILLION_INPUT_TOKENS = 42;
export const PRICE_USD_PER_INPUT_TOKEN = PRICE_USD_PER_BILLION_INPUT_TOKENS / 1_000_000_000;

/** Judge at most this many characters of a reply (state payload size guard). */
const JUDGE_TEXT_MAX = 1000;

export const CATEGORY_LABELS: Record<AiCategory, string> = {
  porn: '黄推',
  scam: '诈骗',
  ad: '纯广告',
  bot: '人机',
  normal: '正常',
};

export type AiActionableCategory = Exclude<AiCategory, 'normal'>;

export interface AiVerdict {
  category: AiCategory;
  /** Choice confidence 0–1 (derived from the probability distribution). */
  confidence: number;
  /** Score 0–3 weighted value from the severity rubric. */
  severity: number;
  /** Noul probability 0–1 for "is spam". */
  spamProbability: number;
  probabilities: Record<string, number>;
  model: string;
  /** Input token usage reported by the API (billed), when present. */
  inputTokens?: number;
  /** Output token usage reported by the API (free of charge), when present. */
  outputTokens?: number;
  /** Convenience total (input + output), when present. */
  tokens?: number;
}

export interface AiDecisionConfig {
  minConfidence: number;
  categories: Record<AiActionableCategory, boolean>;
}

export interface AiDecision {
  isSpam: boolean;
  /** 偏垃圾但置信度未达阈值：仅提示，不隐藏不上报。 */
  suspicious: boolean;
  category: AiCategory;
  confidence: number;
  /** Dashboard/queue reason string, e.g. 「AI·黄推」. */
  reason: string;
}

export type AiErrorKind =
  | 'auth'
  | 'rate'
  | 'server'
  | 'network'
  | 'badrequest'
  | 'overflow'
  | 'disabled'
  | 'nokey';

export class AiJudgeError extends Error {
  kind: AiErrorKind;
  constructor(kind: AiErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'AiJudgeError';
  }
}

export interface AiSettings {
  apiKey: string;
  model: string;
  minConfidence: number;
  categories: Record<AiActionableCategory, boolean>;
}

// ---------------------------------------------------------------------------
// Request/response shaping (pure — unit-tested directly)
// ---------------------------------------------------------------------------

/** Normalize + truncate reply text into the `state` payload. */
export function judgeStateText(text: string): string {
  return normalizeHitText(text).slice(0, JUDGE_TEXT_MAX);
}

/** 判定输入：回帖文本 + 作者名 + 词库命中的关键字（预筛信号，可为空）。 */
export interface JudgeInput {
  text: string;
  /** 作者昵称/@handle —— 黄推/导流账号常把暗语写在昵称里（如「免费破处」「无偿约」）。 */
  authorName: string;
  /** 内容脚本词库命中的词/正则片段（去重、最多 5 个）。 */
  keywordHits: string[];
}

/**
 * 结构化 state（文档模式：instructions 用反引号引用 state 字段）。
 * `keyword_hits` 把用户的屏蔽词库作为预筛信号喂给模型 —— 词库命中 + 文本
 * 语义共同决定分类，模型由此「理解」黄推暗语（如"福不黑""玩的开"）。
 */
export function buildJudgeRequest(input: JudgeInput, model: string): Record<string, unknown> {
  return {
    state: {
      reply_text: input.text,
      author_name: input.authorName,
      keyword_hits: input.keywordHits.slice(0, 5),
    },
    model: model || AI_DEFAULT_MODEL,
    questions: {
      category: {
        type: 'choice',
        instructions:
          '判断这条 X(Twitter) 回帖属于哪一类。评估对象是 `reply_text`（回帖正文）与' +
          ' `author_name`（作者昵称——黄推/导流账号常把暗语写在昵称里，如「免费破处」' +
          '「处女无偿」「无偿约」「主页联系实时匹配」，昵称含此类暗语即强烈指向黄推/导流）；' +
          ' `keyword_hits` 是命中的用户屏蔽词库词条（来自长期维护的垃圾词库，空数组表示' +
          '未命中）。词库命中是强预筛信号：命中时该回帖极大概率是黄推/诈骗/广告类导流' +
          '内容，除非正文明显是在进行正常讨论。',
        criteria: {
          porn:
            '黄推/色情导流:性暗示或招嫖暗语（如「玩的开」「福不黑」「约同城」「上门」类暗示话术）、' +
            '大尺度自我介绍配图引流、引诱私聊/付费看片、 uncensored 内容推销等',
          scam:
            '诈骗:假冒客服或官方、中奖领取、兼职刷单返利、投资理财/加密货币带单、' +
            '钓鱼链接、冒充名人赠礼等欺诈内容',
          ad:
            '纯广告:与讨论无关的商品/服务推广、微商代购、引流到微信/ TG 群、' +
            '代刷粉丝点赞、促销链接堆砌等营销内容',
          bot: '人机:模板化复读、与语境无关的乱码、无意义刷屏、批量雷同文案等机器人行为',
          normal: '正常讨论:与推文话题相关的真人互动回复',
        },
      },
      severity: {
        type: 'score',
        instructions:
          '评估 `reply_text` 与 `author_name` 的垃圾程度（`keyword_hits` 非空时至少为 2）',
        criteria: [
          '正常内容,无需处理',
          '轻微可疑:略带营销或擦边,但仍是人的正常表达',
          '明显垃圾:确定的黄推/诈骗/广告/人机内容',
          '严重垃圾:高置信度的恶意导流或欺诈',
        ],
      },
      is_spam: {
        type: 'noul',
        instructions:
          '`reply_text` 是否为垃圾内容（黄推/诈骗/纯广告/人机之一）而非正常讨论。' +
          '`keyword_hits` 非空时,除非正文明显正常,否则应回答是',
        criteria: {
          true: '答案为是:内容属于四类垃圾之一',
          false: '答案为否:内容是正常讨论或无法确定',
        },
      },
    },
  };
}

interface SystemOneAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  score?: number;
  noul?: number;
  probabilities?: Record<string, number>;
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<string, SystemOneAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Parse the System One response into a verdict; throws on malformed payloads. */
export function parseJudgeResponse(data: unknown): AiVerdict {
  const body = (data ?? {}) as SystemOneResponse;
  const answers = body.answers ?? {};
  const categoryAnswer = answers.category;
  const severityAnswer = answers.severity;
  const spamAnswer = answers.is_spam;
  const category = categoryAnswer?.choice as AiCategory | undefined;
  if (!category || !(category in CATEGORY_LABELS)) {
    throw new AiJudgeError('badrequest', 'AI 响应缺少有效分类');
  }
  if (typeof spamAnswer?.noul !== 'number') {
    throw new AiJudgeError('badrequest', 'AI 响应缺少垃圾概率');
  }
  const confidence = typeof categoryAnswer?.confidence === 'number' ? categoryAnswer.confidence : 0;
  const inputTokens =
    typeof body.usage?.input_tokens === 'number' ? body.usage.input_tokens : undefined;
  const outputTokens =
    typeof body.usage?.output_tokens === 'number' ? body.usage.output_tokens : undefined;
  return {
    category,
    confidence,
    severity: typeof severityAnswer?.score === 'number' ? severityAnswer.score : 0,
    spamProbability: spamAnswer.noul,
    probabilities: categoryAnswer?.probabilities ?? {},
    model: typeof body.model === 'string' ? body.model : AI_DEFAULT_MODEL,
    inputTokens,
    outputTokens,
    tokens:
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined,
  };
}

/**
 * Combine the three answers into an actionable decision. Conservative by
 * design: any of (not spam / category disabled / low confidence) → clean.
 */
/**
 * 评分裁决（1.7.0 重构）—— 回答「究竟多少分是垃圾」：
 *  - 垃圾：模型高置信判垃圾（top 类别为启用垃圾类 ∧ confidence ≥ 阈值 ∧ noul 过半），
 *    或 **词库强制**（keyword_hits 非空 ∧ noul 过半 —— 词库是人工维护的真值，
 *    模型犹豫时听词库的）；类别取概率最高的启用垃圾类。
 *  - 可疑（琥珀）：未达垃圾线但模型偏垃圾（noul ≥ 0.5 或四类概率和 ≥ 0.5），
 *    或 top=normal 但置信度低于阈值（「正常 · 43%」这种就是模型没把握）。
 *  - 正常（绿）：其余。
 */
export function decideVerdict(
  verdict: AiVerdict,
  config: AiDecisionConfig,
  keywordHits: string[] = [],
): AiDecision {
  const probs = verdict.probabilities ?? {};
  const normalProb = typeof probs.normal === 'number' ? probs.normal : 0;
  const spamMass = Math.max(0, 1 - normalProb);
  const noul = verdict.spamProbability;

  const enabledOf = (c: AiCategory) =>
    c !== 'normal' && (config.categories as Record<string, boolean>)[c] !== false;

  // 概率最高的启用垃圾类（词库强制时用它作归类，top choice 可能是 normal）。
  let bestSpam: AiCategory | null = null;
  let bestProb = -1;
  for (const c of ['porn', 'scam', 'ad', 'bot'] as AiCategory[]) {
    if (!enabledOf(c)) continue;
    const p = typeof probs[c] === 'number' ? (probs[c] as number) : 0;
    if (p > bestProb) {
      bestProb = p;
      bestSpam = c;
    }
  }

  const topActionable = verdict.category !== 'normal';
  const modelSpam =
    topActionable &&
    enabledOf(verdict.category) &&
    verdict.confidence >= config.minConfidence &&
    noul >= 0.5;
  const forced = keywordHits.length > 0 && noul >= 0.5 && bestSpam !== null;
  const isSpam = modelSpam || forced;
  const finalCategory = isSpam
    ? ((modelSpam ? verdict.category : bestSpam) ?? verdict.category)
    : verdict.category;

  const suspicious =
    !isSpam &&
    bestSpam !== null &&
    (noul >= 0.35 ||
      spamMass >= 0.5 ||
      // top 是垃圾类且有一定把握（置信度过半）但未达阈值
      (topActionable && enabledOf(verdict.category) && verdict.confidence >= 0.5) ||
      // top=normal 但模型没把握（「正常 · 43%」这种）——不能渲染成确定的绿色
      (verdict.category === 'normal' && verdict.confidence < config.minConfidence));

  return {
    isSpam,
    suspicious,
    category: finalCategory,
    confidence: verdict.confidence,
    reason: isSpam ? `AI·${CATEGORY_LABELS[finalCategory]}` : '',
  };
}

// ---------------------------------------------------------------------------
// Transport: queue + cache + retry (module singleton)
// ---------------------------------------------------------------------------

const CACHE_MAX = 2000;
const MAX_CONCURRENT = 2;
const MIN_INTERVAL_MS = 300;
const MAX_QUEUE = 300;
const RETRY_LIMIT = 3;
const REQUEST_TIMEOUT_MS = 15000;
/** After a 401, fail fast for this long instead of hammering with a bad key. */
const AUTH_COOLDOWN_MS = 60_000;

const verdictCache = new Map<string, AiVerdict>();
const inflightByText = new Map<string, Promise<AiVerdict>>();
interface QueueTask {
  state: string;
  cacheKey: string;
  input: { text: string; keywordHits: string[]; authorName: string };
  settings: AiSettings;
  priority: boolean;
  resolve: (v: AiVerdict) => void;
  reject: (e: AiJudgeError) => void;
}
const taskQueue: QueueTask[] = [];
let inFlight = 0;
let lastCallAt = 0;
let authFailedAt = 0;

const stats = {
  calls: 0,
  cacheHits: 0,
  errors: 0,
  lastError: '',
  lastErrorAt: 0,
  /** Cumulative billed input tokens over fresh (non-cached) API calls. */
  inputTokens: 0,
  /** Cumulative free output tokens. */
  outputTokens: 0,
  /** 判定字数（仅新鲜调用，用于吞吐指标 ms/万字）。 */
  chars: 0,
  /** Latency of the most recent fresh API call, and a running sum for the avg. */
  lastLatencyMs: 0,
  latencySumMs: 0,
};

export function aiEngineStats(): {
  calls: number;
  cacheHits: number;
  errors: number;
  queueDepth: number;
  cacheSize: number;
  lastError: string;
  lastErrorAt: number;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  /** 按 AI 费用计算（仅输入 token 计费）折算的美元成本。 */
  costUsd: number;
  /** 判定字数（新鲜调用）。 */
  chars: number;
  /** 吞吐速度：平均每 1 万字元耗时（ms）。 */
  msPer10kChars: number;
  lastLatencyMs: number;
  avgLatencyMs: number;
} {
  const tokens = stats.inputTokens + stats.outputTokens;
  return {
    ...stats,
    tokens,
    queueDepth: taskQueue.length,
    cacheSize: verdictCache.size,
    costUsd: stats.inputTokens * PRICE_USD_PER_INPUT_TOKEN,
    msPer10kChars: stats.chars > 0 ? Math.round((stats.latencySumMs / stats.chars) * 10_000) : 0,
    avgLatencyMs: stats.calls > 0 ? Math.round(stats.latencySumMs / stats.calls) : 0,
  };
}

/** Zero the session counters (page HUD「reset」按钮) — queue and cache stay. */
export function resetAiStats(): void {
  stats.calls = 0;
  stats.cacheHits = 0;
  stats.errors = 0;
  stats.inputTokens = 0;
  stats.outputTokens = 0;
  stats.chars = 0;
  stats.lastLatencyMs = 0;
  stats.latencySumMs = 0;
  stats.lastError = '';
  stats.lastErrorAt = 0;
}

export function clearAiCache(): void {
  verdictCache.clear();
  inflightByText.clear();
}

function cacheGet(key: string): AiVerdict | undefined {
  const hit = verdictCache.get(key);
  if (hit) {
    // Refresh insertion order — a plain Map is our LRU.
    verdictCache.delete(key);
    verdictCache.set(key, hit);
  }
  return hit;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function callTypeSafeApi(
  input: { text: string; keywordHits: string[]; authorName: string },
  settings: AiSettings,
): Promise<AiVerdict> {
  const response = await fetch(AI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildJudgeRequest(input, settings.model)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) {
    throw new AiJudgeError('auth', 'API Key 无效或已过期（401）');
  }
  if (response.status === 429 || response.status === 529) {
    throw new AiJudgeError('rate', `AI 服务限流/过载（HTTP ${response.status}）`);
  }
  if (response.status === 422) {
    const detail = await response.text().catch(() => '');
    throw new AiJudgeError('badrequest', `AI 请求被拒绝（422）${detail.slice(0, 120)}`);
  }
  if (!response.ok) {
    throw new AiJudgeError('server', `AI 服务错误（HTTP ${response.status}）`);
  }
  return parseJudgeResponse(await response.json());
}

async function runTask(task: QueueTask): Promise<void> {
  const { cacheKey, input, settings } = task;
  try {
    let lastError: AiJudgeError | null = null;
    for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
      // Gentle pacing between API calls.
      const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      stats.calls++;
      const startedAt = Date.now();
      try {
        const verdict = await callTypeSafeApi(input, settings);
        // Fresh-call telemetry for the page HUD (cache hits don't skew these).
        stats.lastLatencyMs = Date.now() - startedAt;
        stats.latencySumMs += stats.lastLatencyMs;
        stats.inputTokens += verdict.inputTokens ?? 0;
        stats.outputTokens += verdict.outputTokens ?? 0;
        stats.chars += input.text.length;
        verdictCache.set(cacheKey, verdict);
        if (verdictCache.size > CACHE_MAX) {
          verdictCache.delete(verdictCache.keys().next().value as string);
        }
        task.resolve(verdict);
        return;
      } catch (e) {
        lastError =
          e instanceof AiJudgeError
            ? e
            : new AiJudgeError(
                e instanceof Error && e.name === 'TimeoutError' ? 'network' : 'server',
                e instanceof Error ? e.message : String(e),
              );
        stats.errors++;
        stats.lastError = lastError.message;
        stats.lastErrorAt = Date.now();
        const retryable =
          lastError.kind === 'rate' || lastError.kind === 'server' || lastError.kind === 'network';
        if (lastError.kind === 'auth') authFailedAt = Date.now();
        if (!retryable || attempt === RETRY_LIMIT) break;
        // Docs: retry 429/529 with exponential backoff, not immediately.
        await sleep(400 * 2 ** attempt + Math.random() * 250);
      }
    }
    task.reject(lastError ?? new AiJudgeError('server', 'AI 判定失败'));
  } finally {
    inFlight--;
    void pumpQueue();
  }
}

async function pumpQueue(): Promise<void> {
  while (inFlight < MAX_CONCURRENT && taskQueue.length > 0) {
    // Priority (keyword-hit) tasks jump the queue.
    const idx = taskQueue.findIndex((t) => t.priority);
    const task = taskQueue.splice(idx === -1 ? 0 : idx, 1)[0];
    inFlight++;
    void runTask(task);
  }
}

/**
 * Judge one reply text. Resolves with the verdict or rejects with
 * AiJudgeError — callers decide the fallback (keyword behaviour).
 */
export async function requestAiJudgement(
  rawText: string,
  settings: AiSettings,
  options: { priority?: boolean; keywordHits?: string[]; authorName?: string } = {},
): Promise<AiVerdict> {
  const state = judgeStateText(rawText);
  if (!state) throw new AiJudgeError('badrequest', '空文本不判定');
  if (!settings.apiKey) throw new AiJudgeError('nokey', '未配置 TypeSafe API Key');
  // 缓存键必须包含全部上下文：同文本不同的词库命中/作者名是不同判定
  //（昵称暗语会改变结论，不能共用缓存）。
  const keywordHits = (options.keywordHits ?? [])
    .map((k) => k.slice(0, 50))
    .filter(Boolean)
    .slice(0, 5);
  const authorName = (options.authorName ?? '').slice(0, 80);
  const contextKey = [keywordHits.sort().join(','), authorName].filter(Boolean).join('|');
  const cacheKey = contextKey ? `${state}\u0000${contextKey}` : state;

  const cached = cacheGet(cacheKey);
  if (cached) {
    stats.cacheHits++;
    return cached;
  }

  const pending = inflightByText.get(cacheKey);
  if (pending) return pending;

  if (Date.now() - authFailedAt < AUTH_COOLDOWN_MS) {
    throw new AiJudgeError('auth', 'API Key 无效（冷却中，请在设置中检查）');
  }

  if (taskQueue.length >= MAX_QUEUE && !options.priority) {
    throw new AiJudgeError('overflow', 'AI 队列已满，本轮跳过');
  }

  const promise = new Promise<AiVerdict>((resolve, reject) => {
    taskQueue.push({
      state,
      cacheKey,
      input: { text: state, keywordHits, authorName },
      settings,
      priority: options.priority === true,
      resolve,
      reject,
    });
  });
  // In-flight dedupe: identical texts share one request. The tracking promise
  // rejects together with the caller's — swallow that duplicate so a rejected
  // judgement never surfaces as an unhandled rejection.
  const tracked = promise.finally(() => inflightByText.delete(cacheKey));
  tracked.catch(() => {});
  inflightByText.set(cacheKey, tracked);
  void pumpQueue();
  return promise;
}
