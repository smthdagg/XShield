import { ExternalLink, Heart, Settings, ShieldCheck } from 'lucide-react';
import { PROJECT_INFO } from '../projectInfo';

export function Options(): JSX.Element {
  const links = [
    { label: 'GitHub', url: PROJECT_INFO.repositoryUrl },
    { label: '反馈问题', url: PROJECT_INFO.issuesUrl },
    { label: '讨论区', url: PROJECT_INFO.discussionsUrl },
    { label: '支持项目', url: PROJECT_INFO.sponsorUrl },
  ];

  return (
    <main className="page-shell">
      <header className="page-header">
        <Settings aria-hidden />
        <div>
          <h1>{PROJECT_INFO.name}</h1>
          <p>开源的 X/Twitter 垃圾用户识别与拉黑队列管理工具。</p>
        </div>
      </header>
      <section className="about-grid">
        <article className="about-card">
          <ShieldCheck aria-hidden />
          <h2>版本与许可证</h2>
          <p>
            当前版本 v{PROJECT_INFO.version}，采用 {PROJECT_INFO.license} 许可证。自定义词库、云端词库、屏蔽历史与待拉黑队列均保存在本地。
          </p>
          <small>{PROJECT_INFO.copyright}</small>
        </article>
        <article className="about-card">
          <Heart aria-hidden />
          <h2>反馈与支持</h2>
          <p>欢迎在 GitHub 提交 bug、功能建议、规则改进和真实使用反馈。觉得项目有帮助，也可以赞助维护。</p>
          <div className="about-links">
            {links.map((link) => (
              <a key={link.label} href={link.url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden />
                {link.label}
              </a>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
