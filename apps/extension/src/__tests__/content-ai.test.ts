/**
 * AI 模式内容脚本端到端（单模块实例、单用例多场景）：
 *   1. AI 判垃圾 → 隐藏 + 四类彩色标签 + 上报 + HUD 计数
 *   2. AI 否决关键字误报 → 不隐藏、不打标、不上报
 *   3. AI 不可用 → 回退关键字立即生效
 *   4. live 状态框 reset 清零并通知后台
 *
 * 注意：动态状态框/徽标都会改 DOM 并触发 MutationObserver 重扫，而模块里的
 * 延迟全量重扫定时器（600ms+）会跨用例存活 —— 因此所有场景跑在同一个模块
 * 实例里，场景之间替换全新 document.body 并使用互不重复的推文 id，断言在
 * settle 之后的同步块内完成（不会被后续定时器打断）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageData: Record<string, unknown> = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: ['比她骚'].join('\n'),
  disabledCloudKeywords: [],
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
  enabled: true,
  whitelist: [] as string[],
  communityHandles: [] as string[],
  highlightMode: false,
  // AI 引擎开启
  aiEngine: 'ai',
  aiApiKey: 'key-test',
  aiScanAll: true,
};

const sentMessages: Array<Record<string, unknown>> = [];
/** 按文本注入 aiJudge 响应的钩子（后台 aiJudge 会附 meta 用量快照）。 */
let aiResponder: (text: string) => Record<string, unknown>;

const AI_META = {
  calls: 1,
  cacheHits: 0,
  tokens: 457,
  costUsd: 0.000016464,
  chars: 300,
  msPer10kChars: 5800,
  lastLatencyMs: 174,
  avgLatencyMs: 174,
};
const AI_SPAM = {
  ok: true,
  // 1.8.0 默认「仅隐藏」：后台按 aiAutoBlock=false 返回 autoBlock:false
  autoBlock: false,
  decision: { isSpam: true, category: 'scam', confidence: 0.9, reason: 'AI·诈骗' },
  meta: AI_META,
};
const AI_CLEAN = {
  ok: true,
  autoBlock: true,
  decision: { isSpam: false, category: 'normal', confidence: 0.9, reason: '' },
  meta: AI_META,
};
const AI_ERROR = { ok: false, reason: 'network' };

/** 捕获内容脚本注册的 storage.onChanged 监听器，供场景内模拟设置变更。 */
const storageListeners: Array<
  (changes: Record<string, { newValue?: unknown }>, area: string) => void
> = [];

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(async (message: Record<string, unknown>) => {
      sentMessages.push(message);
      if (message.action === 'aiJudge') return aiResponder(String(message.text ?? ''));
      return { success: true };
    }),
    onMessage: { addListener: vi.fn() },
    getManifest: vi.fn(() => ({ version: 'test' })),
  },
  storage: {
    local: {
      get: vi.fn(async (keys: unknown) => {
        if (typeof keys === 'string') return { [keys]: storageData[keys] };
        if (Array.isArray(keys)) {
          const out: Record<string, unknown> = {};
          for (const key of keys) out[key] = storageData[key];
          return out;
        }
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(keys as Record<string, unknown>)) {
          out[key] = storageData[key] ?? (keys as Record<string, unknown>)[key];
        }
        return out;
      }),
      set: vi.fn(async () => {}),
    },
    onChanged: {
      addListener: vi.fn(
        (fn: (changes: Record<string, { newValue?: unknown }>, area: string) => void) => {
          storageListeners.push(fn);
        },
      ),
    },
  },
};

/**
 * 注入一页「主帖 + 三条回复」。`suffix` 区分场景：每个场景用全新的
 * document.body 与互不重复的推文 id，避免上一场景的请求去重表影响判定。
 * 夹具的 <time> 不嵌在 <a> 内（与真实 X 不同），因此四条 cell 都按普通
 * 回帖评估 —— HUD 的扫描基数为 4。
 */
function injectPage(suffix: string): void {
  document.body.innerHTML = `
    <div data-testid="cellInnerDiv" id="main${suffix}">
      <article>
        <div data-testid="User-Name"><a href="/author${suffix}">Author <span>@author${suffix}</span></a></div>
        <div data-testid="tweetText">正常的帖子内容${suffix}</div>
        <time>3h</time><a href="/author${suffix}/status/1${suffix}">3h</a>
      </article>
    </div>
    <div data-testid="cellInnerDiv" id="kwHit${suffix}">
      <article>
        <div data-testid="User-Name"><a href="/kwuser${suffix}">关键字号 <span>@kwuser${suffix}</span></a></div>
        <div data-testid="tweetText">她没我比她骚${suffix}</div>
        <time>1h</time><a href="/kwuser${suffix}/status/2${suffix}">1h</a>
      </article>
    </div>
    <div data-testid="cellInnerDiv" id="aiOnly${suffix}">
      <article>
        <div data-testid="User-Name"><a href="/scammer${suffix}">刷单号 <span>@scammer${suffix}</span></a></div>
        <div data-testid="tweetText">专业刷单返利，加微信马上赚，日结三千${suffix}</div>
        <time>1h</time><a href="/scammer${suffix}/status/3${suffix}">1h</a>
      </article>
    </div>
    <div data-testid="cellInnerDiv" id="clean${suffix}">
      <article>
        <div data-testid="User-Name"><a href="/normal${suffix}">正常人 <span>@normal${suffix}</span></a></div>
        <div data-testid="tweetText">今天天气不错，适合出门${suffix}</div>
        <time>1h</time><a href="/normal${suffix}/status/4${suffix}">1h</a>
      </article>
    </div>
  `;
  window.history.pushState({}, '', `/author${suffix}/status/1${suffix}`);
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 150));
const recordSpamCount = (): number =>
  sentMessages.filter((message) => message.action === 'recordSpam').length;

describe('content script — AI 判断引擎（全链路）', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    storageListeners.length = 0;
    delete storageData.keywordAutoBlock;
    vi.resetModules();
    vi.stubGlobal('chrome', chromeMock);
    // 全新 body：旧实例（若有）的 MutationObserver 绑在被替换的 body 上，自然失活。
    document.documentElement.replaceChild(document.createElement('body'), document.body);
  });

  it('命中处理 / AI 裁决 / 否决 / 回退 / HUD 五场景全链路', async () => {
    // ---- 场景 1：AI 模式，垃圾判诈骗、正常放行 ----
    aiResponder = (text) => (text.includes('比她骚') || text.includes('刷单') ? AI_SPAM : AI_CLEAN);
    injectPage('a');
    await import('../content/index');
    await settle();

    const kwHit = document.getElementById('kwHita')!;
    const aiOnly = document.getElementById('aiOnlya')!;
    const clean = document.getElementById('cleana')!;
    // 命中先淡粉标记可见（触发过程可见），尚未收起
    expect(kwHit.classList.contains('xshield-marked')).toBe(true);
    expect(kwHit.classList.contains('xshield-collapsed')).toBe(false);
    const kwBar = kwHit.querySelector('.xshield-bar');
    expect(kwBar).not.toBeNull();
    expect(kwBar?.querySelector('.xshield-bar-verdict')?.textContent).toBe('AI·诈骗 · 90%');
    expect(kwBar?.querySelector('.xshield-bar-toggle')?.textContent).toBe('隐藏');
    expect(kwBar?.querySelector('.xshield-bar-spam')?.className).toContain(' on');
    expect(aiOnly.classList.contains('xshield-marked')).toBe(true);
    expect(aiOnly.querySelector('.xshield-bar-verdict')?.textContent).toBe('AI·诈骗 · 90%');
    expect(clean.classList.contains('xshield-marked')).toBe(false);
    expect(clean.classList.contains('xshield-collapsed')).toBe(false);
    // 正常回帖也有状态条：绿色「正常」判定 + 概率
    const cleanBar = clean.querySelector('.xshield-bar-verdict');
    expect(cleanBar?.textContent).toBe('正常 · 90%');
    expect(clean.querySelector('.xshield-bar-normal')?.className).toContain(' on');

    // 记录：关键字命中立即上报（内容屏蔽），AI-only 扫描命中走 AI 理由。
    const spamMessages = sentMessages.filter((message) => message.action === 'recordSpam');
    const items = spamMessages.flatMap(
      (message) =>
        (message as { items?: Array<{ user?: string; reason?: string; isAutoBlock?: boolean }> })
          .items ?? [],
    );
    // 1.8.0 默认「仅隐藏」：记录照写，isAutoBlock=false 不进拉黑队列
    const kwItem = items.find((item) => item.user === 'kwusera');
    expect(kwItem?.reason).toBe('内容屏蔽');
    expect(kwItem?.isAutoBlock).toBe(false);
    const aiItem = items.find((item) => item.user === 'scammera');
    expect(aiItem?.reason).toBe('AI·诈骗');
    expect(aiItem?.isAutoBlock).toBe(false);

    // 等待延迟收起定时（1.5s）到点 → 自动收起
    await new Promise((resolve) => setTimeout(resolve, 1600));
    expect(kwHit.classList.contains('xshield-collapsed')).toBe(true);
    expect(kwHit.classList.contains('xshield-marked')).toBe(false);
    expect(aiOnly.classList.contains('xshield-collapsed')).toBe(true);
    // 收起后状态条保留（折叠条），toggle 变「显示」
    expect(kwHit.querySelector('.xshield-bar-verdict')?.textContent).toBe('AI·诈骗 · 90%');
    expect(kwHit.querySelector('.xshield-bar-toggle')?.textContent).toBe('显示');

    // live 状态框在页面上（汇总面板已移除，纠错走每条状态条按钮）。
    const hud = document.getElementById('xshield-hud');
    expect(hud).not.toBeNull();
    expect(hud?.textContent).toContain('X护盾 · live');
    const tiles = hud?.querySelectorAll('.xshield-hud-tile strong') ?? [];
    expect(tiles.length).toBe(4);
    expect(tiles[0]?.textContent).toBe('4'); // 夹具 4 条 cell 均按回帖评估
    expect(tiles[1]?.textContent).toBe('2 (50%)');
    expect(tiles[2]?.textContent).toBe('174 ms');
    // 官方定价（$42/Btok，仅输入计费）折算的美元费用
    expect(tiles[3]?.textContent).toBe('$0.000016');
    // 底行两行：延迟/调用/缓存 + tokens/累计费用/每千条成本/吞吐速度
    const feet = hud?.querySelectorAll('.xshield-hud-foot') ?? [];
    expect(feet.length).toBe(2);
    expect(feet[0]?.textContent).toContain('avg 174 ms · 1 次 AI 调用 · 缓存命中 0 次');
    expect(feet[1]?.textContent).toContain('457 tokens');
    expect(feet[1]?.textContent).toContain('$0.000016 累计');
    expect(feet[1]?.textContent).toContain('$0.0041 / 1,000 回帖');
    expect(feet[1]?.textContent).toContain('5,800 ms / 万字');

    // ---- 场景 2：AI 否决关键字命中（全新 body + 新 id）----
    aiResponder = () => AI_CLEAN;
    const recordsBefore = recordSpamCount();
    injectPage('b');
    await settle();

    const kwHitB = document.getElementById('kwHitb')!;
    // 词库是人工真值：关键字命中后 AI 无权否决 —— 保持标记态（1.5s 后收起）。
    expect(kwHitB.classList.contains('xshield-marked')).toBe(true);
    expect(kwHitB.querySelector('.xshield-bar-verdict')?.textContent).toBe(
      '关键字 · 内容屏蔽（AI 未确认）',
    );
    // 触发记录保留（一条 recordSpam，无撤回）
    expect(recordSpamCount()).toBe(recordsBefore + 1);
    expect(sentMessages.some((message) => message.action === 'removeSpamRecord')).toBe(false);

    // ---- 场景 3：AI 命中处理=仅隐藏（显式 resp.autoBlock=false）→ 照样写触发记录 ----
    aiResponder = () => ({ ...AI_SPAM, autoBlock: false });
    const recordsBeforeC = recordSpamCount();
    injectPage('c');
    await settle();

    const aiOnlyC = document.getElementById('aiOnlyc')!;
    expect(aiOnlyC.classList.contains('xshield-marked')).toBe(true);
    expect(aiOnlyC.querySelector('.xshield-bar-verdict')?.textContent).toBe('AI·诈骗 · 90%');
    const itemsC = sentMessages
      .slice(recordsBeforeC)
      .filter((message) => message.action === 'recordSpam')
      .flatMap(
        (message) =>
          (message as { items?: Array<{ user?: string; reason?: string; isAutoBlock?: boolean }> })
            .items ?? [],
      );
    const aiRecordC = itemsC.find((item) => item.user === 'scammerc');
    expect(aiRecordC?.reason).toBe('AI·诈骗');
    expect(aiRecordC?.isAutoBlock).toBe(false);

    // ---- 场景 4：HUD reset 清零并通知后台 ----
    (hud?.querySelector('.xshield-hud-reset') as HTMLButtonElement).click();
    expect(tiles[0]?.textContent).toBe('0');
    expect(tiles[1]?.textContent).toBe('0 (0%)');
    expect(tiles[2]?.textContent).toBe('—');
    expect(sentMessages.some((message) => message.action === 'aiResetStats')).toBe(true);

    // ---- 场景 5（最后）：AI 不可用 + keywordAutoBlock=false →
    // 关键字回退立即隐藏、写记录但不进拉黑队列。错误场景必须最后跑：
    // 它会启动 60 秒 AI 退避，之后的场景 AI 都不可用。----
    storageData.keywordAutoBlock = false;
    for (const fn of storageListeners) fn({ keywordAutoBlock: { newValue: false } }, 'local');
    aiResponder = () => AI_ERROR;
    injectPage('d');
    await settle();

    const kwHitD = document.getElementById('kwHitd')!;
    expect(kwHitD.classList.contains('xshield-marked')).toBe(true);
    expect(kwHitD.querySelector('.xshield-bar-verdict')?.textContent).toBe('关键字');
    const itemsD = sentMessages
      .filter((message) => message.action === 'recordSpam')
      .flatMap(
        (message) =>
          (message as { items?: Array<{ user?: string; reason?: string; isAutoBlock?: boolean }> })
            .items ?? [],
      );
    const kwRecordD = itemsD.find((item) => item.user === 'kwuserd');
    expect(kwRecordD?.reason).toBe('内容屏蔽');
    expect(kwRecordD?.isAutoBlock).toBe(false);
    delete storageData.keywordAutoBlock;
  });
});
