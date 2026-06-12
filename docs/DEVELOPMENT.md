# Development

## 环境

- Node.js 20+
- pnpm 9+
- Chrome

## 安装

```bash
corepack enable
pnpm install
```

## 常用命令

```bash
pnpm lint
pnpm test
pnpm build
```

## 架构

- `apps/extension/src/content`：X 页面内容脚本，负责采集可见用户和命中高亮。
- `apps/extension/src/background`：后台消息、规则评估和队列协调。
- `apps/extension/src/dashboard`：主控制台。
- `apps/extension/src/popup`：扩展弹窗。
- `apps/extension/src/store`：本地状态、IndexedDB、队列执行。
- `packages/rule-engine`：规则匹配与评分。
- `packages/search-engine`：用户采集与搜索辅助。
- `packages/block-executor`：队列执行与重试。
- `packages/shared`：共享类型和默认配置。

## 发布前检查

1. 替换项目链接和赞助链接。
2. 更新版本号：
   - `package.json`
   - `apps/extension/package.json`
   - `apps/extension/manifest.json`
   - `apps/extension/src/projectInfo.ts`
3. 更新 `CHANGELOG.md`。
4. 运行 `pnpm lint && pnpm test && pnpm build`。
5. 在 Chrome 加载 `apps/extension/dist` 手动测试。
