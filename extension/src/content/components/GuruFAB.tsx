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
      {/* Guru triskelion mark — three interlocking rings in the brand accents
          (Catch-up blue · Dive-in pink · Recap orange). */}
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8.4" r="5" stroke="#38BDF8" stroke-width="1.7" />
        <circle cx="8.1" cy="14.6" r="5" stroke="#EC4899" stroke-width="1.7" />
        <circle cx="15.9" cy="14.6" r="5" stroke="#FB923C" stroke-width="1.7" />
      </svg>
      {count > 0 && <span class="guru-fab-badge">{count}</span>}
    </button>
  );
}
