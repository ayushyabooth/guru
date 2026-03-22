import { h } from 'preact';
import { panelVisible } from '../state';
import { SNAP_HEIGHTS } from '../../shared/constants';

interface GuruFABProps {
  count: number;
  visible: boolean;
  onClick: () => void;
}

export default function GuruFAB({ count, visible, onClick }: GuruFABProps) {
  if (!visible) return null;

  // Move FAB above the panel when it's open
  const isPanelOpen = panelVisible.value;
  const bottomPx = isPanelOpen
    ? SNAP_HEIGHTS.default * window.innerHeight + 16
    : 32;

  return (
    <button
      class="guru-fab guru-interactive"
      onClick={onClick}
      title={isPanelOpen ? 'Close Guru panel' : 'Open Guru insights'}
      style={{ bottom: `${bottomPx}px` }}
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
      {count > 0 && <span class="guru-fab-badge">{count}</span>}
    </button>
  );
}
