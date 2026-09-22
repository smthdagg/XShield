/* 截图 harness 的 chrome API stub：提供面板渲染所需的示例数据。 */
window.onerror = function (m, src, line, col, err) {
  document.title = 'ERR:' + m + ' @ ' + ((err && err.stack) || '').slice(0, 300);
};
var __defaults = {
  enabled: true, language: 'zh-CN', highlightMode: false,
  keywords: '', cloudEnabled: true, shareEnabled: true,
  cloudKeywords: '', disabledCloudKeywords: [], checkUsername: true,
  onlyComments: true, blockSpecialChars: false, blockEmoji: false, blockGrok: false,
  whitelist: [], communityHandles: [], communityDismissed: [],
  blockedHistory: [
    { id: 'c1', text: '应该没人比我玩的开了吧💖✨我福不黑不信你看', user: 'Xervynsd79', displayName: 'Xervynsd', reason: 'AI·黄推', time: Date.now() - 3600000, isAutoBlock: false },
    { id: 'c2', text: '太阳射🌖不进去的地方💀你可以', user: 'BertiePeadn1', displayName: '惜檬🍑同城免费破处🍑', reason: 'AI·黄推', time: Date.now() - 7200000, isAutoBlock: false },
    { id: 'c3', text: '是这个视频吧 t.cn/AXOx5md0', user: 'mitali_rumade', displayName: 'Mitali Rumade', reason: '关键字 · 内容屏蔽（AI 未确认）', time: Date.now() - 5400000, isAutoBlock: false }
  ],
  blockedUsersOnX: [], blockedAt: {},
  autoBlockQueue: [], autoBlockEta: {},
  autoBlockToday: 0, autoBlockPausedUntil: 0,
  autoBlockDailyLimit: 20, autoBlockBatchLimit: 5, autoBlockDelaySeconds: 90,
  queueInfo: { Xervynsd79: { displayName: 'Xervynsd', text: '应该没人比我玩的开了吧💖✨我福不黑不信你看' } },
  cloudOwnerRepo: 'smthdagg/XShield-keywords',
  lastSyncTime: Date.now() - 3600000, syncStatus: 'ok', syncError: '',
  githubToken: '', aiEngine: 'ai', aiApiKey: 'demo-key',
  aiModel: 'jev-latest', aiMinConfidence: 0.7, aiScanAll: true,
  aiAutoBlock: false, keywordAutoBlock: false, aiLearnKeywords: true,
  aiCatPorn: true, aiCatScam: true, aiCatAd: true, aiCatBot: true,
  statsTotalBlocks: 128, statsTriggers: 342,
  statsBlocksByDay: {}, currentUsername: 'demo_user', currentUserSeenAt: Date.now(),
  xshieldLogs: [
    { id: 'l1', level: 'info', category: 'trigger', message: '检测到 3 条垃圾回复（3 条进入待隐藏）', time: Date.now() - 1200000 },
    { id: 'l2', level: 'info', category: 'system', message: 'AI 引擎连通测试成功（jev-1.13.0，样本判定：AI·诈骗）', time: Date.now() - 2400000 },
    { id: 'l3', level: 'info', category: 'block', message: '切换为「仅隐藏」：撤回 2 个自动触发用户的待拉黑排队（社区共享名单除外）', time: Date.now() - 3600000 }
  ]
};
window.chrome = {
  runtime: {
    getManifest: function () { return { version: '1.8.0' }; },
    getURL: function (p) { return p; },
    sendMessage: function () { return Promise.resolve({ success: true }); },
    onMessage: { addListener: function () {} }
  },
  storage: {
    local: {
      get: function (keys) {
        var fill = function (k) { return Object.prototype.hasOwnProperty.call(__defaults, k) ? __defaults[k] : undefined; };
        if (typeof keys === 'string') { var o = {}; o[keys] = fill(keys); return Promise.resolve(o); }
        if (Array.isArray(keys)) { var a = {}; keys.forEach(function (k) { a[k] = fill(k); }); return Promise.resolve(a); }
        var out = {}; Object.keys(keys).forEach(function (k) { out[k] = keys[k] !== undefined ? keys[k] : fill(k); }); return Promise.resolve(out);
      },
      set: function () { return Promise.resolve(); }
    },
    onChanged: { addListener: function () {} }
  }
};
window.addEventListener('DOMContentLoaded', function () {
  var view = new URLSearchParams(location.search).get('view');
  if (!view) return;
  var map = { triggered: '触发记录', blockedLog: '拉黑记录', whitelist: '白名单', rules: '规则与同步', logs: '状态与日志', settings: '总设置' };
  var label = map[view];
  var timer = setInterval(function () {
    var btn = Array.prototype.slice.call(document.querySelectorAll('.nav-list button')).find(function (b) { return b.textContent.indexOf(label) !== -1; });
    if (btn) { clearInterval(timer); btn.click(); }
  }, 100);
  setTimeout(function () { clearInterval(timer); }, 10000);
});
