/**
 * X 隐藏词写入器（1.8.0）：在 x.com/settings/muted_keywords 页面内驱动 X 官方
 * 的「添加隐藏词」对话框，把后台交付的词库任务逐条写入。
 *
 * 为什么走 UI 驱动：直连 REST（settings/muted_keywords/update.json）返回 200
 * 却不真正生效（1.8.0 实测 + 社区工具 XActions 同样结论），可靠的写入方式是
 * 驱动真实对话框：点 addMutedWord → 填 input[name=keyword] → 点 settingsSave。
 *
 * 断点续跑：任务与进度都在 storage（xMuteSyncTask / xMuteSyncProgress），
 * 页面刷新或中断后重新进入本页会从 index 继续；关闭标签页即中止。
 */
import { browserApi } from '../store/blockerStorage';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(selector: string, timeoutMs: number): Promise<Element | null> {
  const start = Date.now();
  for (;;) {
    const el = document.querySelector(selector);
    if (el) return el;
    if (Date.now() - start > timeoutMs) return null;
    await sleep(200);
  }
}

/** 关闭可能卡住的添加对话框（返回箭头优先，Escape 兜底）。 */
function dismissAddDialog(): void {
  const back = document.querySelector('[data-testid="app-bar-back"]') as HTMLElement | null;
  if (back) {
    back.click();
    return;
  }
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

export function startMuteSyncRunner(): void {
  if (!location.pathname.includes('/settings/muted_keywords')) return;
  void (async () => {
    const stored = (await browserApi.storage.local.get({ xMuteSyncTask: null })) as {
      xMuteSyncTask: { state: string; words: string[]; index: number } | null;
    };
    const task = stored?.xMuteSyncTask;
    if (!task || task.state !== 'running' || task.index >= task.words.length) return;

    // 等设置页就绪（未登录时页面没有添加按钮，超时放弃并写明原因）
    const ready = await waitFor('[data-testid="addMutedWord"]', 20000);
    if (!ready) {
      await browserApi.storage.local.set({
        xMuteSyncProgress: {
          running: false,
          done: task.index,
          total: task.words.length,
          ok: 0,
          skip: 0,
          fail: 0,
          error: '页面未就绪（可能未登录 X），同步中止',
          finishedAt: Date.now(),
        },
      });
      await browserApi.storage.local.set({ xMuteSyncTask: { ...task, state: 'abort' } });
      return;
    }

    let ok = 0;
    let skip = 0;
    let fail = 0;
    let done = task.index;
    const total = task.words.length;

    for (let i = task.index; i < total; i++) {
      // 每步前重读任务（支持取消/状态变更）
      const current = (
        (await browserApi.storage.local.get({ xMuteSyncTask: null })) as {
          xMuteSyncTask: { state: string; words: string[]; index: number } | null;
        }
      ).xMuteSyncTask;
      if (!current || current.state !== 'running') return;
      const word = current.words[i];
      if (!word) {
        done++;
        continue;
      }

      // 1. 打开添加对话框
      const addBtn = document.querySelector('[data-testid="addMutedWord"]') as HTMLElement | null;
      if (!addBtn) {
        fail++;
        done++;
        await browserApi.storage.local.set({
          xMuteSyncProgress: { running: true, done, total, ok, skip, fail },
          xMuteSyncTask: { ...current, index: i + 1 },
        });
        continue;
      }
      addBtn.click();
      const input = (await waitFor('input[name="keyword"]', 6000)) as HTMLInputElement | null;
      if (!input) {
        fail++;
        done++;
        await browserApi.storage.local.set({
          xMuteSyncProgress: { running: true, done, total, ok, skip, fail },
          xMuteSyncTask: { ...current, index: i + 1 },
        });
        continue;
      }

      // 2. 填词（execCommand 触发 React 的输入事件链）
      input.focus();
      document.execCommand('insertText', false, word);
      await sleep(300);

      // 3. 保存
      const save = document.querySelector('[data-testid="settingsSave"]') as HTMLElement | null;
      if (save) save.click();
      await sleep(1200);

      // 4. 对话框未关闭 = 大概率重复词，记为跳过并关掉对话框
      if (document.querySelector('input[name="keyword"]')) {
        skip++;
        dismissAddDialog();
        await sleep(500);
      } else {
        ok++;
      }
      done++;

      // 5. 进度落盘（面板实时显示）
      await browserApi.storage.local.set({
        xMuteSyncProgress: { running: true, done, total, ok, skip, fail },
        xMuteSyncTask: { ...current, index: i + 1 },
      });
      await sleep(500);
    }

    await browserApi.storage.local.set({
      xMuteSyncProgress: {
        running: false,
        done: total,
        total,
        ok,
        skip,
        fail,
        finishedAt: Date.now(),
      },
      xMuteSyncTask: { state: 'done', words: [], index: 0 },
    });
  })();
}
