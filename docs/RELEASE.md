# Release Checklist

## GitHub 发布前

- [ ] 替换 `your-name/xshield` 为真实仓库地址。
- [ ] 替换 `security@example.com` 为真实安全邮箱。
- [ ] 替换 `.github/FUNDING.yml` 的赞助账号。
- [ ] 更新 `CHANGELOG.md`。
- [ ] 运行 `pnpm lint`。
- [ ] 运行 `pnpm test`。
- [ ] 运行 `pnpm build`。
- [ ] Chrome 加载 `apps/extension/dist`。
- [ ] 手动测试弹窗、Dashboard、规则、候选池、队列、白名单、模拟执行。
- [ ] 谨慎测试真实拉黑。

## 建议 GitHub 仓库设置

- 开启 Issues。
- 开启 Discussions。
- 设置 Topics：`chrome-extension`, `twitter`, `x`, `spam-detection`, `typescript`, `react`, `manifest-v3`。
- 在 About 中写明：Local-first Chrome extension for X/Twitter spam account detection and block queue management.
