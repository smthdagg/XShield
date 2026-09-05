# XShield User Guide (v1.0 stable)

X(Twitter) comment spam blocking + trigger-list auto-blocking + community shared blocklist. The trigger & block kernel is aligned with X(Twitter) Comment Blocker 1.5.1.

> This guide matches extension **1.0.0+**. Older guides (≤0.8) are archived in Git history.

---

## 1. Installation

1. Build the extension (or use a prebuilt `apps/extension/dist`):

   ```
   corepack enable
   pnpm install
   pnpm build
   ```

2. Open `chrome://extensions` in Chrome → enable **Developer mode** → **Load unpacked** → select `apps/extension/dist`.

3. Click the XShield toolbar icon → **打开面板 (Open dashboard)**. The dashboard sidebar shows the current version.

> Blocking requires being logged in to x.com in this Chrome profile (reads the ct0 session cookie). Without login you get filtering only.
> **After updating the extension, refresh already-open X tabs** so the new content script is injected (a Chrome mechanism).

---

## 2. Core model (read this first)

```
keyword hit
  → the reply is hidden immediately, the author enters 触发记录 (the pending list)
  → enters the auto-block queue with a 30-minute grace window
      ├─ do nothing → blocked automatically after the window, at rate-limited pacing
      ├─ click 白名单 (whitelist) → permanently exempt, leaves the queue instantly
      ├─ click 删除 (delete) → record removed, leaves the queue
      └─ click 拉黑 (block) or bulk 拉黑列表(N) → executes immediately (skips the window)
  → block succeeds → moves to 已拉黑 (blocked); never processed again
```

**The 触发记录 page IS the pending list** — the only one. There is a single keyword library (cloud sync + local custom layers); there is no "auto-block keyword" vs "regular keyword" split — every hit is treated the same.

---

## 3. Dashboard tour (five pages)

### 1. 触发记录 (Trigger records = pending list)

- Cards: display name / @handle / reason / time / reply text; click the name to open their X profile
- The **排队中** badge means the user is in the auto-execution queue
- Three buttons per card: **拉黑** (block now) / **白名单** (whitelist permanently + leave queue; the row leaves the list) / **删除** (delete record + leave queue)
- Toolbar: select all, search, reason filter, **拉黑列表(N)** bulk block (click twice within 3 s to confirm)
- Below the toolbar: **block pacing settings** (daily limit / batch size / interval seconds), effective immediately

### 2. 拉黑记录 (Block log)

- Counters: blocked today / remaining (queued) / blocked users (all time)
- **Last-7-days** daily block counts
- Blocked-users database view: shows the **newest 300** by default (100 per page, 3 pages); older users are found via **search** (matches handle and display name) — each card carries its block date
- Card buttons: **白名单** (unblock + whitelist, undo a mistake) / **解除拉黑** (unblock only)

### 3. 白名单 (Whitelist)

Add/remove manually. Whitelisted users are never triggered, never queued, and instantly leave the queue.

### 4. 规则与同步 (Rules & sync)

- **Cloud library**: word count, last sync time; click 立即同步 (sync now) — fallback chain: GitHub API → jsDelivr CDN → bundled library; per-word **disable** (×)
- **Local library**: add / **edit** (pencil icon, Enter saves, Esc cancels) / delete / import / export
- Keyword format: one per line; plain words are case-insensitive substring matches; regex as `/pattern/flags`, e.g. `/比.{0,3}她.{0,3}好/i`
- The library source repo is configured in 总设置 (empty = the default cleaned repo `smthdagg/XShield-keywords`)

### 5. 总设置 (Settings)

- Master switch, hide/highlight mode, filter toggles (match usernames, comments only, special chars, emoji-only, Grok cards)
- Library source owner/repo, language
- **GitHub Token + Share blocked handles to project repo** (see section 5)
- **Export diagnostics**: one-click JSON snapshot (version, list counts and contents, sync state, last 100 log lines) — send this when reporting issues

---

## 4. Auto-blocking & rate control

Default pacing (adjustable on the 触发记录 page): 300/day, batches of 30 (15-min pause after each), 5 s ± 5 s random interval, 429 pauses 15 minutes, transient failures retried 5 times with exponential backoff, suspended/deleted accounts dropped immediately.

Notes:

- Blocks use your current Chrome X session — identical to blocking manually on the web
- The queue is deduplicated **by user**: however many times a user triggers, they are processed once
- Records are kept **per tweet**: multiple spam tweets from one user produce multiple records (evidence), without re-queueing
- X publishes no official block-rate limits; the defaults are conservative heuristics from the 1.5.1 project. Aged accounts can relax them (e.g. 3 s interval, 500/day); new accounts should keep the defaults

---

## 5. Community shared blocklist

Spam accounts blocked by anyone can be shared with everyone:

- **Download (automatic for all users)**: each sync also fetches `handles.txt` from the project repo — matching accounts get their replies hidden and enter the pending queue (reason 社区共享)
- **Share (optional, token required)**: fill a GitHub Token in 总设置 (needs Contents write access to the library repo) → click 共享拉黑名单到项目仓库 → your ledger handles are merged into the repo (deduplicated, never overwriting others' data)
- **Opt out**: deleting a 社区共享 record permanently excludes that handle; whitelisting also exempts
- Without a token you only download — nothing is ever uploaded

---

## 6. Library maintenance (project owner)

- Content words: `keywords.txt` (561-line cleaned set: Chinese phrases + brand words + `t.cn`/`Gate Card` + 7 structural regexes)
- Shared blocklist: `handles.txt` (accumulated via the share button)
- Commit directly on GitHub, then purge the CDN at [purge.jsdelivr.net](https://www.jsdelivr.com/tools/purge); users pick it up on their next sync

---

## 7. FAQ

| Symptom | Fix |
|---------|-----|
| X tab doesn't trigger after updating the extension | Refresh the tab (Chrome injection mechanism); or check the console for `[XShield] content vX ready` |
| Whitelist click seems ignored | Fixed in 0.8.1; reload the extension and check the version badge |
| Pending count is always 0 | Normal — the queue is a pipeline; it only shows a backlog while one exists |
| Trigger list is empty | Everyone is in 排队中/已拉黑 — switch the filter |
| Blocked user disappeared from the list | The list shows the newest 300; use search to find older ones |
| Block failed: 无法获取身份凭证 | Log in to x.com and retry |
| Block failed: HTTP 429 | Rate limited; auto-pauses 15 minutes |
| Undo a mistaken block | On the block-log card, 白名单 = unblock + whitelist |
| Dashboard behaves oddly | 总设置 → Export diagnostics → send the JSON to the maintainer |

---

## 8. Privacy

All data (library, records, queue, ledger, whitelist, settings) lives in local `chrome.storage.local` (unlimitedStorage). Network requests are limited to: cloud library/blocklist fetches, GitHub sharing uploads (explicit click + token), and the X block endpoint (on triggers/manual actions). See [PRIVACY.md](PRIVACY.md).
