import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

const storageData: Record<string, unknown> = {
  enabled: true,
  language: 'zh-CN',
  blockedUsersOnX: ['spamuser1', 'spamuser2'],
  autoBlockQueue: ['queueuser1'],
  queueInfo: { spamuser1: { displayName: '垃圾号', text: '比她好看的没她骚' } },
  autoBlockToday: 3,
  autoBlockPausedUntil: 0,
  whitelist: [],
  blockedHistory: [],
  cloudKeywords: '',
  keywords: '',
  xshieldLogs: [],
};

const chromeMock = {
  runtime: { id: 't', getManifest: () => ({ version: 'test' }), getURL: (p: string) => p, sendMessage: vi.fn(async () => ({ success: true })), onMessage: { addListener: vi.fn() } },
  storage: {
    local: { get: vi.fn(async (keys: Record<string, unknown>) => { const o: Record<string, unknown> = {}; for (const k of Object.keys(keys)) o[k] = storageData[k] ?? keys[k]; return o; }), set: vi.fn(async (i: Record<string, unknown>) => Object.assign(storageData, i)) },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
};

describe('blockedLog page renders', () => {
  it('shows readable Chinese button labels (no mojibake/undefined)', async () => {
    vi.stubGlobal('chrome', chromeMock);
    vi.stubGlobal('open', vi.fn());
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const { default: Dashboard } = await import('../dashboard/Dashboard');
    await act(async () => root.render(<Dashboard />));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    // switch to blockedLog page
    const navBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '拉黑记录');
    expect(navBtn).toBeDefined();
    await act(async () => { navBtn!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const buttons = Array.from(container.querySelectorAll('button'));
    // every text button must have non-empty text and no replacement chars;
    // icon-only buttons are fine when they carry a title (accessible name)
    for (const button of buttons) {
      if (button.getAttribute('title')) continue;
      const text = (button.textContent ?? '').trim();
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toMatch(/[\uFFFD]/);
    }
    expect(buttons.some((b) => (b.textContent ?? '').includes('解除拉黑'))).toBe(true);
    expect(buttons.some((b) => (b.textContent ?? '').includes('白名单'))).toBe(true);
  });
});
