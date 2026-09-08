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
node scripts/package-extension.mjs   # 打包 release zip（xshield-vX.Y.Z.zip，需先 build）
```

## 架构

- `apps/extension/src/content`：X 页面内容脚本，负责采集可见用户和命中高亮。
- `apps/extension/src/background`：后台消息、规则评估和队列协调。
- `apps/extension/src/dashboard`：主控制台。
- `apps/extension/src/popup`：扩展弹窗。
- `apps/extension/src/store`：本地状态、屏蔽历史、队列执行。

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
