/**
 * Background ledger integration test — the 1.5.1 anti-drift contract:
 *
 *   triggered record (blockedHistory)
 *     → block call SUCCEEDS (screen_name POST to blocks/create.json)
 *       → record STAYS in blockedHistory (records are never deleted) and the
 *         user is appended to the `blockedUsersOnX` ledger in the same
 *         success branch
 *     → permanent failure (deleted account, API codes 34/50/63)
 *       → record stays, ledger untouched, item dropped from the queue
 *     → transient failure (HTTP 500)
 *       → item pushed back onto the queue for retry
 *     → rate limit (HTTP 429)
 *       → item unshifted back to the queue front, auto-block paused 15 min
 *
 * The real background module is loaded with chrome APIs mocked, and the
 * auto-block queue drains through the real AutoBlockManager.process().
 */
import { describe, expect, it, vi } from 'vitest';

const storageData: Record<string, unknown> = {};
const messageListeners: Array<
  (message: Record<string, unknown>, sender: unknown, sendResponse: (res: unknown) => void) => boolean | void
> = [];

function resetStorage(): void {
  for (const key of Object.keys(storageData)) delete storageData[key];
}

function makeChromeMock() {
  return {
    runtime: {
      id: 'test',
      getURL: (path: string) => `chrome-extension://test/${path}`,
      getManifest: () => ({ version: 'test' }),
      onInstalled: { addListener: vi.fn() },
      onMessage: {
        addListener: (fn: (typeof messageListeners)[number]) => {
          messageListeners.push(fn);
        },
      },
      sendMessage: vi.fn(),
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
            const stored = storageData[key];
            out[key] = stored === undefined ? (keys as Record<string, unknown>)[key] : stored;
          }
          return out;
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storageData, items);
        }),
      },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    cookies: { get: vi.fn(async () => ({ value: 'ct0-token' })) },
    tabs: { query: vi.fn(async () => []), sendMessage: vi.fn(async () => {}) },
    contextMenus: {
      removeAll: vi.fn((cb?: () => void) => cb?.()),
      create: vi.fn((_: unknown, cb?: () => void) => cb?.()),
    },
  };
}

let chromeMock: ReturnType<typeof makeChromeMock>;

function dispatch(message: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve) => {
    let delivered = false;
    for (const listener of messageListeners) {
      const keepOpen = listener(message, {}, (res) => {
        delivered = true;
        resolve(res);
      });
      if (keepOpen === true) return; // response arrives via sendResponse later
      if (delivered) return;
    }
    resolve(undefined);
  });
}

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Happy path: block/unblock API accepts the screen_name POST. */
function okFetch(): FetchImpl {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('blocks/create.json') || url.includes('blocks/destroy.json')) {
      return new Response(JSON.stringify({ screen_name: 'whatever' }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as FetchImpl;
}

async function bootstrap(seed?: Record<string, unknown>, fetchImpl?: FetchImpl): Promise<void> {
  vi.resetModules();
  vi.unstubAllGlobals();
  resetStorage();
  messageListeners.length = 0;
  chromeMock = makeChromeMock();
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('fetch', fetchImpl ?? okFetch());
  Object.assign(storageData, { blockedUsersOnX: [], autoBlockQueue: [], blockedHistory: [] }, seed);
  await import('../background/index');
}

function record(id: string, user: string, isAutoBlock: boolean): Record<string, unknown> {
  return {
    id,
    text: '比她骚',
    user,
    displayName: '垃圾号',
    reason: '内容屏蔽',
    time: Date.now(),
    isAutoBlock,
  };
}

describe('background block ledger (1.5.1 anti-drift)', () => {
  it('screen_name POST contract: create.json receives screen_name=, not user_id=', async () => {
    const fetchImpl = okFetch();
    await bootstrap({ blockedHistory: [record('tweet-3', 'spammer1', false)] }, fetchImpl);

    await dispatch({ action: 'blockUserOnX', screenName: '@Spammer1' });

    await vi.waitFor(() => expect(storageData.blockedUsersOnX).toContain('spammer1'), {
      timeout: 5000,
      interval: 25,
    });
    const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
    const createCall = mock.mock.calls.find((call) => String(call[0]).includes('blocks/create.json'));
    expect(createCall).toBeDefined();
    const init = createCall?.[1] as RequestInit;
    expect(String(init.body)).toBe('screen_name=spammer1');
    // Handle is cleaned and lower-cased before the request.
    expect(String(init.body)).not.toContain('@');
  });

  it('successful auto-block: record STAYS in triggered history, ledger gains the user', async () => {
    await bootstrap();
    await dispatch({ action: 'recordSpam', items: [record('tweet-1', 'spammer1', true)] });

    await vi.waitFor(
      () => {
        expect(storageData.autoBlockQueue).toEqual([]);
        expect(storageData.autoBlockToday).toBe(1);
        expect(storageData.blockedUsersOnX).toContain('spammer1');
        // 1.5.1 model: the trigger record is never removed by a block.
        expect(
          (storageData.blockedHistory as Array<{ id: string }>).some((item) => item.id === 'tweet-1'),
        ).toBe(true);
      },
      { timeout: 5000, interval: 25 },
    );
  });

  it('manual blockUserOnX succeeds: ledger gains the user, trigger records untouched', async () => {
    await bootstrap({
      blockedHistory: [record('tweet-3', 'spammer1', false), record('tweet-4', 'someone', false)],
      blockedCount: 2,
    });

    const res = (await dispatch({ action: 'blockUserOnX', screenName: 'spammer1' })) as {
      success?: boolean;
      screenName?: string;
    };

    expect(res?.success).toBe(true);
    expect(res?.screenName).toBe('spammer1');
    expect(storageData.blockedUsersOnX).toContain('spammer1');
    // Both records stay exactly as they were — including spammer1's.
    expect((storageData.blockedHistory as Array<{ id: string }>).length).toBe(2);
    expect(storageData.blockedCount).toBe(2);
  });

  it('permanent failure (code 63, account suspended): ledger untouched, item dropped', async () => {
    const suspendedFetch: FetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('blocks/create.json')) {
        return new Response(JSON.stringify({ errors: [{ code: 63, message: 'User has been suspended.' }] }), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as FetchImpl;
    await bootstrap(undefined, suspendedFetch);

    await dispatch({ action: 'recordSpam', items: [record('tweet-2', 'suspended1', true)] });

    await vi.waitFor(
      () => {
        expect(storageData.autoBlockQueue).toEqual([]);
        expect(storageData.autoBlockToday).toBe(0);
        // Record flushed (50 ms batch) and never removed by the failed block.
        expect(
          (storageData.blockedHistory as Array<{ id: string }>).some((item) => item.id === 'tweet-2'),
        ).toBe(true);
      },
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).toEqual([]);
  });

  it('transient failure (HTTP 500): item pushed back for retry, nothing recorded', async () => {
    const failingFetch: FetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('blocks/create.json')) {
        return new Response('server error', { status: 500 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as FetchImpl;
    await bootstrap(undefined, failingFetch);

    await dispatch({ action: 'recordSpam', items: [record('tweet-5', 'flaky1', true)] });

    await vi.waitFor(
      () => {
        expect(storageData.autoBlockToday).toBe(0);
        expect(storageData.autoBlockQueue).toContain('flaky1');
      },
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).toEqual([]);
  });

  it('rate limit (HTTP 429): item unshifted to the queue front, auto-block paused 15 min', async () => {
    const limitedFetch: FetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('blocks/create.json')) {
        return new Response('rate limited', { status: 429 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as FetchImpl;
    await bootstrap({ autoBlockQueue: ['first1', 'second2'] }, limitedFetch);

    // Wait for one full drain cycle attempt: the first item must come back.
    await vi.waitFor(
      () => {
        expect(storageData.autoBlockPausedUntil).toBeGreaterThan(Date.now());
        expect(storageData.autoBlockQueue).toEqual(['first1', 'second2']);
      },
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockToday).toBe(0);
    expect(storageData.blockedUsersOnX).toEqual([]);
  });

  it('unblock removes the user from the ledger, records untouched', async () => {
    await bootstrap({
      blockedUsersOnX: ['spammer1'],
      blockedHistory: [record('tweet-6', 'spammer1', false)],
      blockedCount: 1,
    });
    const res = (await dispatch({ action: 'unblockUserOnX', screenName: 'spammer1' })) as {
      success?: boolean;
    };
    expect(res?.success).toBe(true);
    expect(storageData.blockedUsersOnX).toEqual([]);
    expect(
      (storageData.blockedHistory as Array<{ id: string }>).some((item) => item.id === 'tweet-6'),
    ).toBe(true);
  });
});
