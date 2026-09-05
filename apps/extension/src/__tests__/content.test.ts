/**
 * Real end-to-end check of the content script against a simulated X page:
 * loads the actual module (with chrome APIs mocked), injects tweets, and
 * verifies hide/highlight + recordSpam reporting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const storageData: Record<string, unknown> = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: ['比她骚', '没她好看', '福不黑', '约同城'].join('\n'),
  autoBlockKeywords: ['比她骚'],
  disabledCloudKeywords: [],
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
  enabled: true,
  whitelist: [] as string[],
  communityHandles: ['spammy1'],
  highlightMode: false,
};

const sentMessages: Array<Record<string, unknown>> = [];

const chromeMock = {
  runtime: {
    id: 'test-extension-id',
    sendMessage: vi.fn(async (message: Record<string, unknown>) => {
      sentMessages.push(message);
    }),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (keys: unknown) => {
        if (typeof keys === 'string') {
          return { [keys]: storageData[keys] };
        }
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

describe('content script end-to-end', () => {
  beforeEach(() => {
    sentMessages.length = 0;
    vi.stubGlobal('chrome', chromeMock);
  });

  it('hides spam replies and reports them to the background', async () => {
    // Simulated status page: /someone/status/123 with a main tweet + replies.
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv" id="main">
        <article>
          <div data-testid="User-Name"><a href="/author">Author <span>@author</span></a></div>
          <div data-testid="tweetText">正常的帖子内容</div>
          <time>3h</time><a href="/author/status/123">3h</a>
        </article>
      </div>
      <div data-testid="cellInnerDiv" id="reply1">
        <article>
          <div data-testid="User-Name"><a href="/spammer1">垃圾号 <span>@spammer1</span></a></div>
          <div data-testid="tweetText">比她好看的没她骚比她骚的没她好看</div>
          <time>1h</time><a href="/spammer1/status/456">1h</a>
        </article>
      </div>
      <div data-testid="cellInnerDiv" id="community1">
        <article>
          <div data-testid="User-Name"><a href="/spammy1">分享号 <span>@spammy1</span></a></div>
          <div data-testid="tweetText">完全无害的正常内容文本</div>
          <time>1h</time><a href="/spammy1/status/777">1h</a>
        </article>
      </div>
      <div data-testid="cellInnerDiv" id="nickname1">
        <article>
          <div data-testid="User-Name"><a href="/yuetongcheng">约同城的点我 <span>@yuetongcheng</span></a></div>
          <div data-testid="tweetText">今天天气不错</div>
          <time>1h</time><a href="/yuetongcheng/status/888">1h</a>
        </article>
      </div>
      <div data-testid="cellInnerDiv" id="reply2">
        <article>
          <div data-testid="User-Name"><a href="/normal2">正常人 <span>@normal2</span></a></div>
          <div data-testid="tweetText">今天天气不错</div>
          <time>1h</time><a href="/normal2/status/789">1h</a>
        </article>
      </div>
    `;
    window.history.pushState({}, '', '/author/status/123');

    await import('../content/index');
    // Let the async init + microtasks settle.
    await new Promise((resolve) => setTimeout(resolve, 100));

    const spam = document.getElementById('reply1');
    const normal = document.getElementById('reply2');
    const main = document.getElementById('main');
    const community = document.getElementById('community1');
    const nickname = document.getElementById('nickname1');

    expect(spam?.classList.contains('x-comment-blocker-hidden')).toBe(true);
    expect(normal?.classList.contains('x-comment-blocker-hidden')).toBe(false);
    expect(main?.classList.contains('x-comment-blocker-hidden')).toBe(false);
    // Layer 3 — nickname detection: clean text, spam display name → hidden.
    expect(nickname?.classList.contains('x-comment-blocker-hidden')).toBe(true);
    // Community-shared handle: clean text still hidden + auto-block flagged.
    expect(community?.classList.contains('x-comment-blocker-hidden')).toBe(true);

    const record = sentMessages.find((message) => message.action === 'recordSpam') as
      | { items?: Array<{ user?: string; text?: string; isAutoBlock?: boolean; displayName?: string }> }
      | undefined;
    expect(record).toBeDefined();
    const item = record?.items?.[0];
    expect(item?.user).toBe('spammer1');
    expect(item?.text).toContain('比她好看的没她骚');
    expect(item?.isAutoBlock).toBe(true);
  });
});
