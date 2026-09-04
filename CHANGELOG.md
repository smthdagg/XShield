# Changelog

## 0.5.7 - 2026-09-05

### 云端词库新增结构反垃圾正则

- 新增 `/^[a-z]{2,3}(?:\n[a-z]{2,3})*\s*$/i`：整条评论只有“若干行 2–3 个纯字母串”时隐藏（随机字母灌水机器人）。已知误伤面：真人只回 `ok`/`lol`/`gg` 这类 2–3 字母也会命中，可在规则页单条禁用。
- 内置兜底词库与云端库同步更新（561 行）。规则库两层不变：云端同步（项目方维护）+ 本地自定义（用户自用）。

## 0.5.6 - 2026-09-05

### 修复：清洗后的词库无法同步到本地

- 移除 CDN 同步通道的「新词库比本地短即视为旧缓存」长度保护——词库源清洗后从 803 行变为 560 行，该保护把合法的缩短当成陈旧缓存静默放弃，导致规则页永远看不到清洗效果（GitHub API 通道常被限流，实际走的就是 CDN 通道）。CDN 请求本就带 `?t=` 时间戳防缓存，保护已无必要。

## 0.5.5 - 2026-09-05

### 词库源切换为自有仓库，剔除账号 handle

- **云端词库源从上游 `amahteru/x-comment-blocker` 切换为自有仓库 `smthdagg/XShield-keywords`**：上游的 keywords.txt 混入了 244 个垃圾账号 handle（在 XShield 的账本模型里毫无意义，且污染规则库），已全部剔除。新词库 560 行 = 全部中文内容词 + 22 个品牌/广告词（VPN、交易所等）+ `t.cn`/`Gate Card` + 7 条正则规则。
- 内置兜底词库（public/keywords.txt）同步清洗。
- 下次同步（面板 → 规则与同步 → 立即同步）自动用干净词库整体替换本地 `cloudKeywords`。

## 0.5.4 - 2026-09-05

### 确认即离开工作列表（排队中/已拉黑双态）

- **确认拉黑的那一刻，记录立刻离开「触发记录」工作列表**：新增「排队中」筛选——确认（或自动触发入队）后记录先归入「排队中」，后台拉黑成功、账本落定后自动归入「已拉黑」。此前记录要等每个用户实际拉黑成功（每 5–10 秒一个）才消失，看起来像「列表不自动清空」。
- **面板侧栏直接显示版本号**（如 v0.5.4），一眼确认浏览器实际运行的代码版本。

## 0.5.3 - 2026-09-04

### 触发记录列表随拉黑收敛

- **拉黑成功后，记录离开「触发记录」默认列表**：默认筛选改为「未拉黑」——用户进入拉黑账本后，其记录从工作列表消失，切到「已拉黑」筛选可见；解除拉黑后回到默认列表。记录本身仍按 1.5.1 模型保留在存储中（拉黑永不删记录，防数据漂移），只是工作视图随拉黑收敛。
- 全部拉黑完成时列表显示提示「已拉黑的记录都在『已拉黑』筛选里」，不再显示无差别空态。

## 0.5.2 - 2026-09-04

### 可观测性

- 内容脚本与后台启动时在控制台输出版本与状态（`[XShield] content vX ready · 启用/规则数`、`[XShield] background vX loaded`），用于确认浏览器实际运行的代码版本——扩展重载后，**已打开的 x.com 标签页必须刷新**才会注入新内容脚本，否则看起来像「改了没生效」。

## 0.5.1 - 2026-09-04

### 修复两个实测 bug

- **已拉黑用户残留在「待拉黑」队列**：账本与队列全链路同步——拉黑落账（`markBlockedOnX`）时立即把该用户从队列移除并持久化；处理循环每轮从存储刷新后先按账本清洗队列；出队后再次核对账本，命中即跳过（不再对已拉黑用户发第二次 create.json）；面板「待拉黑」卡片与计数也按账本过滤显示。历史残留的脏队列在后台启动时自动清洗。
- **首次打开不触发过滤、刷新才触发**：X 首开注水时把整段推文子树插进已存在的空骨架 cell 内部——此前 MutationObserver 只认「新节点是 cell」或「新节点包含 cell」两种形态，漏掉这种「cell 是祖先」的情况，只能靠 3.2s 前的延迟重扫兜底，冷缓存水合慢于 3.2s 就永远错过。现在观察器补上 `closest` 路径（新增节点位于 cell 内部 → 处理该 cell），注水后立刻触发；延迟重扫兜底延长到 10s。
- **恢复完整构建链**：删除零引用的遗留死模块（`src/db/` 全部、`src/store/` 中 `useAppStore`/`queueRunner`/`realBlockAdapter`/`xApiBlockAdapter`，其依赖 dexie/zustand 上一版已移除），`npm run build`（tsc + vite build）恢复可用。
- **回归测试**：新增 3 条——手动拉黑清除队列中同用户、启动清洗脏队列且不发任何 API、文章子树注入已有骨架 cell 时观察器立即隐藏（不依赖延迟重扫）。

### 架构对齐 X(Twitter) Comment Blocker 1.5.1：修复数据漂移与不稳定

- **拉黑 API 改回 screen_name 直连**（1.5.1 契约）：`POST /i/api/1.1/blocks/create.json|destroy.json`，body 仅 `screen_name=`。删除了 profile 页解析 `id_str` 的 `resolveUserId` 环节——那一步慢、脆弱，且账号已注销时会误报「账号不存在」。HTTP 2xx 即成功（响应体解析失败也算成功）；body 中 code 34/50/63 视为永久失败（账号不存在/已注销/被封），不重试。
- **拉黑不再删除触发记录**（1.5.1 模型，反漂移核心）：`blockedHistory` 只由记录/删除记录操作增减，拉黑成功**永不**动它。是否已拉黑由账本 `blockedUsersOnX` 标记，触发页卡片按钮显示「拉黑 ↔ 已拉黑」，并新增「已拉黑」筛选项（账本由后台在拉黑/解除成功时统一写入，面板不直接写）。用户看到的状态永远与 X 上一致。
- **自动拉黑队列改为 pop-first**（1.5.1 崩溃安全）：先 `shift()` 出队并立即持久化，再发网络请求——MV3 worker 崩溃不会重复拉黑同一用户。429 回插队首 + 暂停 15 分钟；瞬时失败回插队尾 + 指数退避（5s 起，最多 5 次）；永久失败记 warn 后丢弃。
- **修复每日计数静默失效**：原实现用 `Temporal.Now.plainDateISO()` 做每日重置，稳定版 Chrome 无此 API，导致自动拉黑循环异常。改用 1.5.1 的本地日期 `YYYY-MM-DD`。
- **移除启动校对**（`reconcileLegacyRecords`）：记录与账本本就独立，无需启动时清理。
- **面板移除简介抓取**（`fetchProfileBio`）：拉黑/队列卡片不再逐个请求 profile 页（减少无谓请求，降低风控暴露）。
- **清理死依赖**：移除零引用的 `@xshield/block-executor`、`@xshield/rule-engine`、`@xshield/search-engine`、`@xshield/shared`、`dexie`、`zustand`。

### 修复（保留自上一版）

- **单一写者**：`blockedHistory` 与 `blockedUsersOnX` 只能由后台修改；面板不直接写这两个键。
- **修复 `AsyncQueue.enqueue` 丢失任务返回值**：`resolve()` 无参调用导致取返回值恒为 `undefined`。

## 0.5.0 - 2026-08-20

### 词库上传自己的 GitHub

- **上传全部词库**：规则与同步页「上传全部词库到我的 GitHub」现在把**云端下载的词 + 自定义词**合并上传到自己仓库的 `keywords.txt`（与仓库现有内容合并且去重）；此前只上传自定义词。总设置中填好 GitHub Token / owner\/repo / 分支即可；普通用户不填 Token 保持只读。

### 说明书与文档

- README 全面重写：新架构（触发\/五页面板\/云端词库三层兜底\/风控拉黑\/GitHub 双向）。
- 新版中文说明书 `docs/USER_GUIDE.zh-CN.md`：安装、三步上手、触发规则、拉黑节流、上传 GitHub 步骤、常见问题。

## 0.4.0 - 2026-08-20

### 整合 X(Twitter) Comment Blocker 1.4.3 体系

- **修复「一堆没匹配」**：单条推文页（`/status/xxx`）下，回复的 `isMainTweet` 误判为 true（任何带时间链接的推文都算主推文），`onlyComments` 模式因此把所有回复全部跳过。现已改为对比页面 status id，只有真正的帖子本体被跳过，回复正常参与匹配。
- **安装即同步词库**：扩展安装时立即拉取云端词库（不再等 1 分钟 alarm），开箱即可过滤。

- **触发重写**：内容脚本改用 1.4.3 的关键字 trie 正则 + 自定义正则（`/pattern/flags`）直接匹配推文正文/昵称，命中即隐藏（或可选红色高亮），并上报自动拉黑词命中的用户。移除旧的采集-评分-候选流程。
- **云端词库**：从 GitHub 仓库 `keywords.txt` 只读同步（GitHub API + jsDelivr CDN 兜底、ETag/304、6 小时自动 + 手动同步）。词库仓库可在设置中配置。
- **GitHub 写入（贡献者）**：设置中填写 GitHub Token + owner/repo + 分支后，「提交我的词到 GitHub」用 Contents API 把自定义词合并写回自己仓库的 `keywords.txt`；普通用户无 token 仅只读。
- **自动拉黑**：`AutoBlockManager` 每 10 分钟一批、每批 50 个；5-10 秒随机延时、429 暂停 15 分钟、5 次重试指数退避、1 分钟 watchdog；队列持久化于 `chrome.storage.local`。
- **手动拉黑**：历史列表单条「拉黑/已拉黑」toggle（走 X 网页 API `blocks/create|destroy.json`，先解析 `user_id`）+ 批量「确认拉黑(N)」3 秒双击。
- **界面**：保留 Dashboard 导航框架，页面重做为 1.4.3 风格（概览/词库/屏蔽历史/待拉黑队列/白名单/设置）；右键选中文字快速添加屏蔽词。
- **存储迁移**：全部状态从 IndexedDB 迁至 `chrome.storage.local`，内容脚本与界面通过 `storage.onChanged` 实时联动。
- 移除：候选/评分/规则编辑器、复杂队列、DOM 隐藏标签页拉黑。

## 0.3.6 - 2026-06-12

- Fixed profile enrichment so queued users never receive the current logged-in account's avatar, bio, or follower count.
- Profile enrichment now only accepts X profile data when the parsed `screen_name` matches the target username.
- Added automatic cleanup for suspicious shared queue profile data caused by the previous enrichment bug.
- Updated project links to the public GitHub repository.

## 0.3.5 - 2026-06-12

- Added an in-app multilingual Help manual in the dashboard.
- Help content now follows the selected/system language and covers setup, rules, candidate review, block queue, export, real block safety, and common usage guidance.

## 0.3.4 - 2026-06-12

- Redesigned the extension logo with an X platform, protective shield, and classical Chinese shield style.
- Added Chrome extension icon assets for 16, 32, 48, and 128 pixel sizes.
- Added blocked-user export from the dashboard in TXT, CSV, JSON, NDJSON, and SQL formats.

## 0.3.3 - 2026-06-12

- 入队前自动补拉 X 用户主页资料，补全粉丝数、头像、自我介绍等字段。
- 修复候选用户从回复列表采集时缺少粉丝数，导致待拉黑列表粉丝为空的问题。

## 0.3.2 - 2026-06-12

- 修复内置中文、日文、韩文广告规则编码污染导致无法匹配的问题。
- 新增内置规则版本号，旧版本用户升级后会自动导入新版广告规则。
- 增强识别“线下约见入口、真实可靠、全国牵线、1-5线资源自取、看我主页”等 X 广告账号。

## 0.3.1 - 2026-06-12

- 新增可删除的内置广告识别规则，覆盖中文资源引流、多语言广告引流和 emoji 刷屏。
- 内置规则仅首次升级导入一次，用户删除后不会反复恢复。
- 适配类似“线下对接、附近真实资源、同城资源自取、点我头像、看我简介”的 X 广告账号。

## 0.3.0 - 2026-06-11

- 整理为 GitHub 开源发布版本。
- 新增项目元数据、版本、反馈、赞助和版权信息。
- 新增弹窗版权水印与关于页。
- 新增完整 README、使用说明、隐私说明、开发说明、安全说明、贡献指南和 GitHub 模板。
- 保留真实拉黑队列、候选用户复核、白名单、规则匹配、命中高亮、节流执行等核心能力。

## 0.2.13 - 2026-06-11

- 移除弹窗里的 Open Settings 入口。
- 弹窗改为显示触发待处理数量和拉黑队列数量。

## 0.2.12 - 2026-06-11

- 执行队列按钮跟随设置中的批量、间隔和模式。
- 新增手动立即拉黑按钮，并提示账号风险。

## 0.2.x - 2026-06-11

- 完成规则匹配、候选用户、白名单、拉黑队列、真实拉黑适配、重复用户去重、已拉黑数据库、页面命中提醒等功能。
