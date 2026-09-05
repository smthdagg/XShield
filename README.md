# XShield

X(Twitter) 评论区垃圾拦截 + 触发名单自动拉黑 + 社区共享黑名单的本地优先 Chrome 扩展。

触发与拉黑内核对齐 [X(Twitter) Comment Blocker 1.5.1](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)（MIT），在此之上提供卡片式管理面板、云端词库/黑名单同步与诊断工具。

**当前版本：1.0.0（稳定版）。** 详细教程：[中文说明书](docs/USER_GUIDE.zh-CN.md) · [English Guide](docs/USER_GUIDE.en.md)。

## 核心模型（一句话）

**关键词命中 → 记录进触发名单 → 30 分钟缓冲期（可加白/删除干预）→ 未干预则按风控节奏自动拉黑 → 账本标记已拉黑。**

词库只有一个（云端同步 + 本地自定义两层），不存在"自动拉黑词"与"普通词"之分。

## 功能

### 评论过滤（触发）
- 关键词 / 正则（`/pattern/flags` 一行一条）匹配推文正文与昵称
- 命中处理：**屏蔽回帖**（隐藏）或 **高亮**（黄底红字，总设置切换）
- 附加开关：同时查用户名、仅评论区生效、特殊字符刷屏、纯 emoji、Grok 分享卡
- 白名单用户永不触发；**社区共享黑名单**中的账号同样触发
- 页面右键选中文字 →「添加到屏蔽词」

### 拉黑（风控以内，可调）
- 触发即入待拉黑队列，**30 分钟缓冲期**内可在面板干预（白名单/删除即取消）
- 未干预由看门狗按节奏执行：每批 30 个（可调）、批后歇 15 分钟、间隔 5 秒 ±5 秒抖动（可调）、每日上限 300（可调）、429 暂停 15 分钟、失败 5 次指数退避
- 手动「拉黑列表(N)」确认的批次跳过缓冲期立即执行
- 走 X 网页会话（ct0 + Bearer）调 `blocks/create.json|destroy.json`，屏幕名直连

### 云端同步（拉取为主，共享可选）
- **词库**：`smthdagg/XShield-keywords` 的 `keywords.txt`（已清洗：纯内容词 + 品牌词 + 正则，561 行）——GitHub API → jsDelivr CDN → 内置兜底三层
- **社区共享黑名单**：同仓库 `handles.txt`（与词库分文件）——下载后由喂送器分批进入待拉黑流程
- **共享（可选）**：填 GitHub Token 后，一键把你账本里的 handle 合并上传到项目 `handles.txt`，全员受益；不填 Token 只下载，数据不出本机

### 管理面板（五页）
1. **触发记录** = 待拉黑名单：全部未拉黑记录（排队中的带「排队中」徽标），单条 拉黑/白名单/删除，全选拉黑，拉黑节奏设置
2. **拉黑记录**：今日/剩余/已拉黑统计 + 近 7 天按日拉黑 + 已拉黑数据库视图（最新 300 个分页浏览，全量搜索后解除）
3. **白名单**：增删
4. **规则与同步**：云端词库（同步/搜索/禁用）+ 本地词库（增删/编辑/导入导出）
5. **总设置**：总开关、屏蔽/高亮、过滤开关、词库源、GitHub Token、语言、**导出诊断信息**

侧栏底部显示版本号；内容脚本与后台启动时向控制台输出版本日志，页面是否在跑最新代码一眼可辨。

## 安装

```
corepack enable
pnpm install
pnpm build
```

Chrome → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选择 `apps/extension/dist`。

## 快速上手

1. 登录 x.com（拉黑依赖当前 Chrome 的登录会话）
2. 打开面板 → 规则与同步 → 点「立即同步」载入云端词库（内置兜底开箱即用）
3. 浏览 X：命中关键词的回复立即隐藏，作者进入待拉黑名单
4. 触发记录页处理名单：什么都不做 → 30 分钟后自动拉黑；点白名单/删除 → 永久豁免；点拉黑/全选拉黑 → 立即执行
5. 拉黑记录页看进度与结果

> 更新扩展后，已打开的 X 页面需刷新一次才会注入新脚本（Chrome 机制，所有内容脚本扩展皆如此）。

## 隐私

全部数据保存在本地 `chrome.storage.local`（含 unlimitedStorage）。网络请求仅：云端词库/黑名单文件拉取、GitHub 共享上传（仅你主动点击且填了 Token）、X 拉黑接口（触发/手动操作时）。详见 [docs/PRIVACY.md](docs/PRIVACY.md)。

## 许可

MIT。触发与拉黑内核源自 amahteru/x-comment-blocker（MIT）。

---

## OpenWrt 私有源安装 / Install from the private OpenWrt feed

本项目已在私有 OpenWrt 软件源中预留目录（目录名与仓库同名）：
`https://smthdagg.github.io/Smthdagg-Repo-feeds/XShield/`

包发布后，在 OpenWrt 路由器上执行 / Once packages are published, run on the router:

```sh
# 1) 导入签名公钥（一次即可，长期不变） / import the signing key (once, long-lived)
wget -O /etc/opkg/keys/f7050198aa77cf15 \
  https://raw.githubusercontent.com/smthdagg/Smthdagg-Repo-feeds/main/wloc.pub
# 2) 添加本项目源 / add this project's feed
echo "src/gz XShield https://smthdagg.github.io/Smthdagg-Repo-feeds/XShield" \
  >> /etc/opkg/customfeeds.conf
# 3) 安装 / install
opkg update && opkg install XShield
```

> 状态：目录已预留，尚未发布 OpenWrt 包；发布后本节会更新为具体版本号。
>
> Status: directory reserved, no packages published yet; this section will be updated with concrete versions once packages ship.
