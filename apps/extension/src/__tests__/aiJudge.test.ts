/**
 * AI 判断引擎单元测试：请求构造（Choice/Score/Noul 三原子问题）、响应解析、
 * 裁决组合逻辑（noul ∧ 分类开关 ∧ 置信度阈值），以及传输层（缓存命中、
 * 429 指数退避重试、401 快速失败）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AiJudgeError,
  AI_API_URL,
  buildJudgeRequest,
  CATEGORY_LABELS,
  clearAiCache,
  decideVerdict,
  judgeStateText,
  parseJudgeResponse,
  requestAiJudgement,
  type AiVerdict,
} from '../background/aiJudge';

const verdict = (overrides: Partial<AiVerdict> = {}): AiVerdict => {
  const v = {
    category: 'porn',
    confidence: 0.9,
    severity: 3,
    spamProbability: 0.97,
    probabilities: {},
    model: 'jev-1.13.0',
    ...overrides,
  } as AiVerdict;
  // 概率自洽：normal = 1-noul，剩余质量给 top 类别（decideVerdict 的
  // spamMass/bestSpam 都依赖这个一致性）。
  const normal = Math.max(0, Math.min(1, 1 - v.spamProbability));
  const probabilities: Record<string, number> = {
    porn: 0,
    scam: 0,
    ad: 0,
    bot: 0,
    normal,
  };
  probabilities[v.category] = v.category === 'normal' ? normal : 1 - normal;
  return { ...v, probabilities };
};

const apiResponse = (v: AiVerdict): Response =>
  new Response(
    JSON.stringify({
      model: v.model,
      answers: {
        category: {
          type: 'choice',
          choice: v.category,
          confidence: v.confidence,
          probabilities: v.probabilities,
        },
        severity: { type: 'score', score: v.severity },
        is_spam: { type: 'noul', noul: v.spamProbability },
      },
      usage: { input_tokens: 300, output_tokens: 50 },
    }),
    { status: 200 },
  );

describe('judgeStateText', () => {
  it('normalizes whitespace and invisible chars, truncates long text', () => {
    expect(judgeStateText('  加我微信\u200B领红包\u3000谢谢  ')).toBe('加我微信领红包 谢谢');
    expect(judgeStateText('a'.repeat(1500)).length).toBe(1000);
    expect(judgeStateText('   ')).toBe('');
  });
});

describe('buildJudgeRequest', () => {
  it('asks three atomic questions with structured state and keyword context', () => {
    const req = buildJudgeRequest(
      { text: '垃圾文本', authorName: '葵宝炣♥免费破处', keywordHits: ['福不黑', '约同城'] },
      'jev-test',
    ) as {
      state: { reply_text: string; author_name: string; keyword_hits: string[] };
      model: string;
      questions: Record<string, { type: string; instructions: string; criteria?: unknown }>;
    };
    expect(req.state.reply_text).toBe('垃圾文本');
    expect(req.state.author_name).toBe('葵宝炣♥免费破处');
    expect(req.state.keyword_hits).toEqual(['福不黑', '约同城']);
    // 昵称暗语写进 instructions（作者名是黄推的核心信号位之一）
    expect(req.questions.category.instructions).toContain('author_name');
    expect(req.model).toBe('jev-test');
    expect(req.questions.category.type).toBe('choice');
    // 关键字上下文必须写进 instructions（模型由此理解词库暗语）。
    expect(req.questions.category.instructions).toContain('keyword_hits');
    expect(req.questions.is_spam.instructions).toContain('keyword_hits');
    expect(Object.keys(req.questions.category.criteria as object)).toEqual([
      'porn',
      'scam',
      'ad',
      'bot',
      'normal',
    ]);
    expect(req.questions.severity.type).toBe('score');
    expect(req.questions.is_spam.type).toBe('noul');
  });

  it('falls back to the default model', () => {
    const req = buildJudgeRequest({ text: 'x', authorName: '', keywordHits: [] }, '') as {
      model: string;
    };
    expect(req.model).toBe('jev-latest');
  });
});

describe('parseJudgeResponse', () => {
  it('reads category/severity/noul answers', async () => {
    const v = parseJudgeResponse(await apiResponse(verdict()).json());
    expect(v.category).toBe('porn');
    expect(v.confidence).toBe(0.9);
    expect(v.severity).toBe(3);
    expect(v.spamProbability).toBe(0.97);
    expect(v.model).toBe('jev-1.13.0');
    // usage 拆分：输入计费 / 输出免费
    expect(v.inputTokens).toBe(300);
    expect(v.outputTokens).toBe(50);
    expect(v.tokens).toBe(350);
  });

  it('throws badrequest on malformed payloads', () => {
    expect(() => parseJudgeResponse({ answers: {} })).toThrow(AiJudgeError);
    expect(() =>
      parseJudgeResponse({
        answers: {
          category: { type: 'choice', choice: 'unknown-cat', confidence: 0.5 },
          is_spam: { type: 'noul', noul: 1 },
        },
      }),
    ).toThrow(AiJudgeError);
    expect(() =>
      parseJudgeResponse({
        answers: { category: { type: 'choice', choice: 'porn', confidence: 0.9 } },
      }),
    ).toThrow(AiJudgeError);
  });
});

describe('decideVerdict', () => {
  const config = {
    minConfidence: 0.7,
    categories: { porn: true, scam: true, ad: true, bot: true },
  };

  it('flags enabled spam with an AI·分类 reason', () => {
    const d = decideVerdict(verdict(), config);
    expect(d.isSpam).toBe(true);
    expect(d.reason).toBe(`AI·${CATEGORY_LABELS.porn}`);
  });

  it('cleans when noul says not spam', () => {
    // noul 低 → 模型倾向非垃圾；confidence 与 noul 保持自洽（0.2 的把握）。
    const d = decideVerdict(verdict({ spamProbability: 0.2, confidence: 0.3 }), config);
    expect(d.isSpam).toBe(false);
    expect(d.suspicious).toBe(false);
  });

  it('cleans a confident normal verdict', () => {
    const d = decideVerdict(
      verdict({ category: 'normal', confidence: 0.9, spamProbability: 0.2 }),
      config,
    );
    expect(d.isSpam).toBe(false);
    expect(d.suspicious).toBe(false);
  });

  it('cleans disabled categories (no action) but may stay suspicious', () => {
    const d = decideVerdict(verdict(), {
      ...config,
      categories: { ...config.categories, porn: false },
    });
    expect(d.isSpam).toBe(false);
  });

  it('keyword hits force spam when the model leans spam even at low confidence', () => {
    const d = decideVerdict(verdict({ confidence: 0.43 }), config, ['免费破处']);
    expect(d.isSpam).toBe(true);
    expect(d.reason).toBe(`AI·${CATEGORY_LABELS.porn}`);
  });

  it('keyword hits never force spam when the model clearly says normal', () => {
    const d = decideVerdict(
      verdict({ spamProbability: 0.2, category: 'normal', confidence: 0.9 }),
      config,
      ['免费破处'],
    );
    expect(d.isSpam).toBe(false);
  });

  it('low-confidence normal verdicts land in the amber suspicious tier', () => {
    // 「正常 · 43%」——模型没把握，不能渲染成确定的绿色
    const d = decideVerdict(
      verdict({ category: 'normal', confidence: 0.43, spamProbability: 0.2 }),
      config,
    );
    expect(d.isSpam).toBe(false);
    expect(d.suspicious).toBe(true);
  });

  it('model-leaning spam below the threshold is suspicious, not clean', () => {
    const d = decideVerdict(verdict({ confidence: 0.55 }), config);
    expect(d.isSpam).toBe(false);
    expect(d.suspicious).toBe(true);
  });
});

describe('requestAiJudgement transport', () => {
  const settings = {
    apiKey: 'key-test',
    model: 'jev-latest',
    minConfidence: 0.7,
    categories: { porn: true, scam: true, ad: true, bot: true },
  };
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearAiCache();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the System One endpoint and caches identical texts', async () => {
    fetchMock.mockResolvedValue(apiResponse(verdict()));
    const first = await requestAiJudgement('加我微信领红包', settings);
    expect(first.category).toBe('porn');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AI_API_URL);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer key-test');
    const body = JSON.parse(String(init.body)) as {
      state: { reply_text: string; author_name: string; keyword_hits: string[] };
      questions: unknown;
    };
    expect(body.state.reply_text).toBe('加我微信领红包');
    expect(body.state.keyword_hits).toEqual([]);
    expect(body.questions).toBeDefined();

    const second = await requestAiJudgement('加我微信领红包', settings);
    expect(second.model).toBe('jev-1.13.0');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries 429 with backoff then succeeds', async () => {
    fetchMock.mockResolvedValueOnce(new Response('rate limited', { status: 429 }));
    fetchMock.mockResolvedValueOnce(apiResponse(verdict({ category: 'scam' })));
    const result = await requestAiJudgement('中奖了点击领取', settings, { priority: true });
    expect(result.category).toBe('scam');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('treats identical text with different keyword context as separate judgements', async () => {
    // Response body 只能读一次：每次调用返回全新 Response。
    fetchMock.mockImplementation(async () => apiResponse(verdict()));
    await requestAiJudgement('同样的话', settings);
    await requestAiJudgement('同样的话', settings, { keywordHits: ['福不黑'] });
    // 不同上下文 = 不同判定：缓存不共用，各自打一次 API。
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('fails fast on a bad API key (401) and cools down', async () => {
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(requestAiJudgement('文本一', settings)).rejects.toMatchObject({ kind: 'auth' });
    const callsAfterFirst = fetchMock.mock.calls.length;
    await expect(requestAiJudgement('文本二', settings)).rejects.toMatchObject({ kind: 'auth' });
    // 冷却期内不再打 API。
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('rejects empty text and missing key without any request', async () => {
    await expect(requestAiJudgement('   ', settings)).rejects.toBeInstanceOf(AiJudgeError);
    await expect(requestAiJudgement('文本', { ...settings, apiKey: '' })).rejects.toMatchObject({
      kind: 'nokey',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
