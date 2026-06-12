# XShield

<p align="center">
  <img src="assets/xshield-logo-1024.png" alt="XShield logo" width="220" />
</p>

**XShield** is a local-first Chrome extension for detecting spam-like, promotional, scam, and mass-reply accounts on X/Twitter, reviewing candidates manually, and blocking confirmed accounts through a controllable queue.

XShield is designed as a human-reviewed safety assistant. It keeps rules, candidates, queues, block history, whitelist data, and logs in the browser's local IndexedDB by default.

## Languages

- [English](#english)
- [简体中文](#简体中文)
- [繁體中文](#繁體中文)
- [日本語](#日本語)
- [한국어](#한국어)
- [Français](#français)

## English

### Features

- Collect visible users from X/Twitter timelines, replies, search results, and user cards.
- Match `username`, `displayName`, `bio`, and visible post `content`.
- Support keyword rules and regular expressions, one rule per line.
- Highlight matched posts with a light yellow background while browsing X.
- Show candidate profile links, avatars, bios, follower text, scores, and match reasons.
- Review candidates manually before sending them to the block queue.
- Add false positives to the whitelist so they will not be blocked later.
- Execute the block queue with configurable batch size, interval, retry, and cooldown settings.
- Support real block mode and mock mode.
- Deduplicate repeated candidates and skip users already recorded as blocked.
- Export blocked users as TXT, CSV, JSON, NDJSON, or SQL.
- No backend service is required by default.

### Installation

#### Option A: Load the built extension

1. Download or build this project.
2. Open Chrome and visit:

```text
chrome://extensions
```

3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select:

```text
apps/extension/dist
```

6. Pin XShield in the Chrome toolbar.

#### Option B: Build from source

Requirements:

- Node.js 20+
- pnpm 9+

```bash
corepack enable
pnpm install
pnpm build
```

Then load `apps/extension/dist` from `chrome://extensions`.

### Basic Usage

1. Log in to X/Twitter in Chrome.
2. Open the XShield dashboard from the extension popup.
3. Create detection rules in **Rules**.
4. Browse X/Twitter pages. Matched posts will be highlighted and matched users will enter the candidate pool.
5. Review users in **Candidate Users**.
6. Add confirmed targets to **Block Queue**.
7. Configure batch size, interval, and real/mock mode in **Settings**.
8. Run the queue from **Block Queue**.
9. Export blocked users from **Blocked Users** when needed.

### Real Block Mode Notice

Real block mode uses the current X/Twitter web session in your browser. It may stop working if X changes its web API, login state, CSRF handling, or page structure.

Use conservative limits, such as 50 to 100 users per batch with at least a 10-minute interval. You are responsible for account safety, platform rules, and local legal compliance.

Full guide: [docs/USER_GUIDE.en.md](docs/USER_GUIDE.en.md)

## 简体中文

### 功能简介

- 从 X/Twitter 时间线、回复区、搜索结果和用户卡片采集可见用户。
- 按 `username`、`displayName`、`bio`、`content` 进行关键词或正则匹配。
- 支持一行一个关键词或正则表达式。
- 浏览 X 时，命中的帖子会显示浅黄色底色。
- 候选用户列表显示主页链接、头像、自我介绍、粉丝信息、分数和命中原因。
- 候选用户进入拉黑队列前支持人工复核。
- 误触发用户可加入白名单，后续不会被拉黑。
- 拉黑队列支持批量大小、执行间隔、重试和失败冷却设置。
- 支持真实拉黑模式和模拟模式。
- 自动去重重复候选用户，并跳过本地已记录为已拉黑的用户。
- 已拉黑用户支持导出为 TXT、CSV、JSON、NDJSON、SQL。
- 默认不需要后端服务，数据保存在浏览器本地。

### 安装方式

#### 方式 A：加载已构建插件

1. 下载或构建本项目。
2. 打开 Chrome：

```text
chrome://extensions
```

3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择：

```text
apps/extension/dist
```

6. 将 XShield 固定到 Chrome 工具栏。

#### 方式 B：从源码构建

需要：

- Node.js 20+
- pnpm 9+

```bash
corepack enable
pnpm install
pnpm build
```

构建完成后，在 `chrome://extensions` 加载 `apps/extension/dist`。

### 基本使用流程

1. 在 Chrome 中登录 X/Twitter。
2. 从插件弹窗打开 XShield Dashboard。
3. 在“规则”里创建关键词或正则规则。
4. 浏览 X/Twitter 页面，命中的帖子会高亮，命中的用户会进入候选池。
5. 在“候选用户”中人工复核。
6. 将确认目标加入“拉黑队列”。
7. 在“设置”中配置每批数量、间隔时间、真实/模拟模式。
8. 在“拉黑队列”中执行。
9. 需要备份或迁移时，在“已拉黑用户”中导出数据。

### 真实拉黑说明

真实拉黑模式会使用当前浏览器中的 X/Twitter 登录状态。若 X 更新网页接口、登录状态、CSRF 策略或页面结构，功能可能暂时失效。

建议保守设置，例如每批 50 到 100 人，间隔至少 10 分钟。账号安全、平台规则和当地法律合规责任由使用者自行承担。

完整说明：[docs/USER_GUIDE.zh-CN.md](docs/USER_GUIDE.zh-CN.md)

## 繁體中文

### 功能簡介

- 從 X/Twitter 時間軸、回覆區、搜尋結果和使用者卡片擷取可見使用者。
- 依 `username`、`displayName`、`bio`、`content` 進行關鍵字或正規表示式比對。
- 支援一行一個關鍵字或正規表示式。
- 瀏覽 X 時，命中的貼文會顯示淡黃色背景。
- 候選使用者列表會顯示個人頁連結、頭像、簡介、粉絲資訊、分數和命中原因。
- 拉黑前可人工複核候選使用者。
- 誤觸發使用者可加入白名單，後續不會被拉黑。
- 拉黑佇列支援批次數量、執行間隔、重試和失敗冷卻設定。
- 支援真實拉黑模式與模擬模式。
- 自動去除重複候選使用者，並跳過本機已記錄為已拉黑的使用者。
- 已拉黑使用者可匯出為 TXT、CSV、JSON、NDJSON、SQL。
- 預設不需要後端服務，資料儲存在瀏覽器本機。

### 安裝方式

1. 下載或建置本專案。
2. 在 Chrome 開啟 `chrome://extensions`。
3. 啟用「開發人員模式」。
4. 點選「載入未封裝項目」。
5. 選擇 `apps/extension/dist`。

從原始碼建置：

```bash
corepack enable
pnpm install
pnpm build
```

完整說明：[docs/USER_GUIDE.zh-TW.md](docs/USER_GUIDE.zh-TW.md)

## 日本語

### 概要

XShield は、X/Twitter 上のスパム、広告、詐欺、誘導アカウントを検出し、候補を人が確認してからブロックキューで処理する Chrome 拡張機能です。

### 主な機能

- タイムライン、返信、検索結果、ユーザーカードから表示中のユーザーを収集。
- `username`、`displayName`、`bio`、`content` を対象にキーワードまたは正規表現で検出。
- 検出された投稿を淡い黄色でハイライト。
- 候補ユーザーのリンク、アイコン、プロフィール、フォロワー情報、スコア、検出理由を表示。
- ホワイトリスト、ブロックキュー、実ブロック、模擬モードに対応。
- ブロック済みユーザーを TXT、CSV、JSON、NDJSON、SQL 形式でエクスポート。

### インストール

1. Chrome で `chrome://extensions` を開く。
2. Developer mode を有効にする。
3. Load unpacked をクリックする。
4. `apps/extension/dist` を選択する。

ソースからビルドする場合：

```bash
corepack enable
pnpm install
pnpm build
```

詳細: [docs/USER_GUIDE.ja.md](docs/USER_GUIDE.ja.md)

## 한국어

### 개요

XShield는 X/Twitter에서 스팸, 광고, 사기, 대량 홍보 계정을 감지하고, 사용자가 후보를 검토한 뒤 차단 큐를 통해 처리할 수 있는 Chrome 확장 프로그램입니다.

### 주요 기능

- 타임라인, 답글, 검색 결과, 사용자 카드에서 보이는 사용자를 수집합니다.
- `username`, `displayName`, `bio`, `content`를 키워드 또는 정규식으로 검사합니다.
- 감지된 게시물을 연한 노란색 배경으로 표시합니다.
- 후보 사용자의 링크, 아바타, 소개, 팔로워 정보, 점수, 감지 이유를 보여 줍니다.
- 화이트리스트, 차단 큐, 실제 차단 모드, 모의 모드를 지원합니다.
- 차단된 사용자 목록을 TXT, CSV, JSON, NDJSON, SQL로 내보낼 수 있습니다.

### 설치

1. Chrome에서 `chrome://extensions`를 엽니다.
2. Developer mode를 켭니다.
3. Load unpacked를 클릭합니다.
4. `apps/extension/dist`를 선택합니다.

소스에서 빌드:

```bash
corepack enable
pnpm install
pnpm build
```

자세한 문서: [docs/USER_GUIDE.ko.md](docs/USER_GUIDE.ko.md)

## Français

### Présentation

XShield est une extension Chrome locale qui aide à détecter les comptes de spam, publicité, fraude ou promotion massive sur X/Twitter, puis à les examiner avant de les bloquer via une file contrôlée.

### Fonctionnalités

- Collecte les utilisateurs visibles dans le fil, les réponses, la recherche et les cartes utilisateur.
- Analyse `username`, `displayName`, `bio` et `content` avec des mots-clés ou des expressions régulières.
- Met en évidence les publications détectées avec un fond jaune clair.
- Affiche lien de profil, avatar, bio, abonnés, score et raison de détection.
- Prend en charge la liste blanche, la file de blocage, le mode réel et le mode simulation.
- Exporte les utilisateurs bloqués en TXT, CSV, JSON, NDJSON ou SQL.

### Installation

1. Ouvrez `chrome://extensions` dans Chrome.
2. Activez le mode développeur.
3. Cliquez sur **Load unpacked**.
4. Sélectionnez `apps/extension/dist`.

Construire depuis le code source :

```bash
corepack enable
pnpm install
pnpm build
```

Guide complet : [docs/USER_GUIDE.fr.md](docs/USER_GUIDE.fr.md)

## Project Links

- Privacy: [docs/PRIVACY.md](docs/PRIVACY.md)
- Development: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
- Release: [docs/RELEASE.md](docs/RELEASE.md)
- Sponsorship: [docs/SPONSORSHIP.md](docs/SPONSORSHIP.md)
- Security: [SECURITY.md](SECURITY.md)
- License: [MIT](LICENSE)
