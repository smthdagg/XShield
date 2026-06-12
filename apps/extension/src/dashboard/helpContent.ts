export interface HelpSection {
  title: string;
  body: string[];
}

export interface HelpManual {
  title: string;
  intro: string;
  sections: HelpSection[];
}

export type HelpLanguage = 'en' | 'zh-CN' | 'zh-TW' | 'ja' | 'ko' | 'fr';

export const helpManuals: Record<HelpLanguage, HelpManual> = {
  en: {
    title: 'Help Manual',
    intro: 'XShield helps you detect suspicious X/Twitter accounts, review them manually, and block confirmed targets through a controlled queue.',
    sections: [
      {
        title: '1. First Setup',
        body: [
          'Load the extension from apps/extension/dist in chrome://extensions with Developer mode enabled.',
          'Log in to X/Twitter in the same Chrome profile before using real block mode.',
          'Open Dashboard from the extension popup.',
        ],
      },
      {
        title: '2. Rules',
        body: [
          'Create keyword or regex rules in Rules. Use one keyword or regular expression per line.',
          'Rules can match username, display name, bio, and visible post content.',
          'Matched posts are highlighted in light yellow while browsing X.',
        ],
      },
      {
        title: '3. Candidate Review',
        body: [
          'Open Candidate Users to review avatar, profile link, bio, follower information, score, and match reason.',
          'Add confirmed accounts to the block queue. Add false positives to the whitelist.',
          'Repeated users are deduplicated automatically.',
        ],
      },
      {
        title: '4. Block Queue',
        body: [
          'Run Batch follows Settings, including batch size, interval, retry count, and real/mock mode.',
          'Manual Block Now ignores the configured interval. Use it carefully because too many blocks at once may affect your account.',
          'Already blocked, missing, whitelisted, or mismatched users are skipped or removed from the queue.',
        ],
      },
      {
        title: '5. Export',
        body: [
          'Blocked Users can be exported as TXT, CSV, JSON, NDJSON, or SQL.',
          'CSV is best for spreadsheets. JSON and NDJSON are best for scripts. SQL is useful for database migration.',
        ],
      },
      {
        title: '6. Safety',
        body: [
          'Real block mode depends on the current X/Twitter web session and may break if X changes its web API or page structure.',
          'Start with mock mode, use conservative batch sizes, and keep long enough intervals.',
          'You are responsible for account safety, platform rules, and local legal compliance.',
        ],
      },
    ],
  },
  'zh-CN': {
    title: '帮助手册',
    intro: 'XShield 用于识别 X/Twitter 上的可疑账号，经过人工复核后，再通过可控队列执行拉黑。',
    sections: [
      {
        title: '1. 初次设置',
        body: [
          '在 chrome://extensions 打开开发者模式，加载 apps/extension/dist。',
          '如果要使用真实拉黑，请先在同一个 Chrome 用户中登录 X/Twitter。',
          '从插件弹窗打开 Dashboard。',
        ],
      },
      {
        title: '2. 规则',
        body: [
          '在“规则”中创建关键词或正则规则，一行一个关键词或正则表达式。',
          '规则可以匹配用户名、显示名、自我介绍和可见帖子内容。',
          '浏览 X 时，命中的帖子会显示浅黄色底色。',
        ],
      },
      {
        title: '3. 候选复核',
        body: [
          '在“候选用户”中查看头像、主页链接、自我介绍、粉丝信息、分数和命中原因。',
          '确认目标后加入拉黑队列；误触发用户加入白名单。',
          '重复出现的同一用户会自动去重。',
        ],
      },
      {
        title: '4. 拉黑队列',
        body: [
          '“执行队列”会按设置里的每批数量、间隔时间、重试次数和真实/模拟模式执行。',
          '“手动立即拉黑”会忽略设置里的间隔限制，请谨慎使用，一次拉黑过多可能影响账号。',
          '已拉黑、不存在、白名单或 ID 不匹配的用户会被跳过或移出队列。',
        ],
      },
      {
        title: '5. 导出',
        body: [
          '“已拉黑用户”支持导出 TXT、CSV、JSON、NDJSON、SQL。',
          'CSV 适合表格软件；JSON 和 NDJSON 适合程序处理；SQL 适合数据库迁移或二次加工。',
        ],
      },
      {
        title: '6. 安全提醒',
        body: [
          '真实拉黑依赖当前 X/Twitter 网页登录状态，X 更新接口或页面结构后可能暂时失效。',
          '建议先使用模拟模式，批量数量保守设置，并保留足够长的执行间隔。',
          '账号安全、平台规则和当地法律合规责任由使用者自行承担。',
        ],
      },
    ],
  },
  'zh-TW': {
    title: '幫助手冊',
    intro: 'XShield 可協助識別 X/Twitter 上的可疑帳號，經人工複核後，再透過可控佇列執行拉黑。',
    sections: [
      {
        title: '1. 初次設定',
        body: [
          '在 chrome://extensions 開啟開發人員模式，載入 apps/extension/dist。',
          '若要使用真實拉黑，請先在同一個 Chrome 使用者中登入 X/Twitter。',
          '從擴充功能彈窗開啟 Dashboard。',
        ],
      },
      {
        title: '2. 規則',
        body: [
          '在「規則」中建立關鍵字或正規表示式規則，一行一個。',
          '規則可比對使用者名稱、顯示名稱、個人簡介和可見貼文內容。',
          '瀏覽 X 時，命中的貼文會顯示淡黃色背景。',
        ],
      },
      {
        title: '3. 候選複核',
        body: [
          '在「候選使用者」中查看頭像、個人頁連結、簡介、粉絲資訊、分數和命中原因。',
          '確認目標後加入拉黑佇列；誤觸發使用者加入白名單。',
          '重複出現的同一使用者會自動去重。',
        ],
      },
      {
        title: '4. 拉黑佇列',
        body: [
          '「執行佇列」會依設定中的批次數量、間隔、重試次數和真實/模擬模式執行。',
          '「手動立即拉黑」會忽略間隔限制，請謹慎使用。',
          '已拉黑、不存在、白名單或 ID 不匹配的使用者會被跳過或移出佇列。',
        ],
      },
      {
        title: '5. 匯出',
        body: [
          '「已拉黑使用者」支援匯出 TXT、CSV、JSON、NDJSON、SQL。',
          'CSV 適合表格軟體；JSON 和 NDJSON 適合程式處理；SQL 適合資料庫遷移。',
        ],
      },
      {
        title: '6. 安全提醒',
        body: [
          '真實拉黑依賴目前 X/Twitter 網頁登入狀態，X 更新接口或頁面結構後可能暫時失效。',
          '建議先使用模擬模式，並設定保守批次與足夠長的間隔。',
          '帳號安全、平台規則與當地法律合規責任由使用者自行承擔。',
        ],
      },
    ],
  },
  ja: {
    title: 'ヘルプマニュアル',
    intro: 'XShield は X/Twitter 上の疑わしいアカウントを検出し、人が確認した後に制御されたキューでブロックするための拡張機能です。',
    sections: [
      {
        title: '1. 初期設定',
        body: [
          'chrome://extensions で Developer mode を有効にし、apps/extension/dist を読み込みます。',
          '実ブロックを使う場合は、同じ Chrome プロファイルで X/Twitter にログインしてください。',
          '拡張機能のポップアップから Dashboard を開きます。',
        ],
      },
      {
        title: '2. ルール',
        body: [
          'Rules でキーワードまたは正規表現ルールを作成します。一行に一つ入力します。',
          'username、displayName、bio、表示中の投稿 content を対象にできます。',
          '一致した投稿は淡い黄色でハイライトされます。',
        ],
      },
      {
        title: '3. 候補確認',
        body: [
          'Candidate Users でアイコン、プロフィールリンク、自己紹介、フォロワー情報、スコア、検出理由を確認します。',
          '対象ユーザーはブロックキューへ、誤検出はホワイトリストへ追加します。',
          '同じユーザーの重複は自動的に整理されます。',
        ],
      },
      {
        title: '4. ブロックキュー',
        body: [
          'Run Batch は設定されたバッチサイズ、間隔、リトライ、実行モードに従います。',
          'Manual Block Now は間隔制限を無視します。大量実行はアカウントに影響する可能性があります。',
          '既にブロック済み、不存在、ホワイトリスト、ID 不一致のユーザーはスキップまたは削除されます。',
        ],
      },
      {
        title: '5. エクスポート',
        body: ['Blocked Users から TXT、CSV、JSON、NDJSON、SQL 形式で出力できます。'],
      },
      {
        title: '6. 安全上の注意',
        body: [
          '実ブロックは現在の X/Twitter Web セッションに依存します。',
          'まず mock mode を使い、少量のバッチと十分な間隔を設定してください。',
        ],
      },
    ],
  },
  ko: {
    title: '도움말',
    intro: 'XShield는 X/Twitter의 의심 계정을 감지하고 사용자가 검토한 뒤 제어 가능한 큐로 차단하는 확장 프로그램입니다.',
    sections: [
      {
        title: '1. 첫 설정',
        body: [
          'chrome://extensions에서 Developer mode를 켜고 apps/extension/dist를 로드합니다.',
          '실제 차단을 사용하려면 같은 Chrome 프로필에서 X/Twitter에 로그인합니다.',
          '확장 프로그램 팝업에서 Dashboard를 엽니다.',
        ],
      },
      {
        title: '2. 규칙',
        body: [
          'Rules에서 키워드 또는 정규식 규칙을 만듭니다. 한 줄에 하나씩 입력합니다.',
          'username, displayName, bio, 보이는 게시물 content를 검사할 수 있습니다.',
          '일치한 게시물은 연한 노란색으로 표시됩니다.',
        ],
      },
      {
        title: '3. 후보 검토',
        body: [
          'Candidate Users에서 아바타, 프로필 링크, 소개, 팔로워 정보, 점수, 감지 이유를 확인합니다.',
          '확인된 대상은 차단 큐에 넣고, 오탐은 화이트리스트에 추가합니다.',
          '중복 사용자는 자동으로 정리됩니다.',
        ],
      },
      {
        title: '4. 차단 큐',
        body: [
          'Run Batch는 설정된 배치 크기, 간격, 재시도, 실행 모드를 따릅니다.',
          'Manual Block Now는 간격 제한을 무시합니다. 너무 많은 차단은 계정에 영향을 줄 수 있습니다.',
          '이미 차단됨, 존재하지 않음, 화이트리스트, ID 불일치 사용자는 건너뛰거나 큐에서 제거됩니다.',
        ],
      },
      {
        title: '5. 내보내기',
        body: ['Blocked Users에서 TXT, CSV, JSON, NDJSON, SQL 형식으로 내보낼 수 있습니다.'],
      },
      {
        title: '6. 안전',
        body: [
          '실제 차단은 현재 X/Twitter 웹 세션에 의존합니다.',
          '먼저 mock mode를 사용하고, 보수적인 배치 크기와 충분한 간격을 설정하세요.',
        ],
      },
    ],
  },
  fr: {
    title: "Manuel d'aide",
    intro: 'XShield aide à détecter les comptes suspects sur X/Twitter, à les examiner manuellement, puis à bloquer les cibles confirmées avec une file contrôlée.',
    sections: [
      {
        title: '1. Première configuration',
        body: [
          'Activez le mode développeur dans chrome://extensions et chargez apps/extension/dist.',
          'Pour le mode réel, connectez-vous à X/Twitter dans le même profil Chrome.',
          'Ouvrez Dashboard depuis la fenêtre de l’extension.',
        ],
      },
      {
        title: '2. Règles',
        body: [
          'Créez des règles par mot-clé ou expression régulière dans Rules, une par ligne.',
          'Les règles peuvent analyser username, displayName, bio et le contenu visible des publications.',
          'Les publications détectées sont surlignées en jaune clair.',
        ],
      },
      {
        title: '3. Examen des candidats',
        body: [
          'Dans Candidate Users, vérifiez avatar, lien du profil, bio, abonnés, score et raison de détection.',
          'Ajoutez les cibles confirmées à la file de blocage et les faux positifs à la liste blanche.',
          'Les doublons sont supprimés automatiquement.',
        ],
      },
      {
        title: '4. File de blocage',
        body: [
          'Run Batch respecte la taille du lot, l’intervalle, les essais et le mode configurés.',
          'Manual Block Now ignore l’intervalle. Trop de blocages en une fois peuvent affecter le compte.',
          'Les utilisateurs déjà bloqués, inexistants, en liste blanche ou avec ID différent sont ignorés ou retirés.',
        ],
      },
      {
        title: '5. Export',
        body: ['Blocked Users peut exporter les données en TXT, CSV, JSON, NDJSON ou SQL.'],
      },
      {
        title: '6. Sécurité',
        body: [
          'Le mode réel dépend de la session web X/Twitter actuelle.',
          'Commencez par le mode simulation, avec de petits lots et des intervalles suffisants.',
        ],
      },
    ],
  },
};
