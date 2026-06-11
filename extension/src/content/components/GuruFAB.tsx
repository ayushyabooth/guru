import { h } from 'preact';
import Goo from './Goo';
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
      {/* R10: the FAB IS the organism — no glass dish around it */}
      <Goo size={52} bold />
      {count > 0 && <span class="guru-fab-badge">{count}</span>}
    </button>
  );
}
