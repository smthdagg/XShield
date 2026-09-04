import { useEffect, useState } from 'react';
import { Settings } from 'lucide-react';
import { getStorageDefaults } from '../store/blockerStorage';

export function Popup() {
  const [blockedUsers, setBlockedUsers] = useState(0);
  const [queueCount, setQueueCount] = useState(0);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    void chrome.storage.local
      .get(getStorageDefaults('blockedUsersOnX', 'autoBlockQueue', 'enabled'))
      .then((items) => {
        setBlockedUsers(((items.blockedUsersOnX as string[]) ?? []).length);
        setQueueCount(((items.autoBlockQueue as string[]) ?? []).length);
        setEnabled(Boolean(items.enabled));
      });
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes.blockedUsersOnX) setBlockedUsers(((changes.blockedUsersOnX.newValue as string[]) ?? []).length);
      if (changes.autoBlockQueue) setQueueCount(((changes.autoBlockQueue.newValue as string[]) ?? []).length);
      if (changes.enabled) setEnabled(Boolean(changes.enabled.newValue));
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  const openDashboard = (): void => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  };

  return (
    <div className="popup-shell">
      <div className="popup-brand">
        <img src={chrome.runtime.getURL('icons/xshield-logo.svg')} alt="" />
        <span>XShield</span>
        <span className={`status-dot${enabled ? ' on' : ''}`} />
      </div>
      <div className="popup-stats">
        <div className="popup-stat">
          <strong>{blockedUsers}</strong>
          <span>已拉黑</span>
        </div>
        <div className="popup-stat">
          <strong>{queueCount}</strong>
          <span>待拉黑</span>
        </div>
      </div>
      <button className="popup-btn" type="button" onClick={openDashboard}>
        <Settings size={14} /> 打开面板
      </button>
    </div>
  );
}
