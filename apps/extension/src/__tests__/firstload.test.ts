/**
 * Regression for "first view doesn't trigger, only after refresh":
 * X renders cell skeletons first and fills the tweet text afterwards. The
 * delayed re-scans must pick up the hydrated text and hide the reply.
 */
import { describe, expect, it, vi } from 'vitest';

const storageData: Record<string, unknown> = {
  keywords: '',
  cloudEnabled: true,
  cloudKeywords: ['比她骚', '福不黑'].join('\n'),
  autoBlockKeywords: [],
  disabledCloudKeywords: [],
  checkUsername: true,
  onlyComments: true,
  blockSpecialChars: false,
  blockEmoji: false,
  blockGrok: false,
  enabled: true,
  whitelist: [] as string[],
  highlightMode: false,
};

const sentMessages: Array<Record<string, unknown>> = [];

const chromeMock = {
  runtime: { id: 't', sendMessage: vi.fn(async (m: Record<string, unknown>) => { sentMessages.push(m); }), onMessage: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn(async (keys: Record<string, unknown>) => {
        const out: Record<string, unknown> = {};
        for (const k of Object.keys(keys)) out[k] = storageData[k] ?? keys[k];
        return out;
      }),
      set: vi.fn(async () => {}),
    },
    onChanged: { addListener: vi.fn() },
  },
};

describe('first-load hydration race', () => {
  it('hides a reply whose text was filled in after the initial scan', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);

    window.history.pushState({}, '', '/author/status/123');
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv" id="skeleton">
        <article>
          <div data-testid="User-Name"><a href="/spammer1">垃圾号 <span>@spammer1</span></a></div>
          <div data-testid="tweetText"></div>
          <time>1h</time><a href="/spammer1/status/999">1h</a>
        </article>
      </div>
    `;

    await import('../content/index');

    // Simulate the skeleton being hydrated after the initial scan.
    await new Promise((r) => setTimeout(r, 100));
    const textNode = document.querySelector('[data-testid="tweetText"]');
    expect(textNode).not.toBeNull();
    if (textNode) textNode.textContent = '比她好看的没她骚比她骚的没她好看';

    // The 3.2s delayed re-scan must catch the hydrated text.
    await new Promise((r) => setTimeout(r, 3600));

    const cell = document.getElementById('skeleton');
    expect(cell?.classList.contains('x-comment-blocker-hidden')).toBe(true);
    const record = sentMessages.find((m) => m.action === 'recordSpam') as { items?: Array<{ user?: string }> } | undefined;
    expect(record?.items?.[0]?.user).toBe('spammer1');
  }, 10000);

  it('hides a reply whose article subtree is injected INSIDE an existing skeleton cell', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number);

    window.history.pushState({}, '', '/author/status/123');
    // Real first-open shape: the cell exists but is an empty skeleton — no
    // article, no tweetText, nothing to evaluate yet.
    document.body.innerHTML = `
      <div data-testid="cellInnerDiv" id="skeleton">
        <div class="skeleton-placeholder"></div>
      </div>
    `;

    await import('../content/index');

    // X then hydrates by inserting the full article subtree INSIDE the
    // existing cell: the cell is an ancestor of the added node, so the
    // observer (not a delayed re-scan) must catch it.
    await new Promise((r) => setTimeout(r, 100));
    const cell = document.getElementById('skeleton');
    expect(cell).not.toBeNull();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `
      <article>
        <div data-testid="User-Name"><a href="/spammer1">垃圾号 <span>@spammer1</span></a></div>
        <div data-testid="tweetText">比她好看的没她骚比她骚的没她好看</div>
        <time>1h</time><a href="/spammer1/status/999">1h</a>
      </article>
    `;
    cell!.appendChild(wrapper);

    // Assert well before the first 600 ms delayed re-scan: the observer path
    // itself must have hidden the reply.
    await new Promise((r) => setTimeout(r, 350));

    expect(cell?.classList.contains('x-comment-blocker-hidden')).toBe(true);
    const record = sentMessages.find((m) => m.action === 'recordSpam') as { items?: Array<{ user?: string }> } | undefined;
    expect(record?.items?.[0]?.user).toBe('spammer1');
  }, 5000);
});
