# XShield

X(Twitter) 评论垃圾拦截 + 一键拉黑 + 云端词库同步的本地优先 Chrome 扩展。

触发与拉黑内核 1:1 移植自 [X(Twitter) Comment Blocker 1.4.3](https://chromewebstore.google.com/detail/xtwitter-comment-blocker/gagacedifiphcndckimeihhcbcclkach)（MIT），在此之上提供卡片式管理面板、GitHub 词库双向同步与说明书。

## 功能

### 评论过滤（触发）
- 关键词 / 正则（`/pattern/i` 一行一条）匹配推文正文与昵称
- 命中处理二选一（总设置里切换）：**屏蔽回帖**（隐藏）或 **高亮黄底红字**
- 附加开关：同时查用户名、仅评论区生效、特殊字符刷屏、纯 emoji、Grok 分享卡
- 白名单用户永不触发
- 词库来源：**云端词库**（GitHub `keywords.txt`，API→CDN→内置三层兜底）+ **我的词库**（本地添加 / 右键选中文字添加 / 导入导出）
- 自动拉黑词：从云端/自定义词中勾选，命中即进入待拉黑队列

### 拉黑（风控以内）
- 手动：触发记录单条「拉黑」、勾选「全选拉黑(N)」3 秒双击确认
- 自动：自动拉黑词命中即入队
- 队列节流（1.4.3 原版参数）：每批 30 个、批后暂停 15 分钟、单次间隔 5–10 秒随机、429 再停 15 分钟、每日上限 300、失败 5 次指数退避
- 走 X 网页会话（ct0 + Bearer）调 `blocks/create|destroy.json`

### 词库 GitHub 双向
- 只读拉取：公共词库仓库 `amahteru/x-comment-blocker` 的 `keywords.txt`（6 小时自动 + 手动同步 + ETag/304 + 内置兜底）
- **上传（贡献者）**：在总设置填 GitHub Token + `owner/repo` + 分支后，词库页一键把**云端 + 自定义全部词**合并上传到自己仓库的 `keywords.txt`（Contents API，GET sha → PUT base64）
- 普通用户不填 Token 只读

### 管理面板（五页）
1. **触发记录**：卡片（昵称/@id/原因/时间/回帖内容，点击跳主页）；单条拉黑、加白、删除；全选拉黑
2. **拉黑记录**：今日拉黑 / 待拉黑 / 已拉黑统计；待拉黑队列卡片（昵称/bio/触发内容）；已拉黑列表（可解除）
3. **白名单**：增删
4. **规则与同步**：云端词库（同步/搜索/禁用/勾自动拉黑）+ 我的词库（增删/导入导出/勾自动拉黑/上传 GitHub）
5. **脚本总设置**：总开关、命中处理方式（屏蔽/高亮）、过滤开关、云同步开关、语言、GitHub Token/仓库/分支

拉黑流转：触发记录 →（单拉/入队）→ 队列消化（节流）→ 已拉黑。触发记录**永不因拉黑删除**——是否已拉黑由账本标记，卡片按钮显示「拉黑 ↔ 已拉黑」，并可用「已拉黑」筛选。

## 安装

```
corepack enable
pnpm install
pnpm build
```

Chrome → `chrome://extensions` → 开发者模式 → **加载已解压的扩展程序** → 选择 `apps/extension/dist`。

## 使用

1. 登录 x.com（拉黑依赖当前 Chrome 的登录会话）
2. 打开面板（扩展图标 → 打开面板）→ 规则与同步 → 确认云端词库已载入（内置兜底开箱即用）
3. 浏览推文评论区，命中即隐藏（或切高亮模式）
4. 触发记录页处理名单：单拉 / 全选拉黑 / 加白 / 删除
5. 拉黑记录页查看队列消化进度

详细说明见 [docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)。

## 隐私

全部数据（词库、历史、队列、白名单、设置）保存在本地 `chrome.storage.local`；网络请求仅：公共词库文件拉取、GitHub 上传（仅你主动点击且填了 Token）、X 拉黑接口（你主动操作时）。

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
