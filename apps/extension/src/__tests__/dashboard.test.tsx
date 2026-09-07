/**
 * Mounts the real Dashboard component (mocked chrome APIs) and verifies the
 * triggered-users page exposes blocking: per-row block buttons, select-all,
 * and the bulk block toolbar button.
 *
 * Ledger contract under test (1.5.1 model): the dashboard must NEVER write
 * `blockedHistory` / `blockedUsersOnX` directly. Those keys are owned by the
 * background (single writer). The mock's sendMessage simulates the
 * background's success-time bookkeeping (merge ledger, keep records).
 */
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

interface SpamRecord {
  id: string;
  text: string;
  user: string;
  displayName: string;
  reason: string;
  time: number;
  isAutoBlock: boolean;
}

const storageData: Record<string, unknown> = {
  enabled: true,
  highlightMode: false,
  blockedCount: 2,
  blockedHistory: [
    {
      id: 'rec1',
      text: '比她好看的没她骚比她骚的没她好看',
      user: 'spammer1',
      displayName: '垃圾号',
      reason: '内容屏蔽',
      time: Date.now() - 1000,
      isAutoBlock: true,
    },
    {
      id: 'rec2',
      text: '正常内容不会出现',
      user: 'someone',
      displayName: '某人',
      reason: '内容屏蔽',
      time: Date.now() - 2000,
      isAutoBlock: false,
    },
  ] as SpamRecord[],
  blockedUsersOnX: [] as string[],
  autoBlockQueue: [] as string[],
  queueInfo: {} as Record<string, unknown>,
  autoBlockToday: 0,
  autoBlockPausedUntil: 0,
  whitelist: [] as string[],
  cloudKeywords: '',
  keywords: '',
  autoBlockKeywords: [] as string[],
  disabledCloudKeywords: [] as string[],
  cloudEnabled: true,
  language: 'zh-CN',
};

const sentMessages: Array<Record<string, unknown>> = [];
const storageWrites: Array<Record<string, unknown>> = [];

const LEDGER_KEYS = ['blockedHistory', 'blockedUsersOnX'];

/** Simulates the background side of each message (single-writer bookkeeping). */
function simulateBackground(message: Record<string, unknown>): unknown {
  if (message.action === 'blockUserOnX') {
    const name = String(message.screenName);
    // 1.5.1 model: success merges the ledger; trigger records stay.
    storageData.blockedUsersOnX = Array.from(
      new Set([...((storageData.blockedUsersOnX as string[]) ?? []), name]),
    );
    return { success: true, screenName: name };
  }
  if (message.action === 'blockAllHistoryUsers') {
    // Enqueue only — records stay in blockedHistory (nothing is deleted
    // at enqueue time or at block time).
    return { success: true, total: (message.users as string[]).length, queued: (message.users as string[]).length };
  }
  if (message.action === 'unblockUserOnX') {
    const name = String(message.screenName);
    storageData.blockedUsersOnX = ((storageData.blockedUsersOnX as string[]) ?? []).filter((n) => n !== name);
    return { success: true };
  }
  return { success: true };
}

const chromeMock = {
  runtime: {
    id: 'test',
    getURL: (path: string) => `chrome-extension://test/${path}`,
    getManifest: () => ({ version: 'test' }),
    sendMessage: vi.fn(async (message: Record<string, unknown>) => {
      sentMessages.push(message);
      return simulateBackground(message);
    }),
    onMessage: { addListener: vi.fn() },
  },
  storage: {
    local: {
      get: vi.fn(async (keys: unknown) => {
        const out: Record<string, unknown> = {};
        if (keys && typeof keys === 'object' && !Array.isArray(keys)) {
          for (const key of Object.keys(keys as Record<string, unknown>)) {
            out[key] = storageData[key] ?? (keys as Record<string, unknown>)[key];
          }
        }
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        storageWrites.push(items);
        Object.assign(storageData, items);
      }),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

describe('dashboard triggered page blocking', () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    sentMessages.length = 0;
    storageWrites.length = 0;
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('open', vi.fn());
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it('routes blocking through the background and never writes the ledger keys itself', async () => {
    const { default: Dashboard } = await import('../dashboard/Dashboard');
    await act(async () => {
      root.render(<Dashboard />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Sidebar shows the five pages.
    const nav = container.textContent ?? '';
    expect(nav).toContain('触发记录');
    expect(nav).toContain('拉黑记录');
    expect(nav).toContain('规则与同步');

    // Triggered records render with the block button.
    const blockButtons = Array.from(container.querySelectorAll('button')).filter(
      (button) => button.textContent === '拉黑',
    );
    expect(blockButtons.length).toBeGreaterThan(0);

    // Triggered records render as profile cards.
    expect(container.querySelectorAll('.profile-card.trigger-card').length).toBe(2);

    // Clicking a per-row block sends blockUserOnX; the background (simulated
    // here) merges the ledger and keeps the trigger records (1.5.1 model).
    await act(async () => {
      blockButtons[0].click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const blockMessage = sentMessages.find((message) => message.action === 'blockUserOnX');
    expect(blockMessage?.screenName).toBe('spammer1');
    // Records stay put — blocking never deletes history.
    expect((storageData.blockedHistory as unknown[]).length).toBe(2);
    expect(storageData.blockedUsersOnX).toContain('spammer1');

    // The dashboard itself must not have written either ledger key directly.
    const directLedgerWrites = storageWrites.filter((write) =>
      LEDGER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(write, key)),
    );
    expect(directLedgerWrites).toHaveLength(0);

    // Select-all checkbox exists.
    const selectAll = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (input) => (input.parentElement?.textContent ?? '').includes('全选'),
    );
    expect(selectAll).toBeDefined();

    // Bulk button shows with count after selecting all.
    await act(async () => {
      if (selectAll) selectAll.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const bulk = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      (button.textContent ?? '').includes('拉黑列表'),
    );
    expect(bulk).toBeDefined();
    expect(bulk?.textContent).toContain('2');

    // Confirm bulk block: users are queued, but the records stay in the
    // triggered list until each block succeeds. The button now asks a
    // native confirm() — accept it and click once.
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    await act(async () => {
      if (bulk) bulk.click();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(confirmSpy).toHaveBeenCalled();
    const bulkMessage = sentMessages.find((message) => message.action === 'blockAllHistoryUsers');
    expect(bulkMessage).toBeDefined();
    // All records remain; queued users' blocks will merge the ledger when
    // they succeed in the background.
    expect((storageData.blockedHistory as unknown[]).length).toBe(2);
    expect((storageData.queueInfo as Record<string, unknown>)?.someone).toBeDefined();

    const historyWrites = storageWrites.filter((write) =>
      Object.prototype.hasOwnProperty.call(write, 'blockedHistory'),
    );
    expect(historyWrites).toHaveLength(0);
  });

  it('triggered list: queued rows stay visible with actions, blocked rows move to 已拉黑', async () => {
    // Reset what the previous test wrote, then seed one queued user and one
    // blocked user.
    storageData.blockedUsersOnX = ['someone'];
    storageData.autoBlockQueue = ['spammer1'];

    const { default: Dashboard } = await import('../dashboard/Dashboard');
    await act(async () => {
      root.render(<Dashboard />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Default (未拉黑) working list: the queued record stays visible with its
    // action buttons and a 排队中 badge; the blocked one is gone from here.
    const cards = container.querySelectorAll('.profile-card.trigger-card');
    expect(cards.length).toBe(1);
    expect(container.textContent).toContain('垃圾号');
    expect(container.textContent).toContain('排队中');
    expect(container.textContent).toContain('白名单');
    expect(container.textContent).not.toContain('某人');

    const select = container.querySelector('select') as HTMLSelectElement;
    const setNativeValue = (el: HTMLSelectElement, value: string) => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // 已拉黑 filter: only the blocked user's record.
    await act(async () => {
      setNativeValue(select, '__blocked_on_x__');
    });
    expect(container.querySelectorAll('.profile-card.trigger-card').length).toBe(1);
    expect(container.textContent).toContain('某人');
  });

  it('blocked list is paginated (100/page) and searchable by keyword', async () => {
    // 150 blocked users with staggered timestamps.
    const names = Array.from({ length: 150 }, (_, i) => `bulk${String(i).padStart(3, '0')}`);
    storageData.blockedUsersOnX = names;
    const at: Record<string, number> = {};
    names.forEach((name, i) => { at[name] = Date.now() - i * 60_000; });
    storageData.blockedAt = at;
    storageData.blockedHistory = [];
    // Clear the pending queue seeded by the previous test — this page counts
    // blocked-users cards only.
    storageData.autoBlockQueue = [];

    const { default: Dashboard } = await import('../dashboard/Dashboard');
    await act(async () => {
      root.render(<Dashboard />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // Navigate to the blockedLog page.
    const navBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '拉黑记录',
    );
    expect(navBtn).toBeDefined();
    await act(async () => { navBtn!.click(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });

    // Page 1 of the browse limit: 100 cards, newest first, pager visible.
    expect(container.querySelectorAll('.profile-card').length).toBe(100);
    expect(container.textContent).toContain('第 1 / 2 页');
    expect(container.textContent).toContain('近 7 天拉黑');

    // Search narrows across everything (not just the browse slice).
    const search = Array.from(container.querySelectorAll('input')).find(
      (el) => (el as HTMLInputElement).placeholder === '搜索',
    ) as HTMLInputElement;
    expect(search).toBeDefined();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'bulk0');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    console.log('DBG inputs=', JSON.stringify(Array.from(container.querySelectorAll('input')).map((el) => (el as HTMLInputElement).placeholder)), 'searchValue=', (search as HTMLInputElement).value);
    console.log('DBG cards=', container.querySelectorAll('.profile-card').length);
  });
});
