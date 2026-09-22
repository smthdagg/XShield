/**
 * 关键字引擎「仅隐藏」端到端（keywordAutoBlock=false）：
 * 命中收起 + 状态条（关键字 · 内容屏蔽）+ 触发记录 isAutoBlock=false
 * —— 不进入待拉黑队列，自动拉黑永不执行。
 *
 * 独立文件：引擎开关在 init 读取，需要全新模块实例。
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
  // 关键字引擎 + 仅隐藏
  aiEngine: 'keyword',
  keywordAutoBlock: false,
};

const sentMessages: Array<Record<string, unknown>> = [];

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(async (message: Record<string, unknown>) => {
      sentMessages.push(message);
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
    onChanged: { addListener: vi.fn() },
  },
};

describe('content script — 关键字引擎「仅隐藏」', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.resetModules();
    vi.stubGlobal('chrome', chromeMock);
    document.documentElement.replaceChild(document.createElement('body'), document.body);
  });

  it('仅隐藏：命中收起 + 状态条，记录 isAutoBlock=false（不进拉黑队列）', async () => {
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv" id="main">
        <article>
          <div data-testid="User-Name"><a href="/author">Author <span>@author</span></a></div>
          <div data-testid="tweetText">正常的帖子内容</div>
          <time>3h</time><a href="/author/status/123">3h</a>
        </article>
      </div>
      <div data-testid="cellInnerDiv" id="kwHit">
        <article>
          <div data-testid="User-Name"><a href="/kwuser">关键字号 <span>@kwuser</span></a></div>
          <div data-testid="tweetText">她没我比她骚</div>
          <time>1h</time><a href="/kwuser/status/456">1h</a>
        </article>
      </div>
    `;
    window.history.pushState({}, '', '/author/status/123');

    await import('../content/index');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const kwHit = document.getElementById('kwHit')!;
    const main = document.getElementById('main')!;

    // 标记态（延迟 1.5s 收起）+ 状态条（关键字判定，无置信度）
    expect(kwHit.classList.contains('xshield-marked')).toBe(true);
    expect(kwHit.classList.contains('xshield-collapsed')).toBe(false);
    const bar = kwHit.querySelector('.xshield-bar');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('.xshield-bar-verdict')?.textContent).toBe('关键字 · 内容屏蔽');
    expect(bar?.querySelector('.xshield-bar-toggle')?.textContent).toBe('隐藏');
    // 主帖不受影响
    expect(main.classList.contains('xshield-marked')).toBe(false);
    expect(main.classList.contains('xshield-collapsed')).toBe(false);
    expect(main.querySelector('.xshield-bar')).toBeNull();

    // 触发记录照常写入，但 isAutoBlock=false —— 后台不会将其排入拉黑队列。
    const record = sentMessages.find((message) => message.action === 'recordSpam') as
      | { items?: Array<{ user?: string; reason?: string; isAutoBlock?: boolean }> }
      | undefined;
    expect(record).toBeDefined();
    const item = record?.items?.find((entry) => entry.user === 'kwuser');
    expect(item?.reason).toBe('内容屏蔽');
    expect(item?.isAutoBlock).toBe(false);
  });
});
