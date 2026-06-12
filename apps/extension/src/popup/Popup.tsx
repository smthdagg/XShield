import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { db } from '../db/dexie';
import { PROJECT_INFO } from '../projectInfo';

interface PopupStats {
  triggeredCount: number;
  queueCount: number;
}

export function Popup(): JSX.Element {
  const [stats, setStats] = useState<PopupStats>({ triggeredCount: 0, queueCount: 0 });

  useEffect(() => {
    let active = true;

    const loadStats = async (): Promise<void> => {
      const [triggeredCount, queueCount] = await Promise.all([
        db.candidates.where('status').equals('candidate').count(),
        db.blockQueue.where('status').equals('queued').count(),
      ]);
      if (active) setStats({ triggeredCount, queueCount });
    };

    void loadStats();

    return () => {
      active = false;
    };
  }, []);

  const openPage = (page: string): void => {
    const url = chrome.runtime.getURL(page);
    void chrome.tabs.create({ url });
  };

  return (
    <main className="popup-shell">
      <div className="popup-brand">
        <img src={chrome.runtime.getURL('icons/xshield-logo.svg')} alt="" />
        <strong>XShield</strong>
      </div>
      <button className="primary-action" type="button" onClick={() => openPage('index.html')}>
        <BarChart3 aria-hidden />
        Dashboard
      </button>
      <section className="popup-stats" aria-label="XShield queue status">
        <div>
          <span>待处理触发</span>
          <strong>{stats.triggeredCount}</strong>
        </div>
        <div>
          <span>拉黑队列</span>
          <strong>{stats.queueCount}</strong>
        </div>
      </section>
      <p className="popup-footer">
        {PROJECT_INFO.name} v{PROJECT_INFO.version} / {PROJECT_INFO.license}
      </p>
    </main>
  );
}
