import type { BlockExecutorAdapter } from '@xshield/block-executor';
import type { RealBlockUserPayload, RealBlockUserResult, RuntimeMessage } from '../types';

const XSHIELD_BLOCK_TAB_URL = 'https://x.com/home?xshield_blocker=1';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function waitForTabComplete(tabId: number, timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await wait(300);
  }
}

async function findOrCreateBlockTab(): Promise<number> {
  const tabs = await chrome.tabs.query({
    url: ['https://x.com/*', 'https://twitter.com/*'],
  });
  const blockerTab = tabs.find((tab) => tab.url?.includes('xshield_blocker=1'));

  if (blockerTab?.id) return blockerTab.id;

  const created = await chrome.tabs.create({ active: false, url: XSHIELD_BLOCK_TAB_URL });
  if (!created.id) throw new Error('Could not create an X background tab for real block mode');
  await waitForTabComplete(created.id);
  await wait(1800);
  return created.id;
}

async function navigateHiddenTab(tabId: number, username: string): Promise<void> {
  const normalized = username.replace(/^@+/, '');
  await chrome.tabs.update(tabId, {
    active: false,
    url: `https://x.com/${normalized}?xshield_blocker=1`,
  });
  await waitForTabComplete(tabId);
  await wait(2200);
}

async function sendRealBlockMessage(tabId: number, username: string): Promise<RealBlockUserResult> {
  const message: RuntimeMessage<RealBlockUserPayload> = {
    source: 'xshield',
    type: 'REAL_BLOCK_USER',
    payload: { username },
  };

  return chrome.tabs.sendMessage<RuntimeMessage<RealBlockUserPayload>, RealBlockUserResult>(tabId, message);
}

async function pingContentScript(tabId: number): Promise<boolean> {
  try {
    const response = await chrome.tabs.sendMessage<RuntimeMessage, RealBlockUserResult>(tabId, {
      source: 'xshield',
      type: 'XSHIELD_PING',
    });
    return Boolean(response?.success);
  } catch {
    return false;
  }
}

async function injectContentScript(tabId: number): Promise<void> {
  if (await pingContentScript(tabId)) return;

  const manifest = chrome.runtime.getManifest();
  const contentScriptFiles = manifest.content_scripts?.flatMap((script) => script.js ?? []) ?? [];
  if (contentScriptFiles.length === 0) {
    throw new Error('XShield content script is not listed in the extension manifest');
  }

  await chrome.scripting.executeScript({
    target: { tabId },
    files: contentScriptFiles,
  });
  await wait(700);

  if (!(await pingContentScript(tabId))) {
    throw new Error('Could not connect to XShield content script on the X profile tab');
  }
}

export class ChromeRealBlockAdapter implements BlockExecutorAdapter {
  private tabId?: number;

  async blockUser(username: string): Promise<void> {
    const normalized = username.replace(/^@+/, '');
    this.tabId = this.tabId ?? (await findOrCreateBlockTab());
    await navigateHiddenTab(this.tabId, normalized);
    await injectContentScript(this.tabId);

    let response: RealBlockUserResult | undefined;
    try {
      response = await sendRealBlockMessage(this.tabId, normalized);
    } catch (error) {
      const message = String(error).toLowerCase();
      if (!message.includes('context invalidated') && !message.includes('receiving end')) {
        throw error;
      }

      await chrome.tabs.reload(this.tabId);
      await waitForTabComplete(this.tabId);
      await wait(2200);
      await injectContentScript(this.tabId);
      response = await sendRealBlockMessage(this.tabId, normalized);
    }

    if (!response?.success) {
      throw new Error(response?.error || `Failed to block @${normalized}`);
    }
  }
}
