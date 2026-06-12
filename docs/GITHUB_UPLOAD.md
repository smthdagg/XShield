# GitHub Upload Guide

## 1. 创建仓库

在 GitHub 新建仓库，例如：

```text
xshield
```

建议勾选：

- Public
- Issues
- Discussions

不要让 GitHub 自动生成 README、LICENSE 或 `.gitignore`，本项目已经包含。

## 2. 替换占位信息

上传前搜索并替换：

```text
your-name/xshield
your-name
security@example.com
```

重点文件：

- `apps/extension/src/projectInfo.ts`
- `apps/extension/manifest.json`
- `.github/FUNDING.yml`
- `README.md`
- `SECURITY.md`
- `docs/SPONSORSHIP.md`

## 3. 初始化 Git

```bash
git init
git add .
git commit -m "Initial open source release"
git branch -M main
git remote add origin https://github.com/your-name/xshield.git
git push -u origin main
```

## 4. 发布 Release

建议创建 tag：

```bash
git tag v0.3.0
git push origin v0.3.0
```

Release 标题：

```text
XShield v0.3.0
```

Release 内容可复制 `CHANGELOG.md` 中 `0.3.0` 部分。

## 5. Chrome 扩展测试

GitHub 上传完成后，本地继续加载：

```text
apps/extension/dist
```

每次修改代码后运行：

```bash
pnpm build
```
