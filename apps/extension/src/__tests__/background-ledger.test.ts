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
      onClicked: { addListener: vi.fn() },
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
  const bg = await import('../background/index');
  // Most tests exercise the drain immediately. Seeds may opt into the grace
  // window via autoBlockGraceMinutes — respect their choice.
  if (seed?.autoBlockGraceMinutes === undefined) {
    bg.autoBlockManager.graceMinutes = 0;
  }
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

  it('manual block of a QUEUED user purges them from the pending queue', async () => {
    // stuck1's block call hangs forever, so process() stays in-flight on the
    // first item and never touches the second one; the manual block of
    // spammer1 must still go through and purge it from the queue.
    const hangFetch: FetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('blocks/create.json') && String(init?.body ?? '').includes('stuck1')) {
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify({ screen_name: 'spammer1' }), { status: 200 });
    }) as unknown as FetchImpl;
    await bootstrap({ autoBlockQueue: ['stuck1', 'spammer1'] }, hangFetch);

    // Let process() shift stuck1 and hang on its block call.
    await new Promise((r) => setTimeout(r, 50));

    const res = (await dispatch({ action: 'blockUserOnX', screenName: 'spammer1' })) as {
      success?: boolean;
    };
    expect(res?.success).toBe(true);

    // Ledger write implies queue exit: stuck1 is in-flight (shifted), and
    // spammer1 must be gone from the persisted pending queue.
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toEqual([]),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).toContain('spammer1');
  });

  it('startup purge: ledger members left in a stale queue are dropped before any API call', async () => {
    const fetchImpl = okFetch();
    await bootstrap(
      { autoBlockQueue: ['stale1', 'stale2'], blockedUsersOnX: ['stale1', 'stale2'] },
      fetchImpl,
    );

    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toEqual([]),
      { timeout: 5000, interval: 25 },
    );

    // They were already blocked — no blocks/create.json may ever fire for them.
    const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
    const createCalls = mock.mock.calls.filter((call) =>
      String(call[0]).includes('blocks/create.json'),
    );
    expect(createCalls).toHaveLength(0);
  });

  it('grace window: keyword hits wait before auto-blocking; deletion and whitelist cancel them', async () => {
    const fetchImpl = okFetch();
    await bootstrap();
    const bg = await import('../background/index');
    const manager = bg.autoBlockManager;

    // Keyword hit lands in the queue with the default 30-minute grace window.
    manager.graceMinutes = 30;
    await dispatch({ action: 'recordSpam', items: [record('tweet-g1', 'pending1', true)] });

    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('pending1'),
      { timeout: 5000, interval: 25 },
    );
    // Still inside the window: nothing blocked yet, no API call.
    await new Promise((r) => setTimeout(r, 300));
    expect(storageData.blockedUsersOnX).toEqual([]);
    expect((storageData.autoBlockEta as Record<string, number>).pending1).toBeGreaterThan(Date.now());
    const mock = fetchImpl as unknown as { mock: { calls: unknown[][] } };
    expect(
      mock.mock.calls.filter((call) => String(call[0]).includes('blocks/create.json')),
    ).toHaveLength(0);

    // Grace expires (simulated) → the drain executes the block.
    (storageData.autoBlockEta as Record<string, number>).pending1 = Date.now() - 1;
    await manager.process();

    await vi.waitFor(
      () => expect(storageData.blockedUsersOnX).toContain('pending1'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockQueue).toEqual([]);

    // Deleting the last record of a queued user cancels their pending block.
    await dispatch({ action: 'recordSpam', items: [record('tweet-g2', 'pending2', true)] });
    await vi.waitFor(
      () => expect(storageData.blockedHistory).toContainEqual(expect.objectContaining({ id: 'tweet-g2' })),
      { timeout: 5000, interval: 25 },
    );
    await dispatch({ action: 'removeSpamRecord', id: 'tweet-g2' });
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).not.toContain('pending2'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).not.toContain('pending2');

    // Whitelisting a queued user also cancels their pending entry.
    await dispatch({ action: 'recordSpam', items: [record('tweet-g3', 'pending3', true)] });
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('pending3'),
      { timeout: 5000, interval: 25 },
    );
    await manager.purgeWhitelistedFromQueue(['pending3']);
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).not.toContain('pending3'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).not.toContain('pending3');
  }, 20000);

  it('manual confirmation accelerates an already-pending entry to now', async () => {
    await bootstrap();
    const bg = await import('../background/index');
    const manager = bg.autoBlockManager;
    manager.graceMinutes = 30;

    await dispatch({ action: 'recordSpam', items: [record('tweet-a1', 'accel1', true)] });
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('accel1'),
      { timeout: 5000, interval: 25 },
    );
    expect((storageData.autoBlockEta as Record<string, number>).accel1).toBeGreaterThan(Date.now());

    // Bulk confirm skips the grace window for users already pending.
    await dispatch({ action: 'blockAllHistoryUsers', users: ['accel1'] });
    await vi.waitFor(
      () => expect(storageData.blockedUsersOnX).toContain('accel1'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockQueue).toEqual([]);
  });

  it('fresh trigger overwrites a stale expired eta — the grace window applies', async () => {
    await bootstrap({ autoBlockEta: { stale1: Date.now() - 60_000 } });
    const bg = await import('../background/index');
    const manager = bg.autoBlockManager;
    manager.graceMinutes = 30;

    await dispatch({ action: 'recordSpam', items: [record('tweet-s1', 'stale1', true)] });
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('stale1'),
      { timeout: 5000, interval: 25 },
    );
    // The stale (expired) eta must NOT let the new trigger fire immediately.
    await new Promise((r) => setTimeout(r, 300));
    expect(storageData.blockedUsersOnX).toEqual([]);
    expect((storageData.autoBlockEta as Record<string, number>).stale1).toBeGreaterThan(Date.now());
  });

  it('mixed etas: the ready entry is processed even behind a future one', async () => {
    await bootstrap({
      autoBlockQueue: ['future1', 'ready1'],
      autoBlockEta: { future1: Date.now() + 3_600_000 },
    });

    await vi.waitFor(
      () => expect(storageData.blockedUsersOnX).toContain('ready1'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockQueue).toEqual(['future1']);
    expect(storageData.blockedUsersOnX).not.toContain('future1');
  });

  it('deleting one of two records of the same user keeps the pending entry', async () => {
    await bootstrap();
    const bg = await import('../background/index');
    const manager = bg.autoBlockManager;
    manager.graceMinutes = 30;

    await dispatch({
      action: 'recordSpam',
      items: [record('tweet-d1', 'dupe1', true), record('tweet-d2', 'dupe1', true)],
    });
    await vi.waitFor(
      () =>
        (storageData.blockedHistory as Array<{ id: string }>).filter(
          (it) => it.id === 'tweet-d1' || it.id === 'tweet-d2',
        ).length === 2,
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockQueue).toContain('dupe1');

    await dispatch({ action: 'removeSpamRecord', id: 'tweet-d1' });
    await new Promise((r) => setTimeout(r, 300));
    // One record remains → the user stays pending (not yet fully intervened).
    expect(storageData.autoBlockQueue).toContain('dupe1');

    // Deleting the last record cancels the pending entry.
    await dispatch({ action: 'removeSpamRecord', id: 'tweet-d2' });
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).not.toContain('dupe1'),
      { timeout: 5000, interval: 25 },
    );
  });

  it('restart persistence: a persisted queue with expired etas drains on worker wake', async () => {
    await bootstrap({
      autoBlockQueue: ['old1'],
      autoBlockEta: { old1: Date.now() - 1 },
    });
    await vi.waitFor(
      () => expect(storageData.blockedUsersOnX).toContain('old1'),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.autoBlockQueue).toEqual([]);
  });

  it('startup backfill: surviving unblocked trigger records enter the pending queue', async () => {
    await bootstrap({
      blockedHistory: [
        record('tweet-b1', 'back1', true),
        record('tweet-b2', 'back2', true),
        record('tweet-b3', 'back3', true),
      ],
      blockedUsersOnX: ['back2'],
      whitelist: ['back3'],
      autoBlockGraceMinutes: 30,
    });

    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('back1'),
      { timeout: 5000, interval: 25 },
    );
    // Ledger member: stays blocked, never re-queued. Whitelisted: stays free.
    expect(storageData.autoBlockQueue).not.toContain('back2');
    expect(storageData.autoBlockQueue).not.toContain('back3');
    expect(storageData.blockedUsersOnX).toEqual(['back2']);
  });

  it('shareHandles merges the block ledger into the project handles.txt', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: FetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('handles.txt')) {
        if (init?.method === 'PUT') {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        return new Response(JSON.stringify({ sha: 'abc123', content: 'c3BhbW1lcjE=' }), { status: 200 }); // base64: spammer1
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as FetchImpl;
    await bootstrap({ githubToken: 'tok', blockedUsersOnX: ['spammer1', 'spammer2'] }, fetchImpl);

    const res = (await dispatch({ action: 'shareHandles' })) as { success?: boolean; total?: number };
    expect(res?.success).toBe(true);
    expect(res?.total).toBe(2); // existing spammer1 + local spammer2, deduped

    const put = calls.find((c) => c.init?.method === 'PUT');
    expect(put).toBeDefined();
    const body = JSON.parse(String(put?.init?.body ?? '{}'));
    const decoded = atob(body.content);
    expect(decoded).toContain('spammer1');
    expect(decoded).toContain('spammer2');
  });

  it('shareHandles without a token fails with a clear reason', async () => {
    await bootstrap();
    const res = (await dispatch({ action: 'shareHandles' })) as { success?: boolean; reason?: string };
    expect(res?.success).toBe(false);
    expect(res?.reason).toContain('Token');
  });

  it('community feeder: shared handles enter pending, whitelist/dismiss are honored', async () => {
    await bootstrap({
      communityHandles: ['cshare1', 'cshare2', 'cshare3'],
      whitelist: ['cshare2'],
      communityDismissed: ['cshare3'],
      autoBlockGraceMinutes: 30,
    });
    const bg = await import('../background/index');

    await bg.feedCommunityHandles();
    try {
      await vi.waitFor(
        () => expect(storageData.autoBlockQueue).toContain('cshare1'),
        { timeout: 4500, interval: 25 },
      );
    } catch (error) {
      console.log('DBG state: q=', JSON.stringify(storageData.autoBlockQueue), 'eta=', JSON.stringify(storageData.autoBlockEta), 'hist=', JSON.stringify((storageData.blockedHistory as Array<{id:string}> ?? []).map((x) => x.id)), 'ledger=', JSON.stringify(storageData.blockedUsersOnX), 'dismissed=', JSON.stringify(storageData.communityDismissed));
      throw error;
    }
    expect(storageData.autoBlockQueue).not.toContain('cshare2');
    expect(storageData.autoBlockQueue).not.toContain('cshare3');
    // Synthetic record for visibility + intervention.
    await vi.waitFor(
      () =>
        (storageData.blockedHistory as Array<{ id: string; reason: string }>).some(
          (it) => it.id === 'community:cshare1' && it.reason === '社区共享',
        ),
      { timeout: 5000, interval: 25 },
    );
    expect(storageData.blockedUsersOnX).toEqual([]);

  }, 12000);

  it('deleting a community record opts the handle out of future feeding', async () => {
    await bootstrap({
      communityHandles: ['copt1'],
      communityDismissed: [],
      autoBlockGraceMinutes: 30,
    });
    const bg = await import('../background/index');
    await bg.feedCommunityHandles();
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toContain('copt1'),
      { timeout: 5000, interval: 25 },
    );
    await dispatch({ action: 'removeSpamRecord', id: 'community:copt1' });
    await vi.waitFor(
      () => expect((storageData.communityDismissed as string[])).toContain('copt1'),
      { timeout: 5000, interval: 25 },
    );
    await bg.feedCommunityHandles();
    await new Promise((r) => setTimeout(r, 200));
    expect(storageData.autoBlockQueue).toEqual([]);
  });

  it('whitelist chokepoint: blockUserOnX refuses whitelisted users', async () => {
    await bootstrap({ whitelist: ['pacifist1'] });
    const res = (await dispatch({ action: 'blockUserOnX', screenName: 'pacifist1' })) as {
      success?: boolean;
      permanent?: boolean;
    };
    expect(res?.success).toBe(false);
    expect(res?.permanent).toBe(true);
    expect(storageData.blockedUsersOnX).toEqual([]);
  });

  it('whitelisted users never enter the pending queue', async () => {
    await bootstrap({ whitelist: ['wluser1'] });
    await dispatch({ action: 'recordSpam', items: [record('tweet-w1', 'wluser1', true)] });
    await new Promise((r) => setTimeout(r, 300));
    expect(storageData.autoBlockQueue).toEqual([]);
    expect(storageData.blockedUsersOnX).toEqual([]);
  });

  it('whitelist update instantly purges queued members from the pending queue', async () => {
    await bootstrap({ autoBlockQueue: ['wl1', 'keep1'] });
    const { autoBlockManager } = await import('../background/index');
    await autoBlockManager.purgeWhitelistedFromQueue(['wl1']);
    await vi.waitFor(
      () => expect(storageData.autoBlockQueue).toEqual(['keep1']),
      { timeout: 5000, interval: 25 },
    );
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
