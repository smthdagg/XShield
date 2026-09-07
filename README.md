# XShield

一款保护 X（Twitter）浏览体验的浏览器扩展：自动识别并隐藏评论区垃圾内容，把垃圾账号送入待拉黑名单，按安全节奏真实拉黑，并支持社区共享黑名单。

---

## 中文说明

### 这是什么

你在 X 上刷评论时，总会遇到黄推、诈骗、引流号。XShield 做三件事：

1. **看**：浏览评论区时，命中屏蔽词的垃圾回复立即自动隐藏（也可切换为高亮标记）；
2. **记**：垃圾账号进入「触发记录」（即待拉黑名单），谁触发的、因为什么、什么时候，一目了然；
3. **拉**：30 分钟内你没有干预，扩展按安全节奏替你真实拉黑这些账号（和你在网页上手动拉黑完全一样）。

所有人拉黑的数据可**手动共享**进社区共享黑名单仓库：你在设置页「同步与共享」填好 GitHub Token 后点「共享拉黑名单」上传；其他用户点「同步黑名单」**手动拉取**后生效。**同步与共享全部为手动操作，无自动同步。**

### 安装（浏览器加载即可）

1. 下载或构建本项目的 `apps/extension/dist` 目录；
2. Chrome 打开 `chrome://extensions` → 右上角开启「开发者模式」→ 点「加载已解压的扩展程序」→ 选择 `dist` 目录；
3. 把 XShield 固定到工具栏，用你的 X 账号登录 x.com。

> 拉黑功能依赖当前浏览器的 X 登录状态；未登录时过滤功能照常可用，但拉黑会失败。
> 更新扩展后，已打开的 X 页面刷新一次即可生效。

### 使用方法

**日常使用（零操作）**：打开任意推文评论区，垃圾回复自动消失，作者自动进入待拉黑名单。什么都不用点。

**管理面板（点工具栏图标进入，共五页）**：

| 页面 | 用途 |
|------|------|
| 触发记录 | 待拉黑名单（唯一一份）：每张卡片显示触发的账号、原因、内容，带「拉黑 / 白名单 / 删除」按钮；工具栏支持全选后批量拉黑、批量删除，及「清理社区记录」一键清掉社区喂送的历史记录；本页还可调拉黑节奏（每日上限、每批数量、单次间隔） |
| 拉黑记录 | 统计数字（今日 / 剩余 / 累计）、近 7 天按日拉黑、**待拉黑队列列表（社区共享 / 正常触发分类筛选）**、已拉黑用户列表（最新 300 个分页浏览，搜索可定位全部，可解除拉黑） |
| 白名单 | 永久豁免的用户，永不触发、永不拉黑 |
| 规则与同步 | 云端规则（keywords.txt）**手动同步与共享**、本地词库增删改、导入导出 |
| 总设置 | 总开关、隐藏/高亮切换、各项过滤开关、词库源、**同步与共享（黑名单手动同步/共享、GitHub Token、同步记录）**、导出诊断信息 |

**同步说明**：无自动同步。规则（keywords.txt）在「规则与同步」页手动同步/共享；黑名单（handles.txt）在「总设置 → 同步与共享」手动同步/共享；两者共用同一个仓库源（默认 `smthdagg/XShield-keywords`，可在总设置修改）。每次同步/共享/删除都会写入本地日志（「日志」页可查可导出）。

**自动拉黑节奏**（触发记录页可调，默认保守）：每日 300 个、每批 30 个（批后歇 15 分钟）、单次间隔 5 秒。X 没有官方限制文档，请按自己账号权重调整。**手动确认的拉黑优先执行**（排在队列最前）。

**拉黑失败怎么办**：打开 x.com 并保持登录（拉黑依赖 X 会话）；失败的用户 24 小时内不会自动重试，日志页可查看原因；手动「拉黑列表」可随时显式重试。

**误拉恢复**：拉黑记录页找到该用户 → 点「白名单」（解除拉黑并加白）。

**不确定扩展是否在跑**：看面板侧栏底部版本号；或在 X 页面按 F12，控制台应有 `[XShield] content vX ready` 日志。

**报障**：总设置 → 「导出诊断信息」，把 JSON 文件发给维护者。

### 隐私

所有数据只存在你的浏览器本地。联网仅三类：下载云端词库/黑名单（手动同步时）、X 拉黑接口、以及你主动点击的 GitHub 共享上传（可选功能，不填 Token 不上传）。

### 支持项目

扩展免费开源。上架与维护有成本，欢迎支持：[GitHub Sponsors](https://github.com/sponsors/smthdagg) · [爱发电](https://afdian.net/a/smthdagg)

### 许可

MIT License，详见 [LICENSE](LICENSE)。

---

## English

### What it is

A browser extension that protects your X (Twitter) timeline: it auto-hides spam replies in comment sections, queues the offending accounts for a real block, and blocks them at a safe pace — plus an optional manually-synced community blocklist.

### Install (just load it in the browser)

1. Get the built `apps/extension/dist` folder;
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select `dist`;
3. Pin XShield to the toolbar and log in to x.com.

> Blocking requires being logged in to x.com; filtering works without login.
> After updating the extension, refresh already-open X tabs once.

### Usage

**Daily use (zero clicks)**: open any comment section — spam replies disappear and their authors enter the pending list automatically.

**Dashboard (toolbar icon, five pages)**:

| Page | Purpose |
|------|---------|
| 触发记录 (Pending list) | every not-yet-blocked account with 拉黑 (block now) / 白名单 (whitelist) / 删除 (delete) buttons; toolbar bulk block / bulk delete / one-shot community-record purge; block pacing settings live here |
| 拉黑记录 (Block log) | counters (today / remaining / total), last-7-days daily blocks, pending-queue list (community/trigger filters), blocked-users database view (newest 300 paginated, full search, unblock) |
| 白名单 (Whitelist) | permanently exempted users |
| 规则与同步 (Rules & sync) | manual rules (keywords.txt) sync & share, local library add/edit/import/export |
| 总设置 (Settings) | master switch, hide/highlight, filter toggles, library source, manual blacklist sync & share, GitHub token, sync records, export diagnostics |

**Sync is manual** — there is no auto-sync. Rules (`keywords.txt`) sync/share on the Rules & sync page; the blacklist (`handles.txt`) sync/share under Settings → Sync & share; both share one repo source (default `smthdagg/XShield-keywords`). Every sync, share and deletion is written to the local log (Logs page, exportable).

**Block pacing** (adjustable, conservative defaults): 300/day, batches of 30 (15-min pause after each), 5 s interval. X publishes no official limits — tune to your account's age and weight. Manually confirmed blocks jump the queue.

**Block failures**: open x.com and stay logged in (blocking needs an X session); failed users are not auto-retried for 24 hours — see the Logs page for reasons; the manual 拉黑列表 button always retries explicitly.

**Undo a mistaken block**: block-log page → that user's card → 白名单 (unblock + whitelist).

**Is it running?** Version badge at the sidebar bottom; or F12 on X for the `[XShield] content vX ready` console line.

**Report an issue**: 总设置 → Export diagnostics → send the JSON file.

### Privacy

Everything is stored locally in your browser. Network requests: cloud library/blocklist downloads (on manual sync), the X block endpoint, and optional GitHub sharing uploads (only on explicit click with a token).

### License

MIT License, see [LICENSE](LICENSE).

---

详细教程 / Full tutorials: [中文说明书](docs/USER_GUIDE.zh-CN.md) · [English Guide](docs/USER_GUIDE.en.md)
